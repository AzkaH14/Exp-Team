import "server-only";
import { writeFileSync } from "fs";
import { join } from "path";
import { isExcludedHubSpotContact } from "../client-registry/hubspot-blocklist";
import { getHubSpotBirthdayForClient } from "../client-registry/hubspot-birthdays";
import { matchRegistryRecord } from "../client-registry/name-match";
import { getSacredRegistry } from "../client-registry/store";
import type {
  ClientRegistryRecord,
  HubSpotNoteEntry,
  HubSpotNotesRecord,
} from "../types/client-registry";

const HUBSPOT_API = "https://api.hubapi.com";
const OUT_PATH = join(process.cwd(), "src/data/hubspot-notes.json");
const BATCH_SIZE = 100;

interface ContactRow {
  id: string;
  benefactor_name: string;
}

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

export function stripHubSpotNoteHtml(raw: string): string {
  return raw
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<li>/gi, "• ")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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

async function fetchContactsWithIds(): Promise<ContactRow[]> {
  const rows: ContactRow[] = [];
  let after: string | undefined;

  do {
    const body: Record<string, unknown> = {
      filterGroups: [
        {
          filters: [{ propertyName: "benefactor_name", operator: "HAS_PROPERTY" }],
        },
      ],
      properties: ["benefactor_name"],
      limit: 100,
    };
    if (after) body.after = after;

    const res = await hubspotFetch("/crm/v3/objects/contacts/search", {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`HubSpot contacts search failed: ${res.status}`);
    }

    const data = (await res.json()) as {
      results?: Array<{ id: string; properties: Record<string, string | null> }>;
      paging?: { next?: { after?: string } };
    };

    for (const row of data.results ?? []) {
      const benefactor_name = (row.properties.benefactor_name ?? "").trim();
      if (!benefactor_name || isExcludedHubSpotContact(benefactor_name)) continue;
      rows.push({ id: row.id, benefactor_name });
    }

    after = data.paging?.next?.after;
  } while (after);

  return rows;
}

async function fetchAssociatedObjectIds(
  contactIds: string[],
  associationType: "notes" | "meetings"
): Promise<Map<string, string[]>> {
  const byContact = new Map<string, string[]>();

  for (const batch of chunk(contactIds, BATCH_SIZE)) {
    const res = await hubspotFetch(
      `/crm/v4/associations/contacts/${associationType}/batch/read`,
      {
        method: "POST",
        body: JSON.stringify({
          inputs: batch.map((id) => ({ id })),
        }),
      }
    );

    if (!res.ok) {
      const text = await res.text();
      // Some portals may not expose meetings associations — skip quietly.
      if (res.status === 404 || /Unable to infer/i.test(text)) continue;
      throw new Error(
        `HubSpot contact→${associationType} associations failed: ${res.status}`
      );
    }

    const data = (await res.json()) as {
      results?: Array<{
        from: { id: string };
        to: Array<{ toObjectId: string | number }>;
      }>;
    };

    for (const row of data.results ?? []) {
      const contactId = row.from.id;
      const ids = (row.to ?? []).map((t) => String(t.toObjectId));
      if (!ids.length) continue;
      const prev = byContact.get(contactId) ?? [];
      byContact.set(contactId, [...prev, ...ids]);
    }
  }

  return byContact;
}

export async function fetchNoteBodies(
  noteIds: string[]
): Promise<Map<string, { body: string; createdAt: string | null; title?: string | null }>> {
  const map = new Map<
    string,
    { body: string; createdAt: string | null; title?: string | null }
  >();
  const unique = [...new Set(noteIds)];

  for (const batch of chunk(unique, BATCH_SIZE)) {
    const res = await hubspotFetch("/crm/v3/objects/notes/batch/read", {
      method: "POST",
      body: JSON.stringify({
        properties: ["hs_note_body", "hs_timestamp", "hs_createdate"],
        inputs: batch.map((id) => ({ id })),
      }),
    });

    if (!res.ok) {
      throw new Error(`HubSpot notes batch read failed: ${res.status}`);
    }

    const data = (await res.json()) as {
      results?: Array<{
        id: string;
        properties: Record<string, string | null>;
      }>;
    };

    for (const row of data.results ?? []) {
      const rawBody = row.properties.hs_note_body ?? "";
      const body = stripHubSpotNoteHtml(rawBody);
      if (!body) continue;
      const createdAt =
        row.properties.hs_timestamp ?? row.properties.hs_createdate ?? null;
      map.set(row.id, { body, createdAt });
    }
  }

  return map;
}

async function fetchMeetingBodies(
  meetingIds: string[]
): Promise<Map<string, { body: string; createdAt: string | null; title: string | null }>> {
  const map = new Map<
    string,
    { body: string; createdAt: string | null; title: string | null }
  >();
  const unique = [...new Set(meetingIds)];
  if (!unique.length) return map;

  for (const batch of chunk(unique, BATCH_SIZE)) {
    const res = await hubspotFetch("/crm/v3/objects/meetings/batch/read", {
      method: "POST",
      body: JSON.stringify({
        properties: [
          "hs_meeting_title",
          "hs_meeting_body",
          "hs_internal_meeting_notes",
          "hs_timestamp",
          "hs_createdate",
        ],
        inputs: batch.map((id) => ({ id })),
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      if (res.status === 404) continue;
      throw new Error(
        `HubSpot meetings batch read failed: ${res.status} ${text.slice(0, 120)}`
      );
    }

    const data = (await res.json()) as {
      results?: Array<{
        id: string;
        properties: Record<string, string | null>;
      }>;
    };

    for (const row of data.results ?? []) {
      const title = (row.properties.hs_meeting_title ?? "").trim() || null;
      const raw = [
        title,
        row.properties.hs_meeting_body,
        row.properties.hs_internal_meeting_notes,
      ]
        .filter(Boolean)
        .join("\n");
      const body = stripHubSpotNoteHtml(raw);
      if (!body) continue;
      const createdAt =
        row.properties.hs_timestamp ?? row.properties.hs_createdate ?? null;
      map.set(row.id, { body, createdAt, title });
    }
  }

  return map;
}

export function mergeEngagementNotes(
  internal: string[],
  hubspot: HubSpotNoteEntry[],
  override?: string
): string[] {
  const out: string[] = [];
  const seen: string[] = [];

  const isDuplicate = (trimmed: string): boolean => {
    const key = trimmed.toLowerCase();
    for (const prev of seen) {
      const pk = prev.toLowerCase();
      if (pk === key) return true;
      if (pk.length > 80 && key.length > 80) {
        if (pk.slice(0, 80) === key.slice(0, 80)) return true;
      }
      if (pk.includes(key) || key.includes(pk)) {
        const shorter = Math.min(pk.length, key.length);
        const longer = Math.max(pk.length, key.length);
        if (shorter / longer > 0.85) return true;
      }
    }
    return false;
  };

  const add = (note: string) => {
    const trimmed = note.trim();
    if (!trimmed || isDuplicate(trimmed)) return;
    seen.push(trimmed);
    out.push(trimmed);
  };

  if (override) add(override);
  for (const note of internal) add(note);
  for (const note of hubspot) add(note.body);

  return out;
}

function beneficiaryNamesForFamily(match: ClientRegistryRecord): string[] {
  const names = new Set<string>();
  const registryBeneficiary = match.beneficiary?.trim();
  if (registryBeneficiary && registryBeneficiary.toUpperCase() !== "TBC") {
    for (const part of registryBeneficiary.split("/")) {
      const name = part.replace(/·.+$/, "").trim();
      if (name) names.add(name);
    }
  }

  const hubspot = getHubSpotBirthdayForClient(match.id);
  for (const b of hubspot?.beneficiaries ?? []) {
    const name = b.name?.trim();
    if (name) names.add(name);
  }

  return [...names];
}

function buildFamilyNoteRecords(
  contacts: ContactRow[],
  noteIdsByContact: Map<string, string[]>,
  meetingIdsByContact: Map<string, string[]>,
  noteBodies: Map<string, { body: string; createdAt: string | null }>,
  meetingBodies: Map<
    string,
    { body: string; createdAt: string | null; title: string | null }
  >
): HubSpotNotesRecord[] {
  const registry = getSacredRegistry();
  const contactsByFamily = new Map<string, string[]>();

  for (const contact of contacts) {
    const prev = contactsByFamily.get(contact.benefactor_name) ?? [];
    prev.push(contact.id);
    contactsByFamily.set(contact.benefactor_name, prev);
  }

  const records: HubSpotNotesRecord[] = [];

  for (const [hubspotKey, contactIds] of contactsByFamily) {
    const match =
      matchRegistryRecord(hubspotKey, registry) ??
      matchRegistryRecord(hubspotKey.replace(/\s+/g, ""), registry);
    if (!match) continue;

    const noteIdSet = new Set<string>();
    const meetingIdSet = new Set<string>();
    for (const contactId of contactIds) {
      for (const noteId of noteIdsByContact.get(contactId) ?? []) {
        noteIdSet.add(noteId);
      }
      for (const meetingId of meetingIdsByContact.get(contactId) ?? []) {
        meetingIdSet.add(meetingId);
      }
    }

    const notes: HubSpotNoteEntry[] = [];
    for (const noteId of noteIdSet) {
      const body = noteBodies.get(noteId);
      if (!body) continue;
      notes.push({
        id: noteId,
        body: body.body,
        createdAt: body.createdAt,
        source: "note",
      });
    }
    for (const meetingId of meetingIdSet) {
      const body = meetingBodies.get(meetingId);
      if (!body) continue;
      notes.push({
        id: `meeting:${meetingId}`,
        body: body.body,
        createdAt: body.createdAt,
        source: "meeting",
        title: body.title,
      });
    }

    notes.sort((a, b) => {
      const ta = a.createdAt ? Date.parse(a.createdAt) : 0;
      const tb = b.createdAt ? Date.parse(b.createdAt) : 0;
      return tb - ta;
    });

    if (!notes.length) continue;

    records.push({
      id: match.id,
      benefactor: match.benefactor,
      hubspotKey,
      beneficiaryNames: beneficiaryNamesForFamily(match),
      notes,
    });
  }

  const byId = new Map<string, HubSpotNotesRecord>();
  for (const rec of records) {
    const existing = byId.get(rec.id);
    if (!existing) {
      byId.set(rec.id, rec);
      continue;
    }
    const seen = new Set(existing.notes.map((n) => n.id));
    for (const note of rec.notes) {
      if (seen.has(note.id)) continue;
      existing.notes.push(note);
      seen.add(note.id);
    }
    existing.beneficiaryNames = [
      ...new Set([
        ...(existing.beneficiaryNames ?? []),
        ...(rec.beneficiaryNames ?? []),
      ]),
    ];
    existing.notes.sort((a, b) => {
      const ta = a.createdAt ? Date.parse(a.createdAt) : 0;
      const tb = b.createdAt ? Date.parse(b.createdAt) : 0;
      return tb - ta;
    });
  }

  return [...byId.values()].sort((a, b) => a.benefactor.localeCompare(b.benefactor));
}

export async function syncHubSpotNotes(): Promise<{
  records: HubSpotNotesRecord[];
  summary: {
    hubspotFamilies: number;
    matchedSacredClients: number;
    withNotes: number;
    totalNotes: number;
    meetingNotes: number;
  };
}> {
  const contacts = await fetchContactsWithIds();
  const familyKeys = new Set(contacts.map((c) => c.benefactor_name));
  const contactIds = contacts.map((c) => c.id);

  const [noteIdsByContact, meetingIdsByContact] = await Promise.all([
    fetchAssociatedObjectIds(contactIds, "notes"),
    fetchAssociatedObjectIds(contactIds, "meetings"),
  ]);

  const allNoteIds = new Set<string>();
  for (const ids of noteIdsByContact.values()) {
    for (const id of ids) allNoteIds.add(id);
  }
  const allMeetingIds = new Set<string>();
  for (const ids of meetingIdsByContact.values()) {
    for (const id of ids) allMeetingIds.add(id);
  }

  const [noteBodies, meetingBodies] = await Promise.all([
    fetchNoteBodies([...allNoteIds]),
    fetchMeetingBodies([...allMeetingIds]),
  ]);

  const records = buildFamilyNoteRecords(
    contacts,
    noteIdsByContact,
    meetingIdsByContact,
    noteBodies,
    meetingBodies
  );

  const meetingNotes = records.reduce(
    (sum, r) => sum + r.notes.filter((n) => n.source === "meeting").length,
    0
  );

  const summary = {
    hubspotFamilies: familyKeys.size,
    matchedSacredClients: records.length,
    withNotes: records.filter((r) => r.notes.length > 0).length,
    totalNotes: records.reduce((sum, r) => sum + r.notes.length, 0),
    meetingNotes,
  };

  const payload = {
    syncedAt: new Date().toISOString(),
    summary,
    clients: records,
  };

  writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2));

  return { records, summary };
}

export function isHubSpotNotesConfigured(): boolean {
  return Boolean(getToken());
}
