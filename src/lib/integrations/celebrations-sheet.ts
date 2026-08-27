import "server-only";
import {
  SHEETS_API,
  SHEETS_RW_SCOPE,
  getServiceAccountToken,
  loadServiceAccount,
} from "./google-sheets";
import type { CelebrationEvent } from "../types/celebrations-calendar";

const COLUMNS = [
  "id", "source", "kind", "categoryId", "categoryLabel", "title", "date",
  "time", "allDay", "recurrence", "registryIdsJson", "clientLabelsJson",
  "citiesJson", "notes", "status", "createdBy", "createdAt", "updatedAt",
  "ticketLinksJson", "linkedGeneratedId",
] as const;
const LAST_COL = "T";
const READ_CACHE_TTL_MS = 5 * 60_000;

const globalCache = globalThis as unknown as {
  __mohsynCelebrationsSheetRows?: { rows: string[][]; fetchedAt: number };
  __mohsynCelebrationsSheetGid?: number;
};

function sheetId(): string {
  return (
    process.env.CELEBRATIONS_CALENDAR_SHEET_ID?.trim() ||
    process.env.ENGAGEMENT_CALENDAR_SHEET_ID?.trim() ||
    ""
  );
}

function tabTitle(): string {
  return process.env.CELEBRATIONS_CALENDAR_SHEET_TAB?.trim() || "Celebrations";
}

function quotedTab(): string {
  return `'${tabTitle().replace(/'/g, "''")}'`;
}

export function isCelebrationsSheetConfigured(): boolean {
  return Boolean(loadServiceAccount() && sheetId());
}

async function token(): Promise<string> {
  const serviceAccount = loadServiceAccount();
  if (!serviceAccount) throw new Error("Celebrations sheet requires GOOGLE_SERVICE_ACCOUNT_JSON");
  return getServiceAccountToken(serviceAccount, SHEETS_RW_SCOPE);
}

function parseJson<T>(raw: string | undefined, fallback: T): T {
  try {
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function rowToEvent(row: string[]): CelebrationEvent | null {
  if (!row[0]) return null;
  return {
    id: row[0],
    source: (row[1] || "manual") as CelebrationEvent["source"],
    kind: (row[2] || "custom") as CelebrationEvent["kind"],
    categoryId: row[3] || "custom",
    categoryLabel: row[4] || "Custom",
    title: row[5] || "",
    date: row[6] || "",
    time: row[7] || null,
    allDay: row[8] !== "false",
    recurrence: (row[9] || "none") as CelebrationEvent["recurrence"],
    registryIds: parseJson<string[]>(row[10], []),
    clientLabels: parseJson<string[]>(row[11], []),
    cities: parseJson<CelebrationEvent["cities"]>(row[12], []),
    notes: row[13] || "",
    status: (row[14] || "planned") as CelebrationEvent["status"],
    createdBy: (row[15] || "system") as CelebrationEvent["createdBy"],
    createdAt: row[16] || "",
    updatedAt: row[17] || "",
    ticketLinks: parseJson<CelebrationEvent["ticketLinks"]>(row[18], {}),
    linkedGeneratedId: row[19] || null,
  };
}

function eventToRow(event: CelebrationEvent): string[] {
  return [
    event.id, event.source, event.kind, event.categoryId, event.categoryLabel,
    event.title, event.date, event.time ?? "", String(event.allDay),
    event.recurrence, JSON.stringify(event.registryIds),
    JSON.stringify(event.clientLabels), JSON.stringify(event.cities), event.notes,
    event.status, event.createdBy, event.createdAt, event.updatedAt,
    JSON.stringify(event.ticketLinks), event.linkedGeneratedId ?? "",
  ];
}

function invalidate(): void {
  globalCache.__mohsynCelebrationsSheetRows = undefined;
}

async function createMissingTab(): Promise<void> {
  const response = await fetch(`${SHEETS_API}/${sheetId()}:batchUpdate`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await token()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      requests: [{ addSheet: { properties: { title: tabTitle() } } }],
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    if (!/already exists/i.test(detail)) {
      throw new Error(
        `Celebrations tab creation failed: ${response.status} ${detail}`
      );
    }
  }
  globalCache.__mohsynCelebrationsSheetGid = undefined;
  invalidate();
}

async function fetchRows(
  force = false,
  createTabIfMissing = true
): Promise<string[][]> {
  const cached = globalCache.__mohsynCelebrationsSheetRows;
  if (!force && cached && Date.now() - cached.fetchedAt < READ_CACHE_TTL_MS) {
    return cached.rows;
  }
  const range = encodeURIComponent(`${quotedTab()}!A:${LAST_COL}`);
  const response = await fetch(`${SHEETS_API}/${sheetId()}/values/${range}`, {
    headers: { Authorization: `Bearer ${await token()}` },
    cache: "no-store",
  });
  if (!response.ok) {
    const detail = await response.text();
    if (
      createTabIfMissing &&
      response.status === 400 &&
      /unable to parse range|not found/i.test(detail)
    ) {
      await createMissingTab();
      return fetchRows(true, false);
    }
    throw new Error(
      `Celebrations sheet read failed: ${response.status} ${detail}`
    );
  }
  const rows = ((await response.json()) as { values?: string[][] }).values ?? [];
  globalCache.__mohsynCelebrationsSheetRows = { rows, fetchedAt: Date.now() };
  return rows;
}

function hasHeader(rows: string[][]): boolean {
  return rows[0]?.[0]?.toLowerCase() === "id";
}

async function ensureHeader(rows: string[][]): Promise<void> {
  const header = rows[0] ?? [];
  if (hasHeader(rows) && COLUMNS.every((column, index) => header[index] === column)) return;
  const range = encodeURIComponent(`${quotedTab()}!A1:${LAST_COL}1`);
  const response = await fetch(
    `${SHEETS_API}/${sheetId()}/values/${range}?valueInputOption=RAW`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ values: [COLUMNS] }),
    }
  );
  if (!response.ok) {
    throw new Error(`Celebrations sheet header write failed: ${response.status} ${await response.text()}`);
  }
  invalidate();
}

export async function listCelebrationSheetEvents(): Promise<CelebrationEvent[]> {
  let rows = await fetchRows();
  if (!hasHeader(rows) || !COLUMNS.every((column, index) => rows[0]?.[index] === column)) {
    await ensureHeader(rows);
    rows = await fetchRows(true);
  }
  return (hasHeader(rows) ? rows.slice(1) : rows)
    .map(rowToEvent)
    .filter((event): event is CelebrationEvent => Boolean(event));
}

export async function appendCelebrationSheetEvent(event: CelebrationEvent): Promise<void> {
  await ensureHeader(await fetchRows(true));
  const range = encodeURIComponent(`${quotedTab()}!A:${LAST_COL}`);
  const response = await fetch(
    `${SHEETS_API}/${sheetId()}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ values: [eventToRow(event)] }),
    }
  );
  if (!response.ok) {
    throw new Error(`Celebrations sheet append failed: ${response.status} ${await response.text()}`);
  }
  invalidate();
}

async function rowNumberFor(id: string): Promise<number | null> {
  const rows = await fetchRows(true);
  const index = rows.findIndex((row) => row[0] === id);
  return index < 0 ? null : index + 1;
}

export async function updateCelebrationSheetEvent(event: CelebrationEvent): Promise<boolean> {
  const row = await rowNumberFor(event.id);
  if (!row) return false;
  const range = encodeURIComponent(`${quotedTab()}!A${row}:${LAST_COL}${row}`);
  const response = await fetch(
    `${SHEETS_API}/${sheetId()}/values/${range}?valueInputOption=RAW`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ values: [eventToRow(event)] }),
    }
  );
  if (!response.ok) {
    throw new Error(`Celebrations sheet update failed: ${response.status} ${await response.text()}`);
  }
  invalidate();
  return true;
}

async function tabGid(): Promise<number> {
  if (globalCache.__mohsynCelebrationsSheetGid != null) {
    return globalCache.__mohsynCelebrationsSheetGid;
  }
  const response = await fetch(
    `${SHEETS_API}/${sheetId()}?fields=sheets(properties(sheetId,title))`,
    { headers: { Authorization: `Bearer ${await token()}` }, cache: "no-store" }
  );
  if (!response.ok) throw new Error(`Celebrations sheet metadata failed: ${response.status}`);
  const data = (await response.json()) as {
    sheets?: Array<{ properties?: { sheetId?: number; title?: string } }>;
  };
  const gid = data.sheets?.find((sheet) => sheet.properties?.title === tabTitle())
    ?.properties?.sheetId;
  if (gid == null) throw new Error(`Celebrations tab "${tabTitle()}" not found`);
  globalCache.__mohsynCelebrationsSheetGid = gid;
  return gid;
}

export async function deleteCelebrationSheetEvent(id: string): Promise<boolean> {
  const rows = await fetchRows(true);
  const rowIndex = rows.findIndex((row) => row[0] === id);
  if (rowIndex < 0) return false;
  const response = await fetch(`${SHEETS_API}/${sheetId()}:batchUpdate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [{
        deleteDimension: {
          range: { sheetId: await tabGid(), dimension: "ROWS", startIndex: rowIndex, endIndex: rowIndex + 1 },
        },
      }],
    }),
  });
  if (!response.ok) {
    throw new Error(`Celebrations sheet delete failed: ${response.status} ${await response.text()}`);
  }
  invalidate();
  return true;
}
