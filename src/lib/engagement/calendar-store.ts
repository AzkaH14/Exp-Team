import "server-only";
import { writeFileSync } from "fs";
import path from "path";
import calendarJson from "@/data/engagement-calendar.json";
import type {
  EngagementEvent,
  EngagementEventInput,
} from "../types/engagement-calendar";
import { getSacredRegistry } from "../client-registry/store";
import { getCityLead } from "./team";
import { resolveScheduleCity } from "./calendar-clients";
import {
  appendSheetEvent,
  deleteSheetEvent,
  isCalendarSheetConfigured,
  listSheetEvents,
  updateSheetEvent,
} from "../integrations/calendar-sheet";
import {
  createHubSpotTicketFromEngagementEvent,
  archiveHubSpotEngagementTicket,
  isHubSpotTicketCreateEnabled,
  updateHubSpotTicketFromEngagementEvent,
} from "../integrations/hubspot-ticket-create";
import { defaultDoctorForCity } from "./doctors";

interface CalendarFile {
  version: number;
  description?: string;
  events: EngagementEvent[];
}

export type CalendarStorageMode = "sheet" | "memory";

/** How long we reuse sheet events in memory before re-fetching Google (ms). */
const SHEET_EVENTS_TTL_MS = 120_000;

export function getCalendarStorageMode(): CalendarStorageMode {
  return isCalendarSheetConfigured() ? "sheet" : "memory";
}

const CALENDAR_JSON_PATH = path.join(
  process.cwd(),
  "src/data/engagement-calendar.json"
);

const globalStore = globalThis as unknown as {
  __mohsynCalendarEvents?: EngagementEvent[];
  __mohsynSheetEventsCache?: { events: EngagementEvent[]; loadedAt: number };
};

function loadLocalEvents(): EngagementEvent[] {
  if (!globalStore.__mohsynCalendarEvents) {
    const file = calendarJson as CalendarFile;
    globalStore.__mohsynCalendarEvents = [...(file.events ?? [])];
  }
  return globalStore.__mohsynCalendarEvents;
}

function persistLocal(events: EngagementEvent[]): void {
  const payload: CalendarFile = {
    version: (calendarJson as CalendarFile).version ?? 1,
    description: (calendarJson as CalendarFile).description,
    events,
  };
  try {
    writeFileSync(CALENDAR_JSON_PATH, JSON.stringify(payload, null, 2));
  } catch (e) {
    console.warn("Could not persist engagement-calendar.json:", e);
  }
}

function makeId(): string {
  return `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function buildEvent(input: EngagementEventInput): EngagementEvent {
  const record = getSacredRegistry().find((r) => r.id === input.registryId);
  if (!record) throw new Error(`Unknown client: ${input.registryId}`);

  // Satellite homes (e.g. Faisalabad) schedule under their engagement city (Lahore)
  const scheduleCity = resolveScheduleCity(record);
  const lead = getCityLead(scheduleCity);
  const now = new Date().toISOString();
  return {
    id: makeId(),
    registryId: record.id,
    clientLabel: record.benefactor,
    city: scheduleCity,
    lead,
    type: input.type,
    title: input.title?.trim() ?? "",
    notes: input.notes?.trim() ?? "",
    date: input.date,
    time: input.time?.trim() ? input.time.trim() : null,
    status: input.status ?? "planned",
    rescheduledFrom: null,
    assignedDoctor:
      input.assignedDoctor?.trim() ||
      (input.type === "psychologist_call"
        ? "Dr Farwa"
        : input.type === "doctor_call"
          ? defaultDoctorForCity(scheduleCity)
          : null),
    hubspotTicketId: null,
    createdBy: input.createdBy?.trim() || lead,
    createdAt: now,
    updatedAt: now,
  };
}

export interface EngagementEventPatch {
  type?: EngagementEvent["type"];
  title?: string;
  notes?: string;
  date?: string;
  time?: string | null;
  status?: EngagementEvent["status"];
  assignedDoctor?: string | null;
}

function applyPatch(existing: EngagementEvent, patch: EngagementEventPatch): EngagementEvent {
  const dateChanged = patch.date != null && patch.date !== existing.date;
  return {
    ...existing,
    type: patch.type ?? existing.type,
    title: patch.title != null ? patch.title.trim() : existing.title,
    notes: patch.notes != null ? patch.notes.trim() : existing.notes,
    date: patch.date ?? existing.date,
    time:
      patch.time !== undefined
        ? patch.time?.trim()
          ? patch.time.trim()
          : null
        : existing.time,
    status:
      patch.status ??
      (dateChanged && existing.status === "planned" ? "rescheduled" : existing.status),
    rescheduledFrom: dateChanged
      ? existing.rescheduledFrom ?? existing.date
      : existing.rescheduledFrom,
    assignedDoctor:
      patch.assignedDoctor !== undefined
        ? patch.assignedDoctor?.trim()
          ? patch.assignedDoctor.trim()
          : null
        : existing.assignedDoctor,
    updatedAt: new Date().toISOString(),
  };
}

function sortEvents(events: EngagementEvent[]): EngagementEvent[] {
  return [...events].sort((a, b) => {
    const byDate = a.date.localeCompare(b.date);
    if (byDate !== 0) return byDate;
    return (a.time ?? "").localeCompare(b.time ?? "");
  });
}

function setSheetEventsCache(events: EngagementEvent[]): EngagementEvent[] {
  const sorted = sortEvents(events);
  globalStore.__mohsynSheetEventsCache = { events: sorted, loadedAt: Date.now() };
  return sorted;
}

function invalidateSheetEventsCache(): void {
  globalStore.__mohsynSheetEventsCache = undefined;
}

/** Sheet events: memory cache first, Google fetch only when stale. */
async function loadSheetEvents(force = false): Promise<EngagementEvent[]> {
  const cache = globalStore.__mohsynSheetEventsCache;
  if (!force && cache && Date.now() - cache.loadedAt < SHEET_EVENTS_TTL_MS) {
    return cache.events;
  }
  return setSheetEventsCache(await listSheetEvents());
}

export async function getAllEvents(): Promise<EngagementEvent[]> {
  if (isCalendarSheetConfigured()) {
    return loadSheetEvents();
  }
  return sortEvents(loadLocalEvents());
}

export async function addEvent(
  input: EngagementEventInput
): Promise<{ event: EngagementEvent; hubspotWarning?: string }> {
  const record = getSacredRegistry().find((r) => r.id === input.registryId);
  if (!record) throw new Error(`Unknown client: ${input.registryId}`);

  let event = buildEvent(input);
  let hubspotWarning: string | undefined;

  try {
    const hs = await createHubSpotTicketFromEngagementEvent(event, record);
    if (hs) {
      event = { ...event, hubspotTicketId: hs.id };
      // Soft contact-link issues are logged server-side only — ticket create succeeded
    } else if (isHubSpotTicketCreateEnabled()) {
      hubspotWarning =
        "HubSpot ticket was not created (check event type or existing link).";
    }
  } catch (e) {
    hubspotWarning =
      e instanceof Error ? e.message : "HubSpot ticket create failed";
    console.warn("HubSpot ticket create failed (calendar entry still saved):", e);
  }

  if (isCalendarSheetConfigured()) {
    await appendSheetEvent(event);
    const cached = globalStore.__mohsynSheetEventsCache?.events ?? (await loadSheetEvents());
    setSheetEventsCache([...cached, event]);
    return { event, hubspotWarning };
  }
  const events = loadLocalEvents();
  events.push(event);
  persistLocal(events);
  return { event, hubspotWarning };
}

export async function updateEvent(
  id: string,
  patch: EngagementEventPatch
): Promise<EngagementEvent | null> {
  const recordFor = (event: EngagementEvent) =>
    getSacredRegistry().find((r) => r.id === event.registryId);

  if (isCalendarSheetConfigured()) {
    const all = await loadSheetEvents();
    const existing = all.find((e) => e.id === id);
    if (!existing) return null;
    const updated = applyPatch(existing, patch);
    const record = recordFor(updated);

    if (record) {
      try {
        if (updated.status === "cancelled" && updated.hubspotTicketId) {
          await archiveHubSpotEngagementTicket(updated.hubspotTicketId);
          updated.hubspotTicketId = null;
        } else if (updated.hubspotTicketId) {
          await updateHubSpotTicketFromEngagementEvent(
            updated.hubspotTicketId,
            updated,
            record,
            { previousNotes: existing.notes, previousStatus: existing.status, previousAssignedDoctor: existing.assignedDoctor }
          );
        } else if (updated.status !== "cancelled") {
          const hs = await createHubSpotTicketFromEngagementEvent(updated, record);
          if (hs) updated.hubspotTicketId = hs.id;
        }
      } catch (e) {
        console.warn("HubSpot ticket update failed:", e);
      }
    }

    const ok = await updateSheetEvent(updated);
    if (!ok) return null;
    setSheetEventsCache(all.map((e) => (e.id === id ? updated : e)));
    return updated;
  }

  const events = loadLocalEvents();
  const idx = events.findIndex((e) => e.id === id);
  if (idx === -1) return null;
  const updated = applyPatch(events[idx], patch);
  const record = recordFor(updated);
  if (record) {
    try {
      if (updated.status === "cancelled" && updated.hubspotTicketId) {
        await archiveHubSpotEngagementTicket(updated.hubspotTicketId);
        updated.hubspotTicketId = null;
      } else if (updated.hubspotTicketId) {
        await updateHubSpotTicketFromEngagementEvent(
          updated.hubspotTicketId,
          updated,
          record,
          { previousNotes: events[idx].notes, previousStatus: events[idx].status, previousAssignedDoctor: events[idx].assignedDoctor }
        );
      } else if (updated.status !== "cancelled") {
        const hs = await createHubSpotTicketFromEngagementEvent(updated, record);
        if (hs) updated.hubspotTicketId = hs.id;
      }
    } catch (e) {
      console.warn("HubSpot ticket update failed:", e);
    }
  }
  events[idx] = updated;
  persistLocal(events);
  return updated;
}

export async function deleteEvent(id: string): Promise<boolean> {
  const allEvents = isCalendarSheetConfigured()
    ? await loadSheetEvents()
    : loadLocalEvents();
  const existing = allEvents.find((e) => e.id === id);

  if (existing?.hubspotTicketId) {
    try {
      await archiveHubSpotEngagementTicket(existing.hubspotTicketId);
    } catch (e) {
      console.warn("HubSpot ticket archive on delete failed:", e);
    }
  }

  if (isCalendarSheetConfigured()) {
    const removed = await deleteSheetEvent(id);
    if (!removed) return false;
    const all = globalStore.__mohsynSheetEventsCache?.events;
    if (all) {
      setSheetEventsCache(all.filter((e) => e.id !== id));
    } else {
      invalidateSheetEventsCache();
    }
    return true;
  }
  const events = loadLocalEvents();
  const idx = events.findIndex((e) => e.id === id);
  if (idx === -1) return false;
  events.splice(idx, 1);
  persistLocal(events);
  return true;
}
