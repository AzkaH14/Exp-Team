import "server-only";
import {
  SHEETS_API,
  SHEETS_RW_SCOPE,
  getServiceAccountToken,
  loadServiceAccount,
} from "./google-sheets";
import { getSacredRegistryIncludingCancelled } from "../client-registry/store";
import {
  TOUCHBASE_CITIES,
  TOUCHBASE_STATUS_LABELS,
  type TouchbaseEntry,
  type TouchbaseRow,
  type TouchbaseStatus,
} from "../types/touchbase";
import {
  addOneMonth,
  callFor,
  formatSheetDate,
  isSheetMonth,
  monthLabelOf,
  parseMonthLabel,
  parseSheetDate,
} from "../engagement/touchbase-shared";

/**
 * The "Benefactor Tracker" tab of the Experience Calendar sheet, laid out like
 * the ops city tabs: # · Benefactor Name · Status · Date of call · Attendee ·
 * Note · Next touchbase due.
 *
 *   row 1  title          row 2  how-to          row 3  header (frozen)
 *   "October 2026"        month band (newest month on top)
 *   "Islamabad (26)"      city band, then that city's benefactors
 *
 * Rows are matched back to the registry by benefactor name. A row filled from
 * a completed Odoo task has a note ending "(Odoo task 74045)" and no next due;
 * it is recomputed on every sync. Any other row with content is a team entry.
 */

const DEFAULT_SHEET_ID = "1FNvZrPjJjhrJnHdt4S0FWLmHdG4egJ8ULt0gmnqC-zQ";
const DEFAULT_TAB = "Benefactor Tracker";

const COLUMNS = ["#", "Benefactor Name", "Status", "Date of call", "Attendee", "Note", "Next touchbase due"];
const WIDTH = COLUMNS.length;
const C = { n: 0, name: 1, status: 2, date: 3, attendee: 4, note: 5, next: 6 };
const TITLE = "Benefactor Touchbase Calls";
const SUBTITLE =
  "Update Status, Date, Attendee, Note and Next touchbase due as calls happen. Any attempt counts as progress. " +
  "Notes ending “(Odoo task …)” were filled from a completed Odoo Engagement Call / Visit.";
const HEADER_ROWS = 3;
const READ_CACHE_TTL_MS = 60_000;
const AUTO_NOTE_RE = /\(Odoo task [\d—-]+\)\s*$/;

const STATUS_BY_LABEL = new Map<string, TouchbaseStatus>(
  (Object.entries(TOUCHBASE_STATUS_LABELS) as Array<[TouchbaseStatus, string]>).map(([k, v]) => [v.toLowerCase(), k])
);

function getSheetId(): string {
  return process.env.TOUCHBASE_SHEET_ID?.trim() || DEFAULT_SHEET_ID;
}

function getTabTitle(): string {
  return process.env.TOUCHBASE_SHEET_TAB?.trim() || DEFAULT_TAB;
}

export function isTouchbaseSheetConfigured(): boolean {
  return Boolean(loadServiceAccount() && getSheetId());
}

function quotedTab(): string {
  return `'${getTabTitle().replace(/'/g, "''")}'`;
}

async function token(): Promise<string> {
  const sa = loadServiceAccount();
  if (!sa) throw new Error("Touchbase sheet requires GOOGLE_SERVICE_ACCOUNT_JSON");
  return getServiceAccountToken(sa, SHEETS_RW_SCOPE);
}

async function sheetsFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${SHEETS_API}/${getSheetId()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${await token()}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
}

async function check(res: Response, what: string): Promise<void> {
  if (!res.ok) throw new Error(`Touchbase sheet ${what} failed: ${res.status} ${await res.text()}`);
}

async function batchUpdate(requests: unknown[], what: string): Promise<unknown> {
  const res = await sheetsFetch(":batchUpdate", { method: "POST", body: JSON.stringify({ requests }) });
  await check(res, what);
  return res.json();
}

// ── Tab metadata ───────────────────────────────────────────────────────────

interface TabMeta {
  sheetId: number;
  rowCount: number;
  columnCount: number;
  conditionalRules: number;
  frozenRows: number;
  frozenColumns: number;
  merges: number;
}

async function tabMeta(): Promise<TabMeta> {
  const title = getTabTitle();
  const res = await sheetsFetch(
    `?fields=sheets(properties(sheetId,title,gridProperties(rowCount,columnCount,frozenRowCount,frozenColumnCount)),conditionalFormats(ranges),merges)`
  );
  await check(res, "metadata");
  const meta = (await res.json()) as {
    sheets?: Array<{
      properties?: {
        sheetId?: number;
        title?: string;
        gridProperties?: { rowCount?: number; columnCount?: number; frozenRowCount?: number; frozenColumnCount?: number };
      };
      conditionalFormats?: unknown[];
      merges?: unknown[];
    }>;
  };
  const tab = meta.sheets?.find((s) => s.properties?.title === title);
  if (tab?.properties?.sheetId != null) {
    return {
      sheetId: tab.properties.sheetId,
      rowCount: tab.properties.gridProperties?.rowCount ?? 1000,
      columnCount: tab.properties.gridProperties?.columnCount ?? 26,
      conditionalRules: tab.conditionalFormats?.length ?? 0,
      frozenRows: tab.properties.gridProperties?.frozenRowCount ?? 0,
      frozenColumns: tab.properties.gridProperties?.frozenColumnCount ?? 0,
      merges: tab.merges?.length ?? 0,
    };
  }
  const body = (await batchUpdate([{ addSheet: { properties: { title } } }], "tab create")) as {
    replies?: Array<{ addSheet?: { properties?: { sheetId?: number } } }>;
  };
  const sheetId = body.replies?.[0]?.addSheet?.properties?.sheetId;
  if (sheetId == null) throw new Error(`Could not create the "${title}" tab`);
  return { sheetId, rowCount: 1000, columnCount: 26, conditionalRules: 0, frozenRows: 0, frozenColumns: 0, merges: 0 };
}

// ── Reading ────────────────────────────────────────────────────────────────

const globalCache = globalThis as unknown as {
  __mohsynTouchbaseSheetCache?: { rows: string[][]; fetchedAt: number };
};

async function fetchRows(force = false): Promise<string[][]> {
  const cache = globalCache.__mohsynTouchbaseSheetCache;
  if (!force && cache && Date.now() - cache.fetchedAt < READ_CACHE_TTL_MS) return cache.rows;
  await tabMeta(); // creates the tab on first use
  const res = await sheetsFetch(`/values/${encodeURIComponent(`${quotedTab()}!A:Z`)}`);
  await check(res, "read");
  const rows = ((await res.json()) as { values?: string[][] }).values ?? [];
  globalCache.__mohsynTouchbaseSheetCache = { rows, fetchedAt: Date.now() };
  return rows;
}

type LineKind = "spacer" | "month" | "city" | "data";
interface Line {
  kind: LineKind;
  month: string;
  values: string[];
}

function text(row: string[] | undefined, i: number): string {
  return String(row?.[i] ?? "").trim();
}

function normName(s: string): string {
  return s.toLowerCase().replace(/^dr\.?\s+/, "").replace(/[^a-z0-9]/g, "");
}

function registryIndex(): Map<string, string> {
  const map = new Map<string, string>();
  for (const r of getSacredRegistryIncludingCancelled()) {
    for (const name of [r.benefactor, ...(r.aliases ?? [])]) {
      const k = normName(name);
      if (k && !map.has(k)) map.set(k, r.id);
    }
  }
  return map;
}

function cityOfBand(a: string): string | null {
  const name = a.replace(/\s*\(\d+\)\s*$/, "");
  return (TOUCHBASE_CITIES as readonly string[]).includes(name) ? name : null;
}

/** Month / city bands and benefactor rows below the frozen header. */
function parseLines(rows: string[][]): Line[] {
  const lines: Line[] = [];
  let month = "";
  for (const row of rows.slice(HEADER_ROWS)) {
    const a = text(row, C.n);
    const b = text(row, C.name);
    if (!b) {
      const m = parseMonthLabel(a);
      if (m) {
        month = m;
        lines.push({ kind: "month", month, values: [] });
      } else if (month && cityOfBand(a)) {
        lines.push({ kind: "city", month, values: [] });
      }
      continue;
    }
    if (month) {
      lines.push({ kind: "data", month, values: COLUMNS.map((_, i) => text(row, i)) });
    }
  }
  return lines;
}

function lineToEntry(line: Line, index: Map<string, string>): TouchbaseEntry | null {
  if (line.kind !== "data") return null;
  const v = line.values;
  const registryId = index.get(normName(v[C.name]));
  if (!registryId) return null;
  const status = STATUS_BY_LABEL.get(v[C.status].toLowerCase()) ?? "pending";
  const year0 = Number(line.month.slice(0, 4));
  const date0 = parseSheetDate(v[C.date], year0);
  const next0 = parseSheetDate(v[C.next], year0);
  // Filled from Odoo and not edited since (next due still the automatic +1 month).
  const auto = AUTO_NOTE_RE.test(v[C.note]) && (!next0 || (date0 !== "" && next0 === addOneMonth(date0)));
  const hasContent = status !== "pending" || v[C.date] || v[C.attendee] || v[C.note] || v[C.next];
  if (auto || !hasContent) return null;
  const year = Number(line.month.slice(0, 4));
  return {
    key: `${line.month}|${registryId}`,
    month: line.month,
    registryId,
    benefactorCode: "",
    benefactor: v[C.name],
    city: "",
    status,
    callDate: parseSheetDate(v[C.date], year),
    attendee: v[C.attendee],
    note: v[C.note],
    nextDue: parseSheetDate(v[C.next], year),
    updatedBy: "",
    updatedAt: "",
  };
}

/**
 * The first version of this tab had a 14-column layout (Month … Source …
 * hidden Key). Read its team-logged rows so the switch keeps them.
 */
function legacyEntries(rows: string[][]): TouchbaseEntry[] {
  if (text(rows[0], 0) !== "Month") return [];
  const out: TouchbaseEntry[] = [];
  for (const row of rows.slice(1)) {
    const [keyMonth, registryId] = text(row, 13).split("|");
    const month = parseMonthLabel(text(row, 0)) || keyMonth;
    if (!registryId || !month || text(row, 10).toLowerCase() !== "logged") continue;
    const year = Number(month.slice(0, 4));
    out.push({
      key: `${month}|${registryId}`,
      month,
      registryId,
      benefactorCode: text(row, 2),
      benefactor: text(row, 3),
      city: text(row, 4),
      status: STATUS_BY_LABEL.get(text(row, 5).toLowerCase()) ?? "pending",
      callDate: parseSheetDate(text(row, 6), year),
      attendee: text(row, 7),
      note: text(row, 8),
      nextDue: parseSheetDate(text(row, 9), year),
      updatedBy: text(row, 11),
      updatedAt: text(row, 12),
    });
  }
  return out;
}

function entriesFrom(rows: string[][]): TouchbaseEntry[] {
  if (text(rows[0], 0) === "Month") return legacyEntries(rows);
  const index = registryIndex();
  return parseLines(rows)
    .map((l) => lineToEntry(l, index))
    .filter((e): e is TouchbaseEntry => e !== null);
}

/** Team-logged entries (every month). */
export async function listSheetEntries(force = false): Promise<TouchbaseEntry[]> {
  return entriesFrom(await fetchRows(force));
}

// ── Writing ────────────────────────────────────────────────────────────────

function monthLines(month: string, rows: TouchbaseRow[]): Line[] {
  const blank = () => new Array<string>(WIDTH).fill("");
  const lines: Line[] = [{ kind: "month", month, values: [monthLabelOf(month), ...blank().slice(1)] }];
  for (const city of TOUCHBASE_CITIES) {
    const inCity = rows.filter((r) => r.city === city).sort((a, b) => a.benefactor.localeCompare(b.benefactor));
    if (!inCity.length) continue;
    lines.push({ kind: "city", month, values: [`${city} (${inCity.length})`, ...blank().slice(1)] });
    inCity.forEach((r, i) => {
      const call = callFor(r);
      const e = r.entry;
      const v = blank();
      v[C.n] = String(i + 1);
      v[C.name] = r.benefactor;
      v[C.status] = TOUCHBASE_STATUS_LABELS[r.status];
      v[C.date] = call?.date ? formatSheetDate(call.date) : "";
      v[C.attendee] = call?.attendee ?? "";
      v[C.note] = e ? e.note : call?.auto ? `${call.title} (Odoo task ${call.odooTaskId ?? "—"})` : "";
      v[C.next] = call?.nextDue ? formatSheetDate(call.nextDue) : "";
      lines.push({ kind: "data", month, values: v });
    });
  }
  return lines;
}

/** Existing lines of other months, re-emitted with their band labels. */
function keptLines(rows: string[][], month: string): Line[] {
  if (text(rows[0], 0) === "Month") return []; // legacy layout: rebuilt from entries
  const lines: Line[] = [];
  let current = "";
  for (const row of rows.slice(HEADER_ROWS)) {
    const a = text(row, C.n);
    const b = text(row, C.name);
    const values = COLUMNS.map((_, i) => text(row, i));
    if (!b && parseMonthLabel(a)) {
      current = parseMonthLabel(a);
      if (current !== month && isSheetMonth(current)) lines.push({ kind: "month", month: current, values });
    } else if (current && current !== month && isSheetMonth(current)) {
      if (!b && cityOfBand(a)) lines.push({ kind: "city", month: current, values });
      else if (b) lines.push({ kind: "data", month: current, values });
    }
  }
  return lines;
}

function rgb(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return { red: ((n >> 16) & 255) / 255, green: ((n >> 8) & 255) / 255, blue: (n & 255) / 255 };
}

const NAVY = "#1f3a4d";
const CREAM = "#fef7dc";
const GRID = "#d0d7de";

function formatRequests(meta: TabMeta, lines: Line[]): unknown[] {
  const { sheetId } = meta;
  const row = (i: number) => ({ sheetId, startRowIndex: i, endRowIndex: i + 1, startColumnIndex: 0, endColumnIndex: WIDTH });
  const cells = (r0: number, r1: number, c0: number, c1: number) => ({
    sheetId,
    startRowIndex: r0,
    endRowIndex: r1,
    startColumnIndex: c0,
    endColumnIndex: c1,
  });
  const fmt = (range: unknown, userEnteredFormat: Record<string, unknown>, fields: string) => ({
    repeatCell: { range, cell: { userEnteredFormat }, fields: `userEnteredFormat(${fields})` },
  });
  const border = { style: "SOLID", color: rgb(GRID) };
  const statusRule = (label: string, bg: string, fg: string, bold: boolean) => ({
    addConditionalFormatRule: {
      index: 0,
      rule: {
        ranges: [cells(HEADER_ROWS, meta.rowCount, C.status, C.status + 1)],
        booleanRule: {
          condition: { type: "TEXT_EQ", values: [{ userEnteredValue: label }] },
          format: { backgroundColor: rgb(bg), textFormat: { foregroundColor: rgb(fg), bold } },
        },
      },
    },
  });

  const reqs: unknown[] = [
    // Reset everything left from earlier layouts.
    { unmergeCells: { range: { sheetId } } },
    { repeatCell: { range: { sheetId }, cell: { userEnteredFormat: {} }, fields: "userEnteredFormat" } },
    { setDataValidation: { range: { sheetId } } },
    ...Array.from({ length: meta.conditionalRules }, () => ({ deleteConditionalFormatRule: { sheetId, index: 0 } })),
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: meta.columnCount },
        properties: { hiddenByUser: false, pixelSize: 100 },
        fields: "hiddenByUser,pixelSize",
      },
    },
    {
      updateSheetProperties: {
        properties: { sheetId, // No frozen columns: Sheets refuses merges that cross a frozen column,
        // and the month / city bands are merged across the table.
        gridProperties: { frozenRowCount: HEADER_ROWS, frozenColumnCount: 0 } },
        fields: "gridProperties.frozenRowCount,gridProperties.frozenColumnCount",
      },
    },
    ...[40, 210, 110, 130, 120, 460, 160].map((px, i) => ({
      updateDimensionProperties: {
        range: { sheetId, dimension: "COLUMNS", startIndex: i, endIndex: i + 1 },
        properties: { pixelSize: px },
        fields: "pixelSize",
      },
    })),
    // Title, how-to, header.
    { mergeCells: { range: row(0), mergeType: "MERGE_ALL" } },
    fmt(row(0), { textFormat: { bold: true, fontSize: 15, foregroundColor: rgb(NAVY) } }, "textFormat"),
    { mergeCells: { range: row(1), mergeType: "MERGE_ALL" } },
    fmt(row(1), { textFormat: { italic: true, fontSize: 9, foregroundColor: rgb("#5f6368") } }, "textFormat"),
    fmt(
      row(2),
      {
        backgroundColor: rgb(NAVY),
        horizontalAlignment: "CENTER",
        verticalAlignment: "MIDDLE",
        textFormat: { bold: true, foregroundColor: rgb("#ffffff") },
      },
      "backgroundColor,horizontalAlignment,verticalAlignment,textFormat"
    ),
    statusRule("Pending", "#e8eaed", "#5f6368", false),
    statusRule("Not reached", "#fdecc8", "#9a6700", true),
    statusRule("Rescheduled", "#d3e8fd", "#0b57d0", true),
    statusRule("Done", "#c6efce", "#137333", true),
  ];

  // Bands and contiguous runs of benefactor rows.
  let runStart = -1;
  const closeRun = (end: number) => {
    if (runStart < 0) return;
    reqs.push(
      fmt(cells(runStart, end, 0, WIDTH), { verticalAlignment: "TOP" }, "verticalAlignment"),
      fmt(
        cells(runStart, end, C.n, C.n + 1),
        { horizontalAlignment: "CENTER", textFormat: { foregroundColor: rgb("#5f6368") } },
        "horizontalAlignment,textFormat"
      ),
      fmt(cells(runStart, end, C.status, C.status + 1), { horizontalAlignment: "CENTER" }, "horizontalAlignment"),
      fmt(cells(runStart, end, C.date, WIDTH), { backgroundColor: rgb(CREAM) }, "backgroundColor"),
      fmt(cells(runStart, end, C.note, C.note + 1), { backgroundColor: rgb(CREAM), wrapStrategy: "WRAP" }, "backgroundColor,wrapStrategy"),
      {
        updateBorders: {
          range: cells(runStart, end, 0, WIDTH),
          top: border,
          bottom: border,
          left: border,
          right: border,
          innerHorizontal: border,
          innerVertical: border,
        },
      },
      {
        setDataValidation: {
          range: cells(runStart, end, C.status, C.status + 1),
          rule: {
            condition: {
              type: "ONE_OF_LIST",
              values: Object.values(TOUCHBASE_STATUS_LABELS).map((v) => ({ userEnteredValue: v })),
            },
            showCustomUi: true,
            strict: false,
          },
        },
      }
    );
    runStart = -1;
  };

  lines.forEach((line, i) => {
    const r = HEADER_ROWS + i;
    if (line.kind === "data") {
      if (runStart < 0) runStart = r;
      return;
    }
    closeRun(r);
    if (line.kind === "month") {
      reqs.push(
        { mergeCells: { range: row(r), mergeType: "MERGE_ALL" } },
        fmt(
          row(r),
          { backgroundColor: rgb("#34556b"), textFormat: { bold: true, fontSize: 12, foregroundColor: rgb("#ffffff") } },
          "backgroundColor,textFormat"
        )
      );
    } else if (line.kind === "city") {
      reqs.push(
        { mergeCells: { range: row(r), mergeType: "MERGE_ALL" } },
        fmt(row(r), { backgroundColor: rgb("#dbe4ea"), textFormat: { bold: true, foregroundColor: rgb(NAVY) } }, "backgroundColor,textFormat")
      );
    }
  });
  closeRun(HEADER_ROWS + lines.length);
  return reqs;
}

function sameGrid(current: string[][], next: string[][]): boolean {
  const trimmed = [...current];
  while (trimmed.length && !trimmed[trimmed.length - 1].some((c) => String(c ?? "").trim())) trimmed.pop();
  if (trimmed.length !== next.length) return false;
  return trimmed.every(
    (row, i) =>
      row.slice(WIDTH).every((c) => !String(c ?? "").trim()) &&
      next[i].every((c, j) => c === String(row[j] ?? ""))
  );
}

/**
 * Rewrite the tab so this month's block mirrors the board; other months keep
 * their rows. Team entries already in the sheet win over the computed rows,
 * except for `savedRegistryId` — the entry this request is saving.
 */
export function syncSheetMonth(month: string, rows: TouchbaseRow[], savedRegistryId?: string): Promise<void> {
  // One sync at a time per instance — overlapping rewrites of the same tab
  // can leave values from one and formatting from another.
  const run = syncQueue.then(() => syncSheetMonthNow(month, rows, savedRegistryId));
  syncQueue = run.catch(() => undefined);
  return run;
}

let syncQueue: Promise<unknown> = Promise.resolve();

/** True when the tab carries this layout's formatting (frozen panes, band merges, status colours). */
function isFormatted(meta: TabMeta, lines: Line[]): boolean {
  const bands = lines.filter((l) => l.kind === "month" || l.kind === "city").length;
  return (
    meta.frozenRows === HEADER_ROWS &&
    meta.frozenColumns === 0 &&
    meta.merges === 2 + bands &&
    meta.conditionalRules === 4
  );
}

/** The whole tab as it should read, given its current contents. */
function buildGrid(
  current: string[][],
  month: string,
  rows: TouchbaseRow[],
  savedRegistryId?: string
): { grid: string[][]; lines: Line[] } {
  const inSheet = new Map(entriesFrom(current).filter((e) => e.month === month).map((e) => [e.registryId, e]));
  const merged = rows.map((r) => {
    const f = inSheet.get(r.registryId);
    if (!f || r.registryId === savedRegistryId) return r;
    return { ...r, entry: { ...f, benefactorCode: r.benefactorCode ?? "", city: r.city }, status: f.status, statusSource: "logged" as const };
  });

  const blocks = new Map<string, Line[]>();
  for (const l of keptLines(current, month)) {
    const list = blocks.get(l.month) ?? [];
    list.push(l);
    blocks.set(l.month, list);
  }
  blocks.set(month, monthLines(month, merged));

  const lines: Line[] = [];
  for (const m of [...blocks.keys()].sort().reverse()) {
    if (lines.length) lines.push({ kind: "spacer", month: m, values: new Array<string>(WIDTH).fill("") });
    lines.push(...(blocks.get(m) ?? []));
  }

  const grid = [
    [TITLE, ...new Array<string>(WIDTH - 1).fill("")],
    [SUBTITLE, ...new Array<string>(WIDTH - 1).fill("")],
    [...COLUMNS],
    ...lines.map((l) => l.values),
  ];
  return { grid, lines };
}

function rowsEqual(a: string[][], b: string[][]): boolean {
  return a.length === b.length && a.every((row, i) => row.length === b[i].length && row.every((c, j) => c === b[i][j]));
}

async function syncSheetMonthNow(month: string, rows: TouchbaseRow[], savedRegistryId?: string): Promise<void> {
  let current = await fetchRows(true);
  let { grid, lines } = buildGrid(current, month, rows, savedRegistryId);

  const meta = await tabMeta();
  if (sameGrid(current, grid)) {
    // Values already match; repair the formatting if an earlier write was cut short.
    if (!isFormatted(meta, lines)) await batchUpdate(formatRequests(meta, lines), "format");
    return;
  }

  // Another server instance may have saved since our read — re-read right
  // before writing so its entry is merged in, not overwritten.
  const latest = await fetchRows(true);
  if (!rowsEqual(latest, current)) {
    current = latest;
    ({ grid, lines } = buildGrid(current, month, rows, savedRegistryId));
    if (sameGrid(current, grid)) return;
  }

  if (grid.length + 20 > meta.rowCount) {
    const add = grid.length + 200 - meta.rowCount;
    await batchUpdate([{ appendDimension: { sheetId: meta.sheetId, dimension: "ROWS", length: add } }], "grow");
    meta.rowCount += add;
  }

  // One write, no separate clear: a reader never sees a half-empty tab.
  // Blank rows overwrite whatever the previous, longer layout left below.
  const values = [...grid];
  while (values.length < current.length) values.push(new Array<string>(WIDTH).fill(""));
  const put = await sheetsFetch(
    `/values/${encodeURIComponent(`${quotedTab()}!A1:G${values.length}`)}?valueInputOption=RAW`,
    { method: "PUT", body: JSON.stringify({ values }) }
  );
  await check(put, "write");
  await batchUpdate(formatRequests(meta, lines), "format");
  globalCache.__mohsynTouchbaseSheetCache = undefined;
}
