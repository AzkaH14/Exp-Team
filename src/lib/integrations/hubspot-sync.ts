import "server-only";
import { writeFileSync } from "fs";
import { join } from "path";
import type { AnalyticsData } from "../analytics-data";
import {
  buildAnalyticsFromTickets,
  parseSyncSinceMs,
} from "../analytics-build";
import { isExcludedHubSpotContact } from "../client-registry/hubspot-blocklist";
import { getSacredRegistry } from "../client-registry/store";
import {
  buildRegistryCanonicalMap,
  canonicalizeHubSpotClientName,
  canonicalizeHubSpotClientNameFast,
  formatHubSpotBenefactorLabel,
  matchRegistryRecord,
} from "../client-registry/name-match";
import type { Ticket } from "../types/ticket";
import {
  attachInsightNotesToTickets,
  isHubSpotTicketNotesConfigured,
  syncTicketInsightNotes,
} from "./hubspot-ticket-notes-sync";
import { setTicketInsightNotesCache } from "../ticket-insight-notes";
import { stripEmptyHubSpotFormFields } from "../hubspot-description";

const HUBSPOT_API = "https://api.hubapi.com";
const TICKETS_JSON_PATH = join(process.cwd(), "src/data/tickets.json");
const ANALYTICS_JSON_PATH = join(process.cwd(), "src/data/analytics.json");

export { buildAnalyticsFromTickets, isBundledHubSpotAnalytics } from "../analytics-build";

export const TICKET_PROPERTIES = [
  "subject",
  "content",
  "ticket_category",
  "ticket_sub_category",
  "serving_city",
  "benefactor_name",
  "benefactor_email",
  "hs_all_associated_contact_firstnames",
  "hs_all_associated_contact_emails",
  "createdate",
  "closed_date",
  "hs_ticket_priority",
  "hs_pipeline_stage",
  "special_requests__notes",
  "any_other_requirementnotes",
  "doctor_name",
  "type_of_session",
  "session_frequency",
] as const;

const CATEGORY_COLUMNS = [
  "Errand Services/Non-emergency services",
  "Medical Errands (non-emergency)",
  "Healthcare Services",
  "Psychologist Call",
  "Experience",
  "Domestic Services",
  "Onboarding",
  "Travel Services",
  "Internal Information Request",
  "Emergency Services",
  "Customer Complaints",
  "Offboarding",
  "Unspecified",
] as const;

interface HubSpotTicketRow {
  id: string;
  properties: Record<string, string | null>;
}

function getToken(): string | undefined {
  return process.env.HUBSPOT_ACCESS_TOKEN?.trim() || undefined;
}

function formatDisplayDate(iso: string): string {
  if (!iso) return "";
  try {
    const dt = new Date(iso);
    return dt.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "Asia/Karachi",
    });
  } catch {
    return iso;
  }
}

function formatMonth(iso: string): string {
  if (!iso) return "";
  try {
    const dt = new Date(iso);
    return dt.toLocaleDateString("en-GB", {
      month: "short",
      year: "numeric",
      timeZone: "Asia/Karachi",
    });
  } catch {
    return "";
  }
}

function normalizeClientName(name: string): string {
  return name.replace(/\s+/g, " ").trim();
}

export function mapHubSpotTicketToDashboard(row: HubSpotTicketRow): Ticket {
  const p = row.properties;
  const id = row.id;
  const created = p.createdate ?? "";
  const closed = p.closed_date ?? "";
  const catFull = p.ticket_category ?? "";
  const catShort = catFull ? catFull.split(/[\s/]/)[0] : "";

  let email = p.benefactor_email ?? p.hs_all_associated_contact_emails ?? "";
  if (email.includes(";")) email = email.split(";")[0].trim();

  const clientRaw =
    p.benefactor_name ??
    p.hs_all_associated_contact_firstnames ??
  "";
  const client = formatHubSpotBenefactorLabel(clientRaw);

  const priority = (p.hs_ticket_priority ?? "normal").toLowerCase();

  const hubspotFieldNotes = [
    p.special_requests__notes,
    p.any_other_requirementnotes,
  ]
    .map((value) => stripEmptyHubSpotFormFields(value ?? "").trim())
    .filter((value) => value.length > 20);

  return {
    id,
    ticketNumber: `MOH-${id.slice(-5)}`,
    client,
    email: email && email.includes("@") ? email : null,
    city: p.serving_city ?? "Other",
    category: catShort,
    categoryFull: catFull || "Unspecified",
    subCategory: p.ticket_sub_category ?? "",
    name: p.subject ?? "",
    description: stripEmptyHubSpotFormFields(p.content ?? ""),
    hubspotFieldNotes: hubspotFieldNotes.length ? hubspotFieldNotes : undefined,
    created: formatDisplayDate(created),
    closed: formatDisplayDate(closed),
    month: formatMonth(created),
    priority: priority === "urgent" || priority === "high" ? "urgent" : "normal",
  };
}

const FETCH_TIMEOUT_MS = 60_000;
const PAGE_DELAY_MS = 150;

async function hubspotSearch<T>(
  path: string,
  body: Record<string, unknown>
): Promise<T> {
  const token = getToken();
  if (!token) throw new Error("HUBSPOT_ACCESS_TOKEN not configured");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${HUBSPOT_API}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error("HubSpot request timed out");
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HubSpot API ${res.status}: ${text.slice(0, 200)}`);
  }

  return res.json() as Promise<T>;
}

export async function fetchAllHubSpotTickets(): Promise<Ticket[]> {
  const since = parseSyncSinceMs();
  const all: Ticket[] = [];
  let after: string | undefined;

  do {
    const body: Record<string, unknown> = {
      filterGroups: [
        {
          filters: [
            {
              propertyName: "createdate",
              operator: "GTE",
              value: String(since),
            },
          ],
        },
      ],
      properties: [...TICKET_PROPERTIES],
      limit: 100,
      sorts: [{ propertyName: "createdate", direction: "DESCENDING" }],
    };
    if (after) body.after = after;

    const page = await hubspotSearch<{
      results: HubSpotTicketRow[];
      paging?: { next?: { after: string } };
    }>("/crm/v3/objects/tickets/search", body);

    for (const row of page.results ?? []) {
      all.push(mapHubSpotTicketToDashboard(row));
    }
    after = page.paging?.next?.after;
    if (after && PAGE_DELAY_MS > 0) {
      await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
    }
  } while (after);

  return all;
}

export function normalizeTicketsByRegistry(tickets: Ticket[]): Ticket[] {
  const registry = getSacredRegistry();
  const exactMap = buildRegistryCanonicalMap(registry);

  // canonicalizeHubSpotClientNameFast falls back to a fuzzy registry scan when
  // the exact keys miss. Thousands of tickets share ~130 distinct client names,
  // so memoize per name — otherwise every miss pays that scan again.
  const memo = new Map<string, string>();

  return tickets.map((t) => {
    let canonical = memo.get(t.client);
    if (canonical === undefined) {
      canonical = canonicalizeHubSpotClientNameFast(t.client, exactMap, registry);
      memo.set(t.client, canonical);
    }
    return canonical === t.client ? t : { ...t, client: canonical };
  });
}
function filterTicketsByRegistry(tickets: Ticket[]): Ticket[] {
  const strict = process.env.CLIENT_REGISTRY_FILTER !== "false";
  const registry = getSacredRegistry();
  const normalized = normalizeTicketsByRegistry(tickets);

  if (!strict) return normalized;

  return normalized.filter((t) => {
    if (isExcludedHubSpotContact(t.client)) return false;
    return matchRegistryRecord(t.client, registry) !== null;
  });
}

export async function syncHubSpotData(): Promise<{
  tickets: Ticket[];
  analytics: AnalyticsData;
}> {
  const raw = await fetchAllHubSpotTickets();
  let tickets = filterTicketsByRegistry(raw);

  if (isHubSpotTicketNotesConfigured()) {
    try {
      const { byTicketId, summary } = await syncTicketInsightNotes(tickets);
      setTicketInsightNotesCache(byTicketId);
      tickets = attachInsightNotesToTickets(tickets, byTicketId);
      console.info(
        `HubSpot ticket notes: ${summary.ticketsWithNotes} tickets, ${summary.totalNotes} insight notes (${JSON.stringify(summary.bySource ?? {})})`
      );
    } catch (e) {
      console.warn("HubSpot ticket notes sync failed:", e);
    }
  }

  const analytics = buildAnalyticsFromTickets(tickets);
  const analyticsExport = {
    ...analytics,
    exportedAt: new Date().toISOString(),
  };
  try {
    writeFileSync(TICKETS_JSON_PATH, JSON.stringify(tickets, null, 0));
    writeFileSync(ANALYTICS_JSON_PATH, JSON.stringify(analyticsExport, null, 2));
  } catch (e) {
    console.warn("Could not persist tickets.json / analytics.json:", e);
  }
  return { tickets, analytics: analyticsExport };
}

export function isHubSpotConfigured(): boolean {
  return Boolean(getToken());
}
