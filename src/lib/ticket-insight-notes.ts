import { readFileSync } from "fs";
import { join } from "path";
import type { TicketInsightNotesRecord } from "./integrations/hubspot-ticket-notes-sync";

const NOTES_PATH = join(process.cwd(), "src/data/ticket-notes.json");

interface TicketNotesFile {
  syncedAt: string | null;
  byTicketId: Record<string, TicketInsightNotesRecord>;
}

let runtimeMap: Map<string, string[]> | null = null;
let runtimeSyncedAt: string | null = null;

function readNotesFile(): TicketNotesFile {
  try {
    return JSON.parse(readFileSync(NOTES_PATH, "utf-8")) as TicketNotesFile;
  } catch {
    return { syncedAt: null, byTicketId: {} };
  }
}

function loadFromDisk(): Map<string, string[]> {
  const file = readNotesFile();
  runtimeSyncedAt = file.syncedAt;
  const map = new Map<string, string[]>();
  for (const rec of Object.values(file.byTicketId ?? {})) {
    const bodies = rec.notes.map((n) => n.body).filter(Boolean);
    if (bodies.length) map.set(rec.ticketId, bodies);
  }
  return map;
}

export function getTicketInsightNotesMap(): Map<string, string[]> {
  if (runtimeMap && runtimeSyncedAt !== null) {
    return runtimeMap;
  }
  runtimeMap = loadFromDisk();
  return runtimeMap;
}

export function setTicketInsightNotesCache(
  byTicketId: Map<string, TicketInsightNotesRecord>
): void {
  runtimeMap = new Map();
  for (const rec of byTicketId.values()) {
    const bodies = rec.notes.map((n) => n.body).filter(Boolean);
    if (bodies.length) runtimeMap.set(rec.ticketId, bodies);
  }
  runtimeSyncedAt = new Date().toISOString();
}

export function getTicketInsightNotes(ticketId: string): string[] {
  return getTicketInsightNotesMap().get(ticketId) ?? [];
}

export function getTicketInsightNotesMeta() {
  const map = getTicketInsightNotesMap();
  let totalNotes = 0;
  for (const notes of map.values()) totalNotes += notes.length;
  return {
    syncedAt: runtimeSyncedAt,
    ticketsWithNotes: map.size,
    totalNotes,
  };
}

export function mergeInsightNotesOntoTickets<T extends { id: string; insightNotes?: string[] }>(
  tickets: T[]
): T[] {
  const map = getTicketInsightNotesMap();
  if (!map.size) return tickets;

  return tickets.map((ticket) => {
    if (ticket.insightNotes?.length) return ticket;
    const notes = map.get(ticket.id);
    if (!notes?.length) return ticket;
    return { ...ticket, insightNotes: notes };
  });
}
