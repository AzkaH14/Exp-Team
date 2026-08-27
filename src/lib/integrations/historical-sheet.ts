/**
 * Source A — the frozen HubSpot export.
 *
 * Spreadsheet 1wTr5c5dc0iWIhgrTfBg5ZPWXYdopwcEyWD2oSkC9yq4, tab "Tickets Data"
 * (gid 43693950): 7,630 rows x 266 columns, 2025-11-01 -> 2026-08-17.
 *
 * This is finished history — it will never gain a row. Nothing here runs at
 * request time: scripts/build-historical.mjs calls it once and freezes the
 * result into src/data/. See odoo_instruct.md §4 and §12.3.
 */
import type { Ticket } from "../types/ticket";
import { formatDisplayDate, formatMonth } from "../ticket-dates";
import { parsePktTimestamp } from "../cutover";
import { formatHubSpotBenefactorLabel } from "../client-registry/name-match";
import { stripEmptyHubSpotFormFields } from "../hubspot-description";

const DEFAULT_SHEET_ID = "1wTr5c5dc0iWIhgrTfBg5ZPWXYdopwcEyWD2oSkC9yq4";
const DEFAULT_GID = "43693950";

export function getHistoricalSheetUrl(): string {
  const id = process.env.HISTORICAL_SHEET_ID?.trim() || DEFAULT_SHEET_ID;
  const gid = process.env.HISTORICAL_SHEET_GID?.trim() || DEFAULT_GID;
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;
}

/** RFC4180-ish CSV parse. The export contains quoted newlines in descriptions. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (c !== "\r") cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/**
 * "Ticket ID" appears twice (columns 0 and 234) with identical values.
 * Index on FIRST occurrence — a naive header->index map reads column 234.
 */
function buildHeaderIndex(header: string[]): Map<string, number> {
  const index = new Map<string, number>();
  header.forEach((name, i) => {
    const key = name.trim();
    if (key && !index.has(key)) index.set(key, i);
  });
  return index;
}

const CITY_FIXES: Record<string, string> = {
  faislabad: "Faisalabad",
  faisalabad: "Faisalabad",
};

/** Odoo spells it "Faislabad"; the sheet spells it "Faisalabad". */
export function normalizeCity(raw: string): string {
  const s = raw.trim();
  if (!s) return "Other";
  return CITY_FIXES[s.toLowerCase()] ?? s;
}

/** Display labels, not HubSpot's raw enum. Only 1,633 of 7,630 rows carry one. */
function mapPriority(raw: string): "urgent" | "normal" {
  const s = raw.trim().toLowerCase();
  return s === "high" || s === "urgent" ? "urgent" : "normal";
}

function firstEmail(...candidates: string[]): string | null {
  for (const raw of candidates) {
    const value = (raw ?? "").split(";")[0]?.trim();
    if (value && value.includes("@")) return value;
  }
  return null;
}

/**
 * 1,342 rows have no Benefactor Name, but most of those customers appear
 * elsewhere in the sheet WITH a name against the same email. Learn
 * email -> benefactor from the rows that have both, then fill the blanks.
 *
 * Recovers 943 of the 1,342. The remaining 399 are 201 rows with no email at
 * all plus staff/non-client addresses the blocklist drops anyway.
 *
 * Deriving a name from the email local-part instead (jfzaidi@ -> "jfzaidi")
 * was tried and is actively harmful: it produces labels that match nothing in
 * the registry, turning recoverable tickets into silent registry drops.
 */
function learnEmailToName(
  rows: string[][],
  at: (row: string[], column: string) => string
): Map<string, string> {
  const votes = new Map<string, Map<string, number>>();

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const name = at(row, "Benefactor Name");
    if (!name) continue;
    const email = firstEmail(
      at(row, "Benefactor Email"),
      at(row, "All associated contact emails")
    );
    if (!email) continue;
    const key = email.toLowerCase();
    if (!votes.has(key)) votes.set(key, new Map());
    const tally = votes.get(key)!;
    tally.set(name, (tally.get(name) ?? 0) + 1);
  }

  // 17 emails carry more than one spelling — take the most frequent.
  const resolved = new Map<string, string>();
  for (const [email, tally] of votes) {
    const best = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
    if (best) resolved.set(email, best[0]);
  }
  return resolved;
}

export interface HistoricalRow extends Ticket {
  /** Epoch ms of creation — used to split at the cutover, not persisted. */
  createdMs: number;
  /** "Closed" | "Cancelled" | "Pending- Experience". Kept for §10 question 1. */
  ticketStatus: string;
  /** Sheet column "Claimable Engagement Hours" — 6,888 of 7,630 rows. */
  claimableHours: number | null;
}

export function mapSheetRowsToTickets(rows: string[][]): HistoricalRow[] {
  const header = rows[0] ?? [];
  const H = buildHeaderIndex(header);
  const at = (row: string[], column: string): string => {
    const i = H.get(column);
    return i === undefined ? "" : (row[i] ?? "").trim();
  };

  const emailToName = learnEmailToName(rows, at);
  const tickets: HistoricalRow[] = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const id = (row[0] ?? "").trim();
    if (!id) continue;

    const createdMs = parsePktTimestamp(at(row, "Create date"));
    if (createdMs === null) continue;

    const closedMs = parsePktTimestamp(at(row, "Close date"));
    const categoryFull = at(row, "Ticket Category") || "Unspecified";
    const notes = [
      at(row, "Special Requests / Notes"),
      at(row, "Any Other Requirement/Notes"),
    ]
      .map((value) => stripEmptyHubSpotFormFields(value).trim())
      .filter((value) => value.length > 20);

    const hoursRaw = at(row, "Claimable Engagement Hours");
    const hours = hoursRaw === "" ? null : Number(hoursRaw);

    const email = firstEmail(
      at(row, "Benefactor Email"),
      at(row, "All associated contact emails")
    );
    const rawName =
      at(row, "Benefactor Name") ||
      (email ? emailToName.get(email.toLowerCase()) ?? "" : "");

    tickets.push({
      id,
      ticketNumber: `MOH-${id.slice(-5)}`,
      client: formatHubSpotBenefactorLabel(rawName),
      email,
      city: normalizeCity(at(row, "Serving City")),
      category: categoryFull ? categoryFull.split(/[\s/]/)[0] : "",
      categoryFull,
      subCategory: at(row, "Ticket Sub Category"),
      name: at(row, "Ticket name"),
      description: stripEmptyHubSpotFormFields(at(row, "Ticket description")),
      hubspotFieldNotes: notes.length ? notes : undefined,
      created: formatDisplayDate(createdMs),
      closed: closedMs === null ? null : formatDisplayDate(closedMs),
      month: formatMonth(createdMs),
      priority: mapPriority(at(row, "Priority")),
      createdMs,
      ticketStatus: at(row, "Ticket status"),
      claimableHours: hours !== null && Number.isFinite(hours) ? hours : null,
    });
  }

  return tickets;
}

/** Fetch + map. Build-time only — never call this from a request handler. */
export async function fetchHistoricalTickets(): Promise<HistoricalRow[]> {
  const res = await fetch(getHistoricalSheetUrl(), { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Historical sheet fetch failed: ${res.status}`);
  }
  const text = await res.text();
  if (text.startsWith("<")) {
    throw new Error("Historical sheet returned HTML — check sharing settings");
  }
  return mapSheetRowsToTickets(parseCsv(text));
}
