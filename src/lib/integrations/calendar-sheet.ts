import "server-only";
import {
  SHEETS_API,
  SHEETS_RW_SCOPE,
  getServiceAccountToken,
  loadServiceAccount,
} from "./google-sheets";
import type { EngagementEvent } from "../types/engagement-calendar";

/**
 * Google Sheet-backed persistence for the engagement calendar.
 *
 * Requires a service account (GOOGLE_SERVICE_ACCOUNT_JSON) with the target
 * spreadsheet shared to its client_email as Editor, plus ENGAGEMENT_CALENDAR_SHEET_ID.
 * One row per event; column order is fixed by COLUMNS below.
 */

const COLUMNS = [
  "id",
  "registryId",
  "clientLabel",
  "city",
  "lead",
  "type",
  "title",
  "notes",
  "date",
  "time",
  "status",
  "rescheduledFrom",
  "assignedDoctor",
  "hubspotTicketId",
  "createdBy",
  "createdAt",
  "updatedAt",
] as const;

const LAST_COL = "Q"; // 17 columns -> A..Q
const READ_CACHE_TTL_MS = 120_000;

function getSheetId(): string {
  return process.env.ENGAGEMENT_CALENDAR_SHEET_ID?.trim() ?? "";
}

function getTabTitle(): string {
  return process.env.ENGAGEMENT_CALENDAR_SHEET_TAB?.trim() || "Calendar";
}

export function isCalendarSheetConfigured(): boolean {
  return Boolean(loadServiceAccount() && getSheetId());
}

function quotedTab(): string {
  return `'${getTabTitle().replace(/'/g, "''")}'`;
}

async function token(): Promise<string> {
  const sa = loadServiceAccount();
  if (!sa) throw new Error("Calendar sheet requires GOOGLE_SERVICE_ACCOUNT_JSON");
  return getServiceAccountToken(sa, SHEETS_RW_SCOPE);
}

function rowToEvent(row: string[]): EngagementEvent | null {
  const [
    id,
    registryId,
    clientLabel,
    city,
    lead,
    type,
    title,
    notes,
    date,
    time,
    status,
    rescheduledFrom,
  ] = row;
  if (!id || !registryId) return null;

  // New schema (17 cols): … rescheduledFrom, assignedDoctor, hubspotTicketId, createdBy, createdAt, updatedAt
  // Legacy (15 cols): … rescheduledFrom, createdBy, createdAt, updatedAt
  const hasDoctorCols = row.length >= 17;

  let assignedDoctor: string | null = null;
  let hubspotTicketId: string | null = null;
  let createdBy = "";
  let createdAt = "";
  let updatedAt = "";

  const looksLikeLead = (s: string) => /^(Laiba|Seemab|Labeba)$/i.test(s);
  const looksLikeTicketId = (s: string) => /^\d{8,}$/.test(s);

  if (hasDoctorCols) {
    const c12 = row[12]?.trim() ?? "";
    const c13 = row[13]?.trim() ?? "";
    // Some early writes padded legacy rows; lead name landed in doctor/ticket columns
    if (looksLikeLead(c12) || looksLikeLead(c13)) {
      createdBy = looksLikeLead(c12) ? c12 : c13;
      createdAt = row[14] ?? "";
      updatedAt = row[16] || row[15] || "";
    } else {
      assignedDoctor = c12 || null;
      hubspotTicketId = looksLikeTicketId(c13) ? c13 : null;
      createdBy = row[14] ?? "";
      createdAt = row[15] ?? "";
      updatedAt = row[16] ?? "";
    }
  } else {
    createdBy = row[12] ?? "";
    createdAt = row[13] ?? "";
    updatedAt = row[14] ?? "";
  }

  return {
    id,
    registryId,
    clientLabel: clientLabel ?? "",
    city: city ?? "",
    lead: lead ?? "",
    type: (type || "other") as EngagementEvent["type"],
    title: title ?? "",
    notes: notes ?? "",
    date: date ?? "",
    time: time ? time : null,
    status: (status || "planned") as EngagementEvent["status"],
    rescheduledFrom: rescheduledFrom ? rescheduledFrom : null,
    assignedDoctor,
    hubspotTicketId,
    createdBy,
    createdAt,
    updatedAt,
  };
}

function eventToRow(e: EngagementEvent): string[] {
  return [
    e.id,
    e.registryId,
    e.clientLabel,
    e.city,
    e.lead,
    e.type,
    e.title,
    e.notes,
    e.date,
    e.time ?? "",
    e.status,
    e.rescheduledFrom ?? "",
    e.assignedDoctor ?? "",
    e.hubspotTicketId ?? "",
    e.createdBy,
    e.createdAt,
    e.updatedAt,
  ];
}

// Short-lived read cache shared across requests in a single instance.
const globalCache = globalThis as unknown as {
  __mohsynCalendarSheetCache?: { rows: string[][]; fetchedAt: number };
  __mohsynCalendarSheetGid?: number;
};

async function fetchRows(force = false): Promise<string[][]> {
  const cache = globalCache.__mohsynCalendarSheetCache;
  if (!force && cache && Date.now() - cache.fetchedAt < READ_CACHE_TTL_MS) {
    return cache.rows;
  }
  const range = encodeURIComponent(`${quotedTab()}!A:${LAST_COL}`);
  const res = await fetch(`${SHEETS_API}/${getSheetId()}/values/${range}`, {
    headers: { Authorization: `Bearer ${await token()}` },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Calendar sheet read failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { values?: string[][] };
  const rows = data.values ?? [];
  globalCache.__mohsynCalendarSheetCache = { rows, fetchedAt: Date.now() };
  return rows;
}

function invalidateCache(): void {
  globalCache.__mohsynCalendarSheetCache = undefined;
}

function hasHeader(rows: string[][]): boolean {
  return rows.length > 0 && rows[0][0]?.trim().toLowerCase() === "id";
}

function headerNeedsUpgrade(rows: string[][]): boolean {
  if (!hasHeader(rows)) return true;
  const header = rows[0].map((c) => String(c ?? "").trim());
  return COLUMNS.some((col, i) => header[i] !== col);
}

async function ensureHeader(rows: string[][]): Promise<void> {
  if (!headerNeedsUpgrade(rows)) return;
  const range = encodeURIComponent(`${quotedTab()}!A1:${LAST_COL}1`);
  const res = await fetch(
    `${SHEETS_API}/${getSheetId()}/values/${range}?valueInputOption=RAW`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${await token()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ values: [COLUMNS as unknown as string[]] }),
    }
  );
  if (!res.ok) {
    throw new Error(`Calendar sheet header write failed: ${res.status} ${await res.text()}`);
  }
  invalidateCache();
}

/** Data rows only (excludes header), as parsed events. */
export async function listSheetEvents(): Promise<EngagementEvent[]> {
  let rows = await fetchRows();
  if (headerNeedsUpgrade(rows)) {
    await ensureHeader(rows);
    rows = await fetchRows(true);
  }
  const dataRows = hasHeader(rows) ? rows.slice(1) : rows;
  return dataRows
    .map((row) => rowToEvent(row))
    .filter((e): e is EngagementEvent => e !== null);
}

export async function appendSheetEvent(event: EngagementEvent): Promise<void> {
  const rows = await fetchRows(true);
  await ensureHeader(rows);
  const range = encodeURIComponent(`${quotedTab()}!A:${LAST_COL}`);
  const res = await fetch(
    `${SHEETS_API}/${getSheetId()}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await token()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ values: [eventToRow(event)] }),
    }
  );
  if (!res.ok) {
    throw new Error(`Calendar sheet append failed: ${res.status} ${await res.text()}`);
  }
  invalidateCache();
}

/** Locate 1-based sheet row for an event id (accounts for header). */
async function findRowNumber(id: string): Promise<number | null> {
  const rows = await fetchRows(true);
  const startsWithHeader = hasHeader(rows);
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0] === id) return i + 1; // sheet rows are 1-based
  }
  void startsWithHeader;
  return null;
}

export async function updateSheetEvent(event: EngagementEvent): Promise<boolean> {
  const rowNumber = await findRowNumber(event.id);
  if (rowNumber == null) return false;
  const range = encodeURIComponent(
    `${quotedTab()}!A${rowNumber}:${LAST_COL}${rowNumber}`
  );
  const res = await fetch(
    `${SHEETS_API}/${getSheetId()}/values/${range}?valueInputOption=RAW`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${await token()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ values: [eventToRow(event)] }),
    }
  );
  if (!res.ok) {
    throw new Error(`Calendar sheet update failed: ${res.status} ${await res.text()}`);
  }
  invalidateCache();
  return true;
}

async function resolveTabGid(): Promise<number> {
  if (globalCache.__mohsynCalendarSheetGid != null) {
    return globalCache.__mohsynCalendarSheetGid;
  }
  const res = await fetch(
    `${SHEETS_API}/${getSheetId()}?fields=sheets(properties(sheetId,title))`,
    { headers: { Authorization: `Bearer ${await token()}` }, cache: "no-store" }
  );
  if (!res.ok) {
    throw new Error(`Calendar sheet metadata failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as {
    sheets?: Array<{ properties?: { sheetId?: number; title?: string } }>;
  };
  const title = getTabTitle();
  const match = data.sheets?.find((s) => s.properties?.title === title);
  const gid = match?.properties?.sheetId;
  if (gid == null) throw new Error(`Calendar tab "${title}" not found`);
  globalCache.__mohsynCalendarSheetGid = gid;
  return gid;
}

export async function deleteSheetEvent(id: string): Promise<boolean> {
  const rows = await fetchRows(true);
  let rowIndex = -1; // 0-based grid row
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0] === id) {
      rowIndex = i;
      break;
    }
  }
  if (rowIndex < 0) return false;

  const gid = await resolveTabGid();
  const res = await fetch(`${SHEETS_API}/${getSheetId()}:batchUpdate`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await token()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId: gid,
              dimension: "ROWS",
              startIndex: rowIndex,
              endIndex: rowIndex + 1,
            },
          },
        },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`Calendar sheet delete failed: ${res.status} ${await res.text()}`);
  }
  invalidateCache();
  return true;
}
