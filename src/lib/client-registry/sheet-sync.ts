import "server-only";
import { writeFileSync } from "fs";
import { join } from "path";
import supplementJson from "@/data/client-registry-supplement.json";
import {
  fetchSacredSheetRows,
  getSacredSheetId,
  isGoogleSheetsConfigured,
} from "../integrations/google-sheets";
import { filterSacredRegistryClients, isExcludedHubSpotContact } from "./hubspot-blocklist";
import { matchRegistryRecord, namesMatch, slugFromBenefactor } from "./name-match";
import type {
  ClientRegistryRecord,
  ClientRegistryStatus,
  ClientServiceTier,
} from "../types/client-registry";
import { buildRegistrySummary, setSacredRegistryCache } from "./store";
import {
  mohsynClientsToRegistry,
  parseMohsynSacredSheet,
} from "./parse-mohsyn-sheet";

const REGISTRY_PATH = join(process.cwd(), "src/data/client-registry.json");
const HUBSPOT_API = "https://api.hubapi.com";

interface SupplementFile {
  byBenefactor: Record<
    string,
    {
      aliases?: string[];
      canonicalBenefactor?: string;
      status?: ClientRegistryStatus;
      tier?: ClientServiceTier;
      beneficiary?: string;
      city?: ClientRegistryRecord["city"];
      contactEmails?: string[];
      engagementCities?: ClientRegistryRecord["city"][];
    }
  >;
}

export interface SheetSyncResult {
  ok: boolean;
  error?: string;
  sheetId: string;
  clientCount: number;
  summary: Record<string, unknown>;
  newFromHubSpot: Array<{
    benefactor: string;
    hubspotKey: string;
    city: string;
    signupDate: string | null;
    email: string | null;
  }>;
  sheetOnly: string[];
  hubspotOnly: string[];
}

function parseCity(raw: string | undefined): ClientRegistryRecord["city"] {
  const c = (raw ?? "").trim();
  if (/islamabad|rawalpindi/i.test(c)) return "Islamabad";
  if (/karachi/i.test(c)) return "Karachi";
  if (/lahore/i.test(c)) return "Lahore";
  if (/lodhran/i.test(c)) return "Lodhran";
  if (/gujranwala|gujran/i.test(c)) return "Gujranwala";
  if (/faisalabad|lyallpur/i.test(c)) return "Faisalabad";
  return "Other";
}

async function resolveServingCityFromTickets(
  token: string,
  query: string
): Promise<ClientRegistryRecord["city"] | null> {
  try {
    const res = await fetch(`${HUBSPOT_API}/crm/v3/objects/tickets/search`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        properties: ["serving_city", "subject", "benefactor_name"],
        limit: 20,
        sorts: [{ propertyName: "createdate", direction: "DESCENDING" }],
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      results?: Array<{ properties: Record<string, string | null> }>;
    };
    const counts = new Map<string, number>();
    const q = query.toLowerCase();
    for (const row of data.results ?? []) {
      const blob =
        `${row.properties.subject ?? ""} ${row.properties.benefactor_name ?? ""}`.toLowerCase();
      if (!blob.includes(q.split(/\s+/)[0] ?? q)) continue;
      const city = parseCity(row.properties.serving_city ?? undefined);
      if (city === "Other") continue;
      counts.set(city, (counts.get(city) ?? 0) + 1);
    }
    let best: ClientRegistryRecord["city"] | null = null;
    let bestCount = 0;
    for (const [city, n] of counts) {
      if (n > bestCount) {
        best = city as ClientRegistryRecord["city"];
        bestCount = n;
      }
    }
    return best;
  } catch {
    return null;
  }
}

function rowsToClients(rows: string[][]): Omit<ClientRegistryRecord, "id">[] {
  const supplement = (supplementJson as SupplementFile).byBenefactor ?? {};
  const parsed = parseMohsynSacredSheet(rows);
  return mohsynClientsToRegistry(parsed, supplement);
}

function isCancelledInSupplement(name: string): boolean {
  const byBenefactor = (supplementJson as SupplementFile).byBenefactor ?? {};
  for (const [key, entry] of Object.entries(byBenefactor)) {
    if (entry.status !== "cancelled") continue;
    if (namesMatch(key, name)) return true;
    if (entry.aliases?.some((a) => namesMatch(a, name))) return true;
  }
  return false;
}

async function fetchRecentHubSpotBenefactors(): Promise<
  Array<{
    hubspotKey: string;
    benefactor: string;
    city: string;
    email: string | null;
    signupDate: string | null;
  }>
> {
  const token = process.env.HUBSPOT_ACCESS_TOKEN?.trim();
  if (!token) return [];

  const res = await fetch(`${HUBSPOT_API}/crm/v3/objects/contacts/search`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      filterGroups: [
        {
          filters: [
            { propertyName: "is_benefactor", operator: "EQ", value: "true" },
            { propertyName: "benefactor_name", operator: "HAS_PROPERTY" },
          ],
        },
      ],
      properties: [
        "firstname",
        "lastname",
        "benefactor_name",
        "email",
        "city",
        "onboarding_date",
        "createdate",
      ],
      limit: 100,
      sorts: [{ propertyName: "createdate", direction: "DESCENDING" }],
    }),
  });

  if (!res.ok) return [];

  const data = (await res.json()) as {
    results?: Array<{ properties: Record<string, string | null> }>;
  };

  const out: Array<{
    hubspotKey: string;
    benefactor: string;
    city: string;
    email: string | null;
    signupDate: string | null;
  }> = [];

  for (const row of data.results ?? []) {
    const p = row.properties;
    const key = (p.benefactor_name ?? "").trim();
    if (!key || isExcludedHubSpotContact(key)) continue;
    if (isCancelledInSupplement(key) || isCancelledInSupplement(
      `${p.firstname ?? ""} ${p.lastname ?? ""}`.trim()
    )) {
      continue;
    }

    const name =
      `${p.firstname ?? ""} ${p.lastname ?? ""}`.trim() ||
      key.replace(/([a-z])([A-Z])/g, "$1 $2");

    let signup: string | null = null;
    const onboard = p.onboarding_date?.trim();
    if (onboard && /^\d{4}-\d{2}-\d{2}$/.test(onboard)) signup = onboard;

    let city = parseCity(p.city ?? undefined);
    if (city === "Other") {
      const fromTickets =
        (await resolveServingCityFromTickets(token, key)) ||
        (await resolveServingCityFromTickets(token, name));
      if (fromTickets) city = fromTickets;
    }

    out.push({
      hubspotKey: key,
      benefactor: name,
      city,
      email: p.email?.trim() || null,
      signupDate: signup,
    });
  }

  return out;
}

function mergeHubSpotNewClients(
  sheetClients: Omit<ClientRegistryRecord, "id">[],
  hubspotBenefactors: Awaited<ReturnType<typeof fetchRecentHubSpotBenefactors>>,
  autoAdd: boolean
): {
  clients: Omit<ClientRegistryRecord, "id">[];
  newFromHubSpot: SheetSyncResult["newFromHubSpot"];
  hubspotOnly: string[];
} {
  const records = [...sheetClients];
  const withIds = records.map((c) => ({
    ...c,
    id: slugFromBenefactor(c.benefactor),
  }));

  const newFromHubSpot: SheetSyncResult["newFromHubSpot"] = [];
  const hubspotOnly: string[] = [];

  for (const hs of hubspotBenefactors) {
    if (matchRegistryRecord(hs.hubspotKey, withIds as ClientRegistryRecord[])) continue;
    if (matchRegistryRecord(hs.benefactor, withIds as ClientRegistryRecord[])) continue;

    hubspotOnly.push(hs.hubspotKey);
    newFromHubSpot.push({
      benefactor: hs.benefactor,
      hubspotKey: hs.hubspotKey,
      city: hs.city,
      signupDate: hs.signupDate,
      email: hs.email,
    });

    if (autoAdd) {
      records.push({
        benefactor: hs.benefactor,
        beneficiary: "TBC",
        city: parseCity(hs.city),
        signupDate: hs.signupDate,
        serviceTier: "premium",
        status: "active",
        country: null,
        linkedin: null,
        biraUrl: null,
        aliases: [hs.hubspotKey],
        source: "sacred",
      });
    }
  }

  return { clients: records, newFromHubSpot, hubspotOnly };
}

export async function syncSacredRegistryFromSheet(options?: {
  autoAddHubSpot?: boolean;
  writeFile?: boolean;
}): Promise<SheetSyncResult> {
  const sheetId = getSacredSheetId();
  const autoAdd =
    options?.autoAddHubSpot ??
    process.env.SACRED_AUTO_ADD_HUBSPOT?.trim() !== "false";

  if (!isGoogleSheetsConfigured()) {
    return {
      ok: false,
      error:
        "Google Sheets not configured. Set GOOGLE_SHEETS_PUBLISH_CSV_URL in .env.local.",
      sheetId,
      clientCount: 0,
      summary: {},
      newFromHubSpot: [],
      sheetOnly: [],
      hubspotOnly: [],
    };
  }

  try {
    const rows = await fetchSacredSheetRows();
    let sheetClients = rowsToClients(rows);

    const hubspotBenefactors = await fetchRecentHubSpotBenefactors();
    const { clients, newFromHubSpot, hubspotOnly } = mergeHubSpotNewClients(
      sheetClients,
      hubspotBenefactors,
      autoAdd
    );

    const records: ClientRegistryRecord[] = filterSacredRegistryClients(
      clients.map((c) => ({
        ...c,
        id: slugFromBenefactor(c.benefactor),
      }))
    );

    const summary = {
      ...buildRegistrySummary(records),
      sheetRows: rows.length - 1,
      addedFromHubSpot: newFromHubSpot.filter((n) =>
        records.some((r) => r.benefactor === n.benefactor)
      ).length,
    };

    const payload = {
      version: 3,
      updatedAt: new Date().toISOString().slice(0, 10),
      source: `Google Sheet (live CSV)`,
      sheetUrl:
        process.env.GOOGLE_SHEETS_PUBLISH_CSV_URL ??
        `https://docs.google.com/spreadsheets/d/${sheetId}`,
      summary,
      clients: records,
    };

    // Keep the bundled JSON stable on Vercel — only refresh the in-memory registry.
    // Writing here rewrites client-registry.json on every Sync and looks like clients
    // are constantly being re-added/updated even when the sacred sheet already has them.
    const shouldWrite =
      options?.writeFile === true ||
      (options?.writeFile !== false && !process.env.VERCEL);

    if (shouldWrite) {
      writeFileSync(REGISTRY_PATH, JSON.stringify(payload, null, 2));
    }

    setSacredRegistryCache(records, summary);

    const sheetBenefactors = new Set(sheetClients.map((c) => c.benefactor));
    const sheetOnly = [...sheetBenefactors].filter(
      (b) => !hubspotBenefactors.some((h) => namesLooselyMatch(b, h.benefactor, h.hubspotKey))
    );

    return {
      ok: true,
      sheetId,
      clientCount: records.length,
      summary,
      newFromHubSpot,
      sheetOnly: sheetOnly.slice(0, 20),
      hubspotOnly: hubspotOnly.slice(0, 20),
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Sheet sync failed",
      sheetId,
      clientCount: 0,
      summary: {},
      newFromHubSpot: [],
      sheetOnly: [],
      hubspotOnly: [],
    };
  }
}

function namesLooselyMatch(sheetName: string, hsName: string, hsKey: string): boolean {
  return (
    matchRegistryRecord(sheetName, [
      {
        id: "x",
        benefactor: hsName,
        beneficiary: "",
        city: "Other",
        signupDate: null,
        serviceTier: "premium",
        status: "active",
        country: null,
        linkedin: null,
        biraUrl: null,
        aliases: [hsKey],
        source: "sacred",
      },
    ]) !== null
  );
}
