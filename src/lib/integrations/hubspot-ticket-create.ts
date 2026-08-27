import "server-only";
import type { ClientRegistryRecord } from "../types/client-registry";
import type { EngagementEvent } from "../types/engagement-calendar";
import { ENGAGEMENT_EVENT_TYPE_LABELS } from "../types/engagement-calendar";
import { getReportTicketIndex } from "../reports/ticket-index";
import { defaultDoctorForCity } from "../engagement/doctors";
import { resolveScheduleCity } from "../engagement/calendar-clients";
import { namesMatch } from "../client-registry/name-match";
import {
  clinicalOwnerDisplayName,
  engagementCoordinatorLabel,
  isClinicalEngagementEvent,
  resolveHubSpotTicketOwnerId,
} from "./hubspot-engagement-owners";

const HUBSPOT_API = "https://api.hubapi.com";

/** HubSpot association: note → ticket */
const NOTE_TO_TICKET_ASSOCIATION_TYPE_ID = 228;
/** HubSpot-defined ticket → contact */
const TICKET_TO_CONTACT_ASSOCIATION_TYPE_ID = 16;
/** User-defined ticket → contact labeled "Benefactor" (Mohsyn portal) */
const TICKET_TO_BENEFACTOR_ASSOCIATION_TYPE_ID = 23;

interface PipelineCache {
  pipelineId: string;
  openStageId: string;
  closedStageId: string;
  cancelledStageId: string;
  fetchedAt: number;
}

interface BenefactorContactMatch {
  id: string;
  benefactorName: string;
  email: string | null;
}

const globalCache = globalThis as unknown as {
  __mohsynHsPipeline?: PipelineCache;
};

function getToken(): string | undefined {
  return process.env.HUBSPOT_ACCESS_TOKEN?.trim() || undefined;
}

export function isHubSpotTicketCreateEnabled(): boolean {
  return (
    process.env.HUBSPOT_AUTO_CREATE_ENGAGEMENT_TICKETS === "true" &&
    Boolean(getToken())
  );
}

export function shouldAutoCreateHubSpotTicket(event: EngagementEvent): boolean {
  if (!isHubSpotTicketCreateEnabled()) return false;
  if (event.hubspotTicketId) return false;
  if (event.status === "cancelled") return false;
  return true;
}

function cityCode(city: string): string {
  if (city === "Islamabad") return "ISB";
  if (city === "Lahore") return "LHR";
  if (city === "Karachi") return "KHI";
  return city.replace(/\s+/g, "").slice(0, 3).toUpperCase() || "PK";
}

/**
 * HubSpot `serving_city` is an enum. Satellite home cities (Faisalabad, etc.)
 * must map to an engagement-team city (Lahore) or Other so ticket create does not 400.
 */
export function resolveHubSpotServingCity(
  record: ClientRegistryRecord,
  eventCity?: string | null
): string {
  return resolveScheduleCity(record, eventCity);
}

export function resolveHubSpotBenefactorName(record: ClientRegistryRecord): string {
  const tickets = getReportTicketIndex().byRegistryId.get(record.id) ?? [];
  if (tickets.length > 0) {
    const counts = new Map<string, number>();
    for (const t of tickets) {
      const key = t.client?.trim();
      if (!key) continue;
      // HubSpot stores benefactor_name mostly without spaces (e.g. NailaMakhdumi)
      const compact = key.replace(/\s+/g, "");
      counts.set(compact, (counts.get(compact) ?? 0) + 1);
    }
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (best) return best[0];
  }
  for (const alias of [record.benefactor, ...record.aliases]) {
    if (alias?.trim()) return alias.replace(/\s+/g, "");
  }
  return record.benefactor.replace(/\s+/g, "");
}

function benefactorNameCandidates(record: ClientRegistryRecord): string[] {
  const keys = new Set<string>();
  const add = (raw: string | null | undefined) => {
    const s = raw?.trim();
    if (!s) return;
    keys.add(s);
    keys.add(s.replace(/\s+/g, ""));
  };
  add(record.benefactor);
  for (const alias of record.aliases) add(alias);
  add(resolveHubSpotBenefactorName(record));
  for (const t of getReportTicketIndex().byRegistryId.get(record.id) ?? []) {
    add(t.client);
  }
  return [...keys].filter(Boolean);
}

function benefactorEmailCandidates(record: ClientRegistryRecord): string[] {
  const emails = new Set<string>();
  for (const email of record.contactEmails ?? []) {
    const normalized = email?.trim().toLowerCase();
    if (normalized?.includes("@")) emails.add(normalized);
  }
  for (const t of getReportTicketIndex().byRegistryId.get(record.id) ?? []) {
    const email = t.email?.trim().toLowerCase();
    if (email?.includes("@")) emails.add(email);
  }
  return [...emails];
}

/** Find the HubSpot contact that is this family's benefactor profile. */
export async function findHubSpotBenefactorContact(
  record: ClientRegistryRecord
): Promise<BenefactorContactMatch | null> {
  if (!getToken()) return null;

  // 1) Prefer contact already linked as Benefactor on a prior ticket for this family
  const priorTickets = getReportTicketIndex().byRegistryId.get(record.id) ?? [];
  for (const ticket of priorTickets.slice(0, 8)) {
    try {
      const assoc = await hubspotFetch<{
        results?: Array<{
          toObjectId?: string | number;
          associationTypes?: Array<{ typeId?: number; label?: string | null }>;
        }>;
      }>(`/crm/v4/objects/tickets/${ticket.id}/associations/contacts`);

      const rows = assoc.results ?? [];
      const benefactorRow =
        rows.find((r) =>
          r.associationTypes?.some(
            (t) =>
              t.typeId === TICKET_TO_BENEFACTOR_ASSOCIATION_TYPE_ID ||
              /^benefactor$/i.test(t.label ?? "")
          )
        ) ?? rows[0];
      if (!benefactorRow?.toObjectId) continue;

      const contactId = String(benefactorRow.toObjectId);
      const contact = await hubspotFetch<{
        id: string;
        properties: Record<string, string | null>;
      }>(
        `/crm/v3/objects/contacts/${contactId}?properties=email,benefactor_name,is_benefactor,firstname,lastname`
      );
      return {
        id: contact.id,
        benefactorName:
          (contact.properties.benefactor_name ?? "").trim() ||
          resolveHubSpotBenefactorName(record),
        email: (contact.properties.email ?? "").trim().toLowerCase() || null,
      };
    } catch (e) {
      console.warn(`Contact lookup via ticket ${ticket.id} failed:`, e);
    }
  }

  // 2) Search contacts by email / benefactor_name
  // HubSpot allows at most 5 filterGroups per search request.
  const nameKeys = benefactorNameCandidates(record);
  const emails = benefactorEmailCandidates(record);
  const MAX_FILTER_GROUPS = 5;

  const filterGroups: Array<{ filters: Array<Record<string, string>> }> = [];
  for (const email of emails) {
    if (filterGroups.length >= MAX_FILTER_GROUPS) break;
    filterGroups.push({
      filters: [{ propertyName: "email", operator: "EQ", value: email }],
    });
  }
  for (const key of nameKeys) {
    if (filterGroups.length >= MAX_FILTER_GROUPS) break;
    filterGroups.push({
      filters: [
        { propertyName: "benefactor_name", operator: "EQ", value: key },
      ],
    });
  }
  if (filterGroups.length === 0) return null;

  const data = await hubspotFetch<{
    results?: Array<{ id: string; properties: Record<string, string | null> }>;
  }>("/crm/v3/objects/contacts/search", {
    method: "POST",
    body: JSON.stringify({
      filterGroups,
      properties: [
        "firstname",
        "lastname",
        "email",
        "benefactor_name",
        "is_benefactor",
      ],
      limit: 20,
    }),
  });

  const results = data.results ?? [];
  if (results.length === 0) return null;

  const scored = results.map((row) => {
    const p = row.properties;
    const bn = (p.benefactor_name ?? "").trim();
    const isBenefactor = /^(true|yes|1)$/i.test((p.is_benefactor ?? "").trim());
    const email = (p.email ?? "").trim().toLowerCase() || null;
    const fullName = `${p.firstname ?? ""} ${p.lastname ?? ""}`.trim();

    let score = 0;
    if (isBenefactor) score += 100;
    if (
      nameKeys.some(
        (k) =>
          k === bn || k.replace(/\s+/g, "") === bn.replace(/\s+/g, "")
      )
    ) {
      score += 50;
    }
    if (bn && namesMatch(bn, record.benefactor)) score += 30;
    if (fullName && namesMatch(fullName, record.benefactor)) score += 20;
    if (email && emails.includes(email)) score += 40;

    return {
      id: row.id,
      benefactorName: bn || resolveHubSpotBenefactorName(record),
      email,
      score,
    };
  });

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || best.score < 20) return null;
  return {
    id: best.id,
    benefactorName: best.benefactorName,
    email: best.email,
  };
}

function hubSpotCategoryForEvent(
  type: EngagementEvent["type"]
): { category: string; subCategory: string } {
  switch (type) {
    case "psychologist_call":
      return {
        category: "Psychologist Call",
        subCategory: "Engagement Calls - Online",
      };
    case "doctor_call":
      return {
        category: "Psychologist Call",
        subCategory: "Doctor Calls",
      };
    case "visit":
    case "outing":
    case "checkin_call":
    case "other":
    default:
      // Stays in Laiba's bucket — use Engagement Call (not Psychologist Call)
      return {
        category: "Engagement Call",
        subCategory: "Engagement Call",
      };
  }
}

function displayPerson(record: ClientRegistryRecord): string {
  const ben = record.beneficiary?.trim();
  if (ben && ben !== "TBC" && !/^tbc$/i.test(ben)) {
    const first = ben.split(/\s*(?:\/|&|,)\s*/)[0]?.trim();
    if (first) return first;
  }
  return record.benefactor;
}

export function buildHubSpotTicketSubject(
  event: EngagementEvent,
  record: ClientRegistryRecord
): string {
  const who = displayPerson(record);
  const code = cityCode(resolveHubSpotServingCity(record, event.city));
  switch (event.type) {
    case "psychologist_call":
      return `Psychologist call- ${who}`;
    case "doctor_call":
      return `Doctor call check-in- ${who}- ${code}`;
    case "checkin_call":
      return `Check-in call- ${who}- ${code}`;
    case "visit":
      return `Engagement visit- ${who}- ${code}`;
    case "outing":
      return `Outing- ${who}- ${code}`;
    default:
      return event.title?.trim() || `Engagement- ${who}- ${code}`;
  }
}

export function buildHubSpotTicketContent(
  event: EngagementEvent,
  record: ClientRegistryRecord
): string {
  const coordinator = engagementCoordinatorLabel(event);
  const lines = [
    "Scheduled via Mohsyn Engagement Calendar",
    `Engagement coordinator: ${coordinator}`,
    `Family: ${record.benefactor}`,
    `Beneficiary: ${record.beneficiary}`,
    `Type: ${ENGAGEMENT_EVENT_TYPE_LABELS[event.type]}`,
    `Date: ${event.date}${event.time ? ` at ${event.time}` : ""}`,
  ];
  if (event.assignedDoctor) {
    lines.push(`City clinician (see doctor_name): ${event.assignedDoctor}`);
  }
  if (event.title?.trim()) lines.push(`Title: ${event.title.trim()}`);
  if (event.notes?.trim()) lines.push(`Notes: ${event.notes.trim()}`);
  lines.push(`Calendar event id: ${event.id}`);
  return lines.join("\n");
}

function resolveDoctorName(
  event: EngagementEvent,
  record: ClientRegistryRecord
): string | undefined {
  const city = resolveHubSpotServingCity(record, event.city);
  if (event.type === "psychologist_call") {
    return event.assignedDoctor?.trim() || "Dr Farwa";
  }
  if (event.type === "doctor_call") {
    return (
      event.assignedDoctor?.trim() || defaultDoctorForCity(city) || undefined
    );
  }
  return event.assignedDoctor?.trim() || undefined;
}

async function hubspotFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  if (!token) throw new Error("HUBSPOT_ACCESS_TOKEN not configured");

  const res = await fetch(`${HUBSPOT_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const detail = (await res.text()).slice(0, 500);
    throw new Error(`HubSpot ${path} failed: ${res.status} ${detail}`);
  }
  if (res.status === 204) return {} as T;
  return res.json() as Promise<T>;
}

async function resolvePipelineStages(): Promise<{
  pipelineId: string;
  openStageId: string;
  closedStageId: string;
  cancelledStageId: string;
}> {
  const pipelineEnv = process.env.HUBSPOT_TICKET_PIPELINE_ID?.trim();
  const openEnv = process.env.HUBSPOT_TICKET_STAGE_ID?.trim();
  const closedEnv = process.env.HUBSPOT_TICKET_CLOSED_STAGE_ID?.trim();
  const cancelledEnv = process.env.HUBSPOT_TICKET_CANCELLED_STAGE_ID?.trim();

  if (pipelineEnv && openEnv && closedEnv) {
    return {
      pipelineId: pipelineEnv,
      openStageId: openEnv,
      closedStageId: closedEnv,
      cancelledStageId: cancelledEnv ?? closedEnv,
    };
  }

  const cached = globalCache.__mohsynHsPipeline;
  if (cached && Date.now() - cached.fetchedAt < 3600_000) {
    return {
      pipelineId: cached.pipelineId,
      openStageId: cached.openStageId,
      closedStageId: cached.closedStageId,
      cancelledStageId: cached.cancelledStageId,
    };
  }

  const data = await hubspotFetch<{
    results?: Array<{
      id: string;
      stages?: Array<{
        id: string;
        label?: string;
        metadata?: { ticketState?: string };
      }>;
    }>;
  }>("/crm/v3/pipelines/tickets");

  const pipeline = data.results?.[0];
  if (!pipeline?.stages?.length) {
    throw new Error("No HubSpot ticket pipeline found");
  }

  const openStage =
    pipeline.stages.find((s) => s.metadata?.ticketState === "OPEN") ??
    pipeline.stages.find((s) => /new|open/i.test(s.label ?? "")) ??
    pipeline.stages[0];

  const closedStage =
    pipeline.stages.find(
      (s) =>
        s.metadata?.ticketState === "CLOSED" && /^closed$/i.test(s.label ?? "")
    ) ??
    pipeline.stages.find((s) => s.metadata?.ticketState === "CLOSED") ??
    pipeline.stages[pipeline.stages.length - 1];

  const cancelledStage =
    pipeline.stages.find((s) => /cancel/i.test(s.label ?? "")) ?? closedStage;

  const result = {
    pipelineId: pipeline.id,
    openStageId: openStage.id,
    closedStageId: closedStage.id,
    cancelledStageId: cancelledStage.id,
  };
  globalCache.__mohsynHsPipeline = { ...result, fetchedAt: Date.now() };
  return result;
}

function buildTicketProperties(
  event: EngagementEvent,
  record: ClientRegistryRecord,
  pipelineId: string,
  stageId: string,
  ownerId?: string,
  contact?: BenefactorContactMatch | null
): Record<string, string> {
  const { category, subCategory } = hubSpotCategoryForEvent(event.type);
  const doctor = resolveDoctorName(event, record);
  const resolvedOwner = ownerId ?? resolveHubSpotTicketOwnerId(event);

  const properties: Record<string, string> = {
    subject: buildHubSpotTicketSubject(event, record),
    content: buildHubSpotTicketContent(event, record),
    hs_pipeline: pipelineId,
    hs_pipeline_stage: stageId,
    ticket_category: category,
    ticket_sub_category: subCategory,
    benefactor_name:
      contact?.benefactorName || resolveHubSpotBenefactorName(record),
    serving_city: resolveHubSpotServingCity(record, event.city),
    hs_ticket_priority: "MEDIUM",
  };

  if (contact?.email) properties.benefactor_email = contact.email;
  if (resolvedOwner) properties.hubspot_owner_id = resolvedOwner;
  if (doctor) properties.doctor_name = doctor;

  return properties;
}

async function assignTicketClinicalOwner(
  ticketId: string,
  event: EngagementEvent,
  record: ClientRegistryRecord
): Promise<void> {
  // Engagement check-ins/visits stay in Laiba's bucket — no clinical reassignment
  if (!isClinicalEngagementEvent(event)) return;

  const ownerId = resolveHubSpotTicketOwnerId(event);
  if (!ownerId) return;

  await hubspotFetch(`/crm/v3/objects/tickets/${ticketId}`, {
    method: "PATCH",
    body: JSON.stringify({
      properties: { hubspot_owner_id: ownerId },
    }),
  });

  const doctor = resolveDoctorName(event, record);
  const lines = [
    `[Engagement Calendar] Scheduled by ${engagementCoordinatorLabel(event)}.`,
    `Assigned to ${clinicalOwnerDisplayName(event)}.`,
  ];
  if (doctor) {
    lines.push(`City clinician (doctor_name): ${doctor}`);
  }
  await appendHubSpotTicketNote(ticketId, lines.join("\n"));
}

export async function appendHubSpotTicketNote(
  ticketId: string,
  body: string
): Promise<void> {
  if (!getToken() || !ticketId || !body.trim()) return;

  await hubspotFetch("/crm/v3/objects/notes", {
    method: "POST",
    body: JSON.stringify({
      properties: {
        hs_timestamp: new Date().toISOString(),
        hs_note_body: body.trim(),
      },
      associations: [
        {
          to: { id: ticketId },
          types: [
            {
              associationCategory: "HUBSPOT_DEFINED",
              associationTypeId: NOTE_TO_TICKET_ASSOCIATION_TYPE_ID,
            },
          ],
        },
      ],
    }),
  });
}

function calendarNoteBody(event: EngagementEvent): string | null {
  const parts: string[] = [
    `[Engagement Calendar] ${engagementCoordinatorLabel(event)}`,
    `${ENGAGEMENT_EVENT_TYPE_LABELS[event.type]} · ${event.date}${event.time ? ` ${event.time}` : ""}`,
  ];
  if (event.assignedDoctor?.trim()) {
    parts.push(`City clinician: ${event.assignedDoctor.trim()}`);
  }
  if (event.title?.trim()) parts.push(`Title: ${event.title.trim()}`);
  if (event.notes?.trim()) parts.push(event.notes.trim());
  return parts.join("\n");
}

export async function syncCalendarNotesToHubSpot(
  ticketId: string,
  event: EngagementEvent,
  options?: { previousNotes?: string | null; isCreate?: boolean }
): Promise<void> {
  const notesChanged =
    (event.notes?.trim() ?? "") !== (options?.previousNotes?.trim() ?? "");
  if (!options?.isCreate && !notesChanged) return;

  const body = calendarNoteBody(event);
  if (!body) return;

  await appendHubSpotTicketNote(ticketId, body);
}

export interface HubSpotTicketCreateResult {
  id: string;
  ticketNumber: string;
  contactLinked: boolean;
  contactWarning?: string;
}

export interface HubSpotClientTicketCommand {
  subject: string;
  content: string;
  category: string;
  subCategory: string;
  city?: string | null;
  priority?: "LOW" | "MEDIUM" | "HIGH";
  ownerId?: string;
}

/** Generic client-linked ticket creation used by non-engagement-calendar features. */
export async function createHubSpotClientTicket(
  command: HubSpotClientTicketCommand,
  record: ClientRegistryRecord
): Promise<HubSpotTicketCreateResult | null> {
  if (!getToken()) return null;

  const { pipelineId, openStageId } = await resolvePipelineStages();
  let contact: BenefactorContactMatch | null = null;
  let contactWarning: string | undefined;
  try {
    contact = await findHubSpotBenefactorContact(record);
  } catch (error) {
    contactWarning =
      error instanceof Error ? `Could not look up HubSpot contact: ${error.message}` : "Contact lookup failed";
  }
  if (!contact && !contactWarning) {
    contactWarning = `No HubSpot benefactor contact found for ${record.benefactor}`;
  }

  const properties: Record<string, string> = {
    subject: command.subject.trim(),
    content: command.content.trim(),
    hs_pipeline: pipelineId,
    hs_pipeline_stage: openStageId,
    ticket_category: command.category,
    ticket_sub_category: command.subCategory,
    benefactor_name: contact?.benefactorName || resolveHubSpotBenefactorName(record),
    serving_city: resolveHubSpotServingCity(record, command.city),
    hs_ticket_priority: command.priority ?? "MEDIUM",
  };
  if (contact?.email) properties.benefactor_email = contact.email;
  if (command.ownerId) properties.hubspot_owner_id = command.ownerId;

  const created = await hubspotFetch<{ id: string }>("/crm/v3/objects/tickets", {
    method: "POST",
    body: JSON.stringify({ properties }),
  });

  if (contact) {
    try {
      await hubspotFetch("/crm/v4/associations/tickets/contacts/batch/create", {
        method: "POST",
        body: JSON.stringify({
          inputs: [{
            from: { id: created.id },
            to: { id: contact.id },
            types: [{
              associationCategory: "HUBSPOT_DEFINED",
              associationTypeId: TICKET_TO_CONTACT_ASSOCIATION_TYPE_ID,
            }],
          }],
        }),
      });
    } catch (error) {
      console.warn("HubSpot generic ticket contact association failed:", error);
      contactWarning ??= `Ticket created but contact link failed for ${record.benefactor}`;
    }
    try {
      await hubspotFetch("/crm/v4/associations/tickets/contacts/batch/create", {
        method: "POST",
        body: JSON.stringify({
          inputs: [{
            from: { id: created.id },
            to: { id: contact.id },
            types: [{
              associationCategory: "USER_DEFINED",
              associationTypeId: TICKET_TO_BENEFACTOR_ASSOCIATION_TYPE_ID,
            }],
          }],
        }),
      });
    } catch (error) {
      // The portal-specific Benefactor label is best-effort; the normal contact
      // association above is sufficient to keep the ticket linked to the profile.
      console.warn("HubSpot generic Benefactor association failed:", error);
    }
  }

  return {
    id: created.id,
    ticketNumber: `MOH-${created.id.slice(-5)}`,
    contactLinked: Boolean(contact),
    contactWarning,
  };
}

export async function createHubSpotTicketFromEngagementEvent(
  event: EngagementEvent,
  record: ClientRegistryRecord
): Promise<HubSpotTicketCreateResult | null> {
  if (!shouldAutoCreateHubSpotTicket(event)) return null;

  const { pipelineId, openStageId } = await resolvePipelineStages();
  const createOwner = resolveHubSpotTicketOwnerId(event);

  let contact: BenefactorContactMatch | null = null;
  let contactWarning: string | undefined;
  try {
    contact = await findHubSpotBenefactorContact(record);
  } catch (e) {
    contactWarning =
      e instanceof Error
        ? `Could not look up HubSpot contact: ${e.message}`
        : "Could not look up HubSpot contact";
    console.warn(contactWarning, e);
  }
  if (!contact && !contactWarning) {
    contactWarning = `No HubSpot benefactor contact found for ${record.benefactor}`;
  }

  const properties = buildTicketProperties(
    event,
    record,
    pipelineId,
    openStageId,
    createOwner,
    contact
  );

  // Create ticket first without associations — invalid USER_DEFINED association
  // types would otherwise fail the whole create and leave no HubSpot ticket.
  const created = await hubspotFetch<{ id: string }>("/crm/v3/objects/tickets", {
    method: "POST",
    body: JSON.stringify({ properties }),
  });

  if (contact) {
    try {
      await hubspotFetch(`/crm/v4/associations/tickets/contacts/batch/create`, {
        method: "POST",
        body: JSON.stringify({
          inputs: [
            {
              from: { id: created.id },
              to: { id: contact.id },
              types: [
                {
                  associationCategory: "HUBSPOT_DEFINED",
                  associationTypeId: TICKET_TO_CONTACT_ASSOCIATION_TYPE_ID,
                },
              ],
            },
          ],
        }),
      });
    } catch (e) {
      console.warn("HubSpot ticket↔contact association failed:", e);
      contactWarning =
        contactWarning ??
        `Ticket created but contact link failed for ${record.benefactor}`;
    }

    try {
      await hubspotFetch(`/crm/v4/associations/tickets/contacts/batch/create`, {
        method: "POST",
        body: JSON.stringify({
          inputs: [
            {
              from: { id: created.id },
              to: { id: contact.id },
              types: [
                {
                  associationCategory: "USER_DEFINED",
                  associationTypeId: TICKET_TO_BENEFACTOR_ASSOCIATION_TYPE_ID,
                },
              ],
            },
          ],
        }),
      });
    } catch (e) {
      console.warn("HubSpot Benefactor association failed:", e);
    }
  }

  try {
    await assignTicketClinicalOwner(created.id, event, record);
    await syncCalendarNotesToHubSpot(created.id, event, { isCreate: true });
  } catch (e) {
    console.warn("HubSpot note/assign on create failed:", e);
  }

  return {
    id: created.id,
    ticketNumber: `MOH-${created.id.slice(-5)}`,
    contactLinked: Boolean(contact),
    contactWarning,
  };
}

/** Archive (delete) a HubSpot ticket created from the engagement calendar. */
export async function archiveHubSpotEngagementTicket(
  hubspotTicketId: string
): Promise<void> {
  if (!getToken() || !hubspotTicketId) return;
  await hubspotFetch(`/crm/v3/objects/tickets/${hubspotTicketId}`, {
    method: "DELETE",
  });
}

export async function updateHubSpotTicketFromEngagementEvent(
  hubspotTicketId: string,
  event: EngagementEvent,
  record: ClientRegistryRecord,
  options?: {
    previousNotes?: string | null;
    previousStatus?: EngagementEvent["status"];
    previousAssignedDoctor?: string | null;
  }
): Promise<void> {
  if (!getToken() || !hubspotTicketId) return;

  if (event.status === "cancelled") {
    await archiveHubSpotEngagementTicket(hubspotTicketId);
    return;
  }

  const { pipelineId, openStageId, closedStageId } = await resolvePipelineStages();

  let stageId = openStageId;
  if (event.status === "completed") stageId = closedStageId;

  const properties = buildTicketProperties(
    event,
    record,
    pipelineId,
    stageId,
    resolveHubSpotTicketOwnerId(event)
  );

  await hubspotFetch(`/crm/v3/objects/tickets/${hubspotTicketId}`, {
    method: "PATCH",
    body: JSON.stringify({ properties }),
  });

  const doctorChanged =
    options?.previousAssignedDoctor !== undefined &&
    (event.assignedDoctor?.trim() ?? "") !==
      (options.previousAssignedDoctor?.trim() ?? "");
  if (doctorChanged) {
    try {
      await assignTicketClinicalOwner(hubspotTicketId, event, record);
    } catch (e) {
      console.warn("HubSpot clinical reassignment failed:", e);
    }
  }

  try {
    await syncCalendarNotesToHubSpot(hubspotTicketId, event, {
      previousNotes: options?.previousNotes ?? null,
    });
  } catch (e) {
    console.warn("HubSpot note on update failed:", e);
  }
}

export function hubSpotTicketUrl(ticketId: string): string | null {
  const portal = process.env.HUBSPOT_PORTAL_ID?.trim();
  if (!portal || !ticketId) return null;
  return `https://app.hubspot.com/contacts/${portal}/ticket/${ticketId}`;
}
