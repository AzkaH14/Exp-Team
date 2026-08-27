import "server-only";
import {
  fetchGoogleSheetRowsByGid,
  getUnderutilisingSheetGid,
  getUnderutilisingSheetId,
  getUnderutilisingSheetPublishUrl,
  isUnderutilisingSheetConfigured,
} from "../integrations/google-sheets";
import { getSacredRegistry } from "../client-registry/store";
import { matchRegistryRecord, namesMatch } from "../client-registry/name-match";

export interface UnderutilisingSheetCrossCheck {
  configured: boolean;
  sheetCount: number;
  matched: number;
  hubspotOnly: number;
  sheetOnly: number;
  lastFetchedAt: string | null;
  error: string | null;
}

export interface UnderutilisingSheetEntry {
  displayName: string;
  email: string | null;
  city: string | null;
  utilizationStatus: string;
}

interface SheetCache {
  entries: UnderutilisingSheetEntry[];
  fetchedAt: number;
  error: string | null;
}

let cache: SheetCache | null = null;

function cell(row: string[], idx: number, fallback = ""): string {
  if (idx < 0) return fallback;
  const value = row[idx];
  if (value == null) return fallback;
  return String(value).trim();
}

function colIndex(headers: string[], ...needles: string[]): number {
  for (let i = 0; i < headers.length; i++) {
    const h = String(headers[i] ?? "")
      .replace(/\s+/g, " ")
      .trim();
    if (needles.some((n) => h.includes(n))) return i;
  }
  return -1;
}

function combineName(first: string, last: string): string {
  return `${first} ${last}`.replace(/\s+/g, " ").trim();
}

function is28DayNonUtilizer(status: string): boolean {
  return /28\s*day\s*non\s*utiliz/i.test(status);
}

function isDataRow(row: string[]): boolean {
  const joined = row.join(" ").trim();
  if (!joined) return false;
  if (/^,+$/.test(joined.replace(/\s/g, ""))) return false;
  return true;
}

/** Parse HubSpot utilization tab — 28-day non-utilizers only */
export function parseUnderutilisingSheetRows(
  rows: string[][]
): UnderutilisingSheetEntry[] {
  if (rows.length < 2) return [];

  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const joined = rows[i].join(" ").toLowerCase();
    if (joined.includes("utilization status") && joined.includes("first name")) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) return [];

  const headers = rows[headerIdx].map((h) =>
    String(h ?? "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim()
  );

  const iFirst = colIndex(headers, "first name");
  const iLast = colIndex(headers, "last name");
  const iEmail = colIndex(headers, "email");
  const iCity = colIndex(headers, "serving city", "city");
  const iStatus = colIndex(headers, "utilization status");

  const entries: UnderutilisingSheetEntry[] = [];
  const seen = new Set<string>();

  for (const row of rows.slice(headerIdx + 1)) {
    if (!isDataRow(row)) continue;

    const first = cell(row, iFirst, cell(row, 0));
    const last = cell(row, iLast, cell(row, 1));
    const displayName = combineName(first, last);
    if (!displayName || displayName.length < 2) continue;

    const status = cell(
      row,
      iStatus,
      row.length > 0 ? cell(row, row.length - 1) : ""
    );
    if (!is28DayNonUtilizer(status)) continue;

    const emailRaw = cell(row, iEmail);
    const email = emailRaw && emailRaw.includes("@") ? emailRaw : null;
    const city = cell(row, iCity) || null;

    const key = email?.toLowerCase() ?? displayName.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    entries.push({ displayName, email, city, utilizationStatus: status });
  }

  return entries;
}

export function sheetNameMatchesHubSpotClient(
  sheetName: string,
  hubspotClientName: string
): boolean {
  if (namesMatch(sheetName, hubspotClientName)) return true;
  const registry = getSacredRegistry();
  const sheetMatch = matchRegistryRecord(sheetName, registry);
  const hubMatch = matchRegistryRecord(hubspotClientName, registry);
  if (sheetMatch && hubMatch) return sheetMatch.id === hubMatch.id;

  const hubRecord = hubMatch ?? matchRegistryRecord(hubspotClientName, registry);
  if (hubRecord?.beneficiary) {
    const parts = hubRecord.beneficiary.split("/").map((p) => p.trim());
    if (parts.some((p) => namesMatch(sheetName, p))) return true;
  }

  return false;
}

export function sheetEntryMatchesHubSpotClient(
  entry: UnderutilisingSheetEntry,
  hubspotClientName: string,
  hubspotEmail: string | null
): boolean {
  if (
    hubspotEmail &&
    entry.email &&
    hubspotEmail.toLowerCase() === entry.email.toLowerCase()
  ) {
    return true;
  }
  return sheetNameMatchesHubSpotClient(entry.displayName, hubspotClientName);
}

export function isOnUnderutilisingSheet(
  hubspotClientName: string,
  sheetEntries: UnderutilisingSheetEntry[],
  hubspotEmail: string | null = null
): boolean {
  return sheetEntries.some((entry) =>
    sheetEntryMatchesHubSpotClient(entry, hubspotClientName, hubspotEmail)
  );
}

/** The engagement calendar is force-dynamic — without this, every page view
 *  re-fetches the sheet even though it's a "hint only" cross-check signal. */
const FRESH_MS = 5 * 60 * 1000;

export async function refreshUnderutilisingSheetCache(force = false): Promise<void> {
  if (!isUnderutilisingSheetConfigured()) {
    cache = { entries: [], fetchedAt: Date.now(), error: null };
    return;
  }

  if (!force && cache && Date.now() - cache.fetchedAt < FRESH_MS) return;

  try {
    const rows = await fetchGoogleSheetRowsByGid(
      getUnderutilisingSheetId(),
      getUnderutilisingSheetGid(),
      getUnderutilisingSheetPublishUrl()
    );
    cache = {
      entries: parseUnderutilisingSheetRows(rows),
      fetchedAt: Date.now(),
      error: null,
    };
  } catch (e) {
    cache = {
      entries: cache?.entries ?? [],
      fetchedAt: Date.now(),
      error: e instanceof Error ? e.message : "Underutilising sheet fetch failed",
    };
  }
}

export function invalidateUnderutilisingSheetCache(): void {
  cache = null;
}

export function getUnderutilisingSheetEntries(): UnderutilisingSheetEntry[] | null {
  if (!isUnderutilisingSheetConfigured()) return null;
  return cache?.entries ?? null;
}

/** @deprecated use getUnderutilisingSheetEntries */
export function getUnderutilisingSheetBenefactors(): string[] | null {
  const entries = getUnderutilisingSheetEntries();
  if (!entries) return null;
  return entries.map((e) => e.displayName);
}

export function getUnderutilisingSheetMeta(): {
  configured: boolean;
  lastFetchedAt: string | null;
  error: string | null;
  count: number;
} {
  if (!isUnderutilisingSheetConfigured()) {
    return { configured: false, lastFetchedAt: null, error: null, count: 0 };
  }
  return {
    configured: true,
    lastFetchedAt: cache ? new Date(cache.fetchedAt).toISOString() : null,
    error: cache?.error ?? null,
    count: cache?.entries.length ?? 0,
  };
}

export function buildUnderutilisingCrossCheck(
  hubspotUnderutilisingClients: Array<{ client: string; email: string | null }>,
  sheetEntries: UnderutilisingSheetEntry[] | null
): UnderutilisingSheetCrossCheck {
  if (!sheetEntries) {
    return {
      configured: false,
      sheetCount: 0,
      matched: 0,
      hubspotOnly: 0,
      sheetOnly: 0,
      lastFetchedAt: null,
      error: null,
    };
  }

  const meta = getUnderutilisingSheetMeta();
  const matchedHubspot = new Set<string>();
  const matchedSheet = new Set<string>();

  for (const { client, email } of hubspotUnderutilisingClients) {
    const sheetHit = sheetEntries.find((entry) =>
      sheetEntryMatchesHubSpotClient(entry, client, email)
    );
    if (sheetHit) {
      matchedHubspot.add(client);
      matchedSheet.add(sheetHit.email ?? sheetHit.displayName);
    }
  }

  const sheetOnly = sheetEntries.filter(
    (entry) => !matchedSheet.has(entry.email ?? entry.displayName)
  ).length;
  const hubspotOnly = hubspotUnderutilisingClients.filter(
    ({ client }) => !matchedHubspot.has(client)
  ).length;

  return {
    configured: true,
    sheetCount: sheetEntries.length,
    matched: matchedHubspot.size,
    hubspotOnly,
    sheetOnly,
    lastFetchedAt: meta.lastFetchedAt,
    error: meta.error,
  };
}
