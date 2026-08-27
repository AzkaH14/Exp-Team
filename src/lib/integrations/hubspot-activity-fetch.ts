import "server-only";
import { stripHubSpotNoteHtml } from "./hubspot-notes-sync";

const HUBSPOT_API = "https://api.hubapi.com";
const BATCH_SIZE = 100;
const ENGAGEMENT_CONCURRENCY = 12;

export interface TicketActivityText {
  id: string;
  source: string;
  body: string;
  createdAt: string | null;
}

interface ObjectReaderConfig {
  associationType: string;
  objectType: string;
  properties: string[];
  composeBody: (props: Record<string, string | null>) => string;
  timestampKeys: string[];
}

const CRM_ACTIVITY_READERS: ObjectReaderConfig[] = [
  {
    associationType: "notes",
    objectType: "notes",
    properties: ["hs_note_body", "hs_timestamp", "hs_createdate"],
    composeBody: (p) => p.hs_note_body ?? "",
    timestampKeys: ["hs_timestamp", "hs_createdate"],
  },
  {
    associationType: "calls",
    objectType: "calls",
    properties: ["hs_call_body", "hs_call_title", "hs_timestamp", "hs_createdate"],
    composeBody: (p) => [p.hs_call_title, p.hs_call_body].filter(Boolean).join("\n"),
    timestampKeys: ["hs_timestamp", "hs_createdate"],
  },
  {
    associationType: "emails",
    objectType: "emails",
    properties: ["hs_email_subject", "hs_email_text", "hs_timestamp", "hs_createdate"],
    composeBody: (p) => [p.hs_email_subject, p.hs_email_text].filter(Boolean).join("\n"),
    timestampKeys: ["hs_timestamp", "hs_createdate"],
  },
  {
    associationType: "tasks",
    objectType: "tasks",
    properties: ["hs_task_body", "hs_task_subject", "hs_timestamp", "hs_createdate"],
    composeBody: (p) => [p.hs_task_subject, p.hs_task_body].filter(Boolean).join("\n"),
    timestampKeys: ["hs_timestamp", "hs_createdate"],
  },
  {
    associationType: "meetings",
    objectType: "meetings",
    properties: [
      "hs_meeting_title",
      "hs_meeting_body",
      "hs_internal_meeting_notes",
      "hs_timestamp",
      "hs_createdate",
    ],
    composeBody: (p) =>
      [p.hs_meeting_title, p.hs_meeting_body, p.hs_internal_meeting_notes]
        .filter(Boolean)
        .join("\n"),
    timestampKeys: ["hs_timestamp", "hs_createdate"],
  },
  {
    associationType: "communications",
    objectType: "communications",
    properties: ["hs_communication_body", "hs_timestamp", "hs_createdate"],
    composeBody: (p) => p.hs_communication_body ?? "",
    timestampKeys: ["hs_timestamp", "hs_createdate"],
  },
];

function getToken(): string | undefined {
  return process.env.HUBSPOT_ACCESS_TOKEN?.trim() || undefined;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

async function hubspotFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = getToken();
  if (!token) throw new Error("HubSpot not configured");

  return fetch(`${HUBSPOT_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

function normalizeBodyKey(body: string): string {
  return body.replace(/\s+/g, " ").trim().toLowerCase().slice(0, 240);
}

function addActivity(
  map: Map<string, TicketActivityText[]>,
  ticketId: string,
  activity: TicketActivityText
): void {
  const body = activity.body.trim();
  if (body.length < 8) return;

  const list = map.get(ticketId) ?? [];
  const key = normalizeBodyKey(body);
  if (list.some((item) => normalizeBodyKey(item.body) === key)) return;

  list.push(activity);
  map.set(ticketId, list);
}

async function fetchAssociatedObjectIds(
  ticketIds: string[],
  associationType: string
): Promise<Map<string, string[]>> {
  const byTicket = new Map<string, string[]>();
  if (!ticketIds.length) return byTicket;

  for (const batch of chunk(ticketIds, BATCH_SIZE)) {
    const res = await hubspotFetch(
      `/crm/v4/associations/tickets/${associationType}/batch/read`,
      {
        method: "POST",
        body: JSON.stringify({ inputs: batch.map((id) => ({ id })) }),
      }
    );

    if (!res.ok) {
      const text = await res.text();
      if (res.status === 404 || text.includes("Unable to infer")) continue;
      throw new Error(
        `HubSpot ticket→${associationType} associations failed: ${res.status} ${text.slice(0, 120)}`
      );
    }

    const data = (await res.json()) as {
      results?: Array<{
        from: { id: string };
        to: Array<{ toObjectId: string | number }>;
      }>;
    };

    for (const row of data.results ?? []) {
      const ids = (row.to ?? []).map((t) => String(t.toObjectId));
      if (!ids.length) continue;
      const prev = byTicket.get(row.from.id) ?? [];
      byTicket.set(row.from.id, [...prev, ...ids]);
    }
  }

  return byTicket;
}

async function fetchCrmObjectBodies(
  config: ObjectReaderConfig,
  objectIds: string[]
): Promise<Map<string, { body: string; createdAt: string | null }>> {
  const map = new Map<string, { body: string; createdAt: string | null }>();
  const unique = [...new Set(objectIds)];
  if (!unique.length) return map;

  for (const batch of chunk(unique, BATCH_SIZE)) {
    const res = await hubspotFetch(`/crm/v3/objects/${config.objectType}/batch/read`, {
      method: "POST",
      body: JSON.stringify({
        properties: config.properties,
        inputs: batch.map((id) => ({ id })),
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      if (res.status === 404) continue;
      throw new Error(
        `HubSpot ${config.objectType} batch read failed: ${res.status} ${text.slice(0, 120)}`
      );
    }

    const data = (await res.json()) as {
      results?: Array<{ id: string; properties: Record<string, string | null> }>;
    };

    for (const row of data.results ?? []) {
      const raw = config.composeBody(row.properties);
      const body = stripHubSpotNoteHtml(raw);
      if (!body) continue;
      const createdAt =
        config.timestampKeys.map((k) => row.properties[k]).find(Boolean) ?? null;
      map.set(row.id, { body, createdAt });
    }
  }

  return map;
}

interface LegacyEngagementRow {
  engagement?: { id?: number | string; type?: string; timestamp?: number };
  metadata?: Record<string, string | null | undefined>;
}

function extractLegacyEngagementText(row: LegacyEngagementRow): TicketActivityText | null {
  const eng = row.engagement;
  const meta = row.metadata ?? {};
  const type = (eng?.type ?? "UNKNOWN").toUpperCase();
  let raw = "";

  switch (type) {
    case "NOTE":
      raw = meta.body ?? "";
      break;
    case "CALL":
      raw = [meta.title, meta.body, meta.disposition].filter(Boolean).join("\n");
      break;
    case "TASK":
      raw = [meta.subject, meta.body].filter(Boolean).join("\n");
      break;
    case "EMAIL":
    case "INCOMING_EMAIL":
    case "FORWARDED_EMAIL":
      raw = [meta.subject, meta.text, meta.html].filter(Boolean).join("\n");
      break;
    case "MEETING":
      raw = [meta.title, meta.body, meta.internalMeetingNotes].filter(Boolean).join("\n");
      break;
    default:
      raw = meta.body ?? meta.text ?? meta.html ?? "";
  }

  const body = stripHubSpotNoteHtml(String(raw));
  if (!body || body.length < 8) return null;

  return {
    id: `legacy-${type}-${eng?.id ?? Math.random().toString(36).slice(2)}`,
    source: `legacy:${type.toLowerCase()}`,
    body,
    createdAt:
      typeof eng?.timestamp === "number"
        ? new Date(eng.timestamp).toISOString()
        : null,
  };
}

async function fetchLegacyEngagementsForTicket(
  ticketId: string
): Promise<TicketActivityText[]> {
  const out: TicketActivityText[] = [];
  let offset: number | undefined;
  let hasMore = true;
  let guard = 0;

  while (hasMore && guard < 8) {
    guard += 1;
    const qs = new URLSearchParams({ limit: "100" });
    if (offset !== undefined) qs.set("offset", String(offset));

    const res = await hubspotFetch(
      `/engagements/v1/engagements/associated/TICKET/${ticketId}/paged?${qs}`
    );
    if (!res.ok) break;

    const data = (await res.json()) as {
      results?: LegacyEngagementRow[];
      hasMore?: boolean;
      offset?: number;
    };

    for (const row of data.results ?? []) {
      const activity = extractLegacyEngagementText(row);
      if (activity) out.push(activity);
    }

    hasMore = Boolean(data.hasMore);
    offset = data.offset;
    if (!hasMore) break;
  }

  return out;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  );
  return results;
}

async function fetchCrmActivitiesForTickets(
  ticketIds: string[]
): Promise<Map<string, TicketActivityText[]>> {
  const byTicket = new Map<string, TicketActivityText[]>();

  for (const reader of CRM_ACTIVITY_READERS) {
    const associated = await fetchAssociatedObjectIds(ticketIds, reader.associationType);
    const allObjectIds = new Set<string>();
    for (const ids of associated.values()) {
      for (const id of ids) allObjectIds.add(id);
    }
    if (!allObjectIds.size) continue;

    const bodies = await fetchCrmObjectBodies(reader, [...allObjectIds]);

    for (const [ticketId, objectIds] of associated) {
      for (const objectId of objectIds) {
        const hit = bodies.get(objectId);
        if (!hit) continue;
        addActivity(byTicket, ticketId, {
          id: `${reader.objectType}-${objectId}`,
          source: reader.objectType,
          body: hit.body,
          createdAt: hit.createdAt,
        });
      }
    }
  }

  return byTicket;
}

async function fetchLegacyActivitiesForTickets(
  ticketIds: string[]
): Promise<Map<string, TicketActivityText[]>> {
  const byTicket = new Map<string, TicketActivityText[]>();
  const pairs = await mapWithConcurrency(ticketIds, ENGAGEMENT_CONCURRENCY, async (ticketId) => {
    const activities = await fetchLegacyEngagementsForTicket(ticketId);
    return { ticketId, activities };
  });

  for (const { ticketId, activities } of pairs) {
    for (const activity of activities) {
      addActivity(byTicket, ticketId, activity);
    }
  }

  return byTicket;
}

function sortActivities(list: TicketActivityText[]): TicketActivityText[] {
  return [...list].sort((a, b) => {
    const ta = a.createdAt ? Date.parse(a.createdAt) : 0;
    const tb = b.createdAt ? Date.parse(b.createdAt) : 0;
    return ta - tb;
  });
}

/** Pull all ticket-timeline text: CRM notes/calls/emails/tasks + legacy engagements API. */
export async function fetchTicketActivities(
  ticketIds: string[]
): Promise<Map<string, TicketActivityText[]>> {
  const uniqueIds = [...new Set(ticketIds)];
  const merged = new Map<string, TicketActivityText[]>();

  const crm = await fetchCrmActivitiesForTickets(uniqueIds);
  for (const [ticketId, activities] of crm) {
    for (const activity of activities) {
      addActivity(merged, ticketId, activity);
    }
  }

  const missing = uniqueIds.filter((id) => !(merged.get(id)?.length ?? 0));
  if (missing.length) {
    const legacy = await fetchLegacyActivitiesForTickets(missing);
    for (const [ticketId, activities] of legacy) {
      for (const activity of activities) {
        addActivity(merged, ticketId, activity);
      }
    }
  }

  for (const [ticketId, activities] of merged) {
    merged.set(ticketId, sortActivities(activities));
  }

  return merged;
}

export function isHubSpotActivityFetchConfigured(): boolean {
  return Boolean(getToken());
}
