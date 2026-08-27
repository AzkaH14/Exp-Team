import "server-only";
import { writeFileSync } from "fs";
import { join } from "path";
import type { Ticket } from "../types/ticket";
import { rankClinicalNotes } from "../reports/clinical-note-ranking";
import { fetchTicketActivities } from "./hubspot-activity-fetch";

const OUT_PATH = join(process.cwd(), "src/data/ticket-notes.json");

export interface TicketInsightNotesRecord {
  ticketId: string;
  ticketNumber: string;
  notes: Array<{
    id: string;
    body: string;
    createdAt: string | null;
    source?: string;
  }>;
}

export interface TicketNotesFile {
  syncedAt: string;
  summary: {
    ticketsChecked: number;
    ticketsWithNotes: number;
    totalNotes: number;
    bySource: Record<string, number>;
  };
  byTicketId: Record<string, TicketInsightNotesRecord>;
}

function getToken(): string | undefined {
  return process.env.HUBSPOT_ACCESS_TOKEN?.trim() || undefined;
}

/** Physio / doctor / healthcare tickets — where session insight notes matter */
export function ticketNeedsInsightNotes(ticket: Ticket): boolean {
  // Odoo-origin tickets have no HubSpot object id — calling HubSpot's API with
  // one (e.g. "odoo-72149") wastes the call at best, and can 400 a whole
  // 100-id batch (breaking notes for real HubSpot tickets in the same batch)
  // at worst. Only HubSpot-origin tickets can have HubSpot activity.
  if (ticket.id.startsWith("odoo-")) return false;
  const blob = `${ticket.subCategory} ${ticket.categoryFull} ${ticket.name}`.toLowerCase();
  if (/physio|physiotherap/.test(blob)) return true;
  if (
    ticket.categoryFull === "Healthcare Services" ||
    ticket.categoryFull === "Medical Errands (non-emergency)" ||
    ticket.categoryFull === "Psychologist Call" ||
    ticket.categoryFull === "Emergency Services"
  ) {
    return true;
  }
  return /\bdr\.?\b|doctor|mohsyn doctor|consultant|specialist|clinic visit|wellness/i.test(
    blob
  );
}

export async function syncTicketInsightNotes(tickets: Ticket[]): Promise<{
  byTicketId: Map<string, TicketInsightNotesRecord>;
  summary: TicketNotesFile["summary"];
}> {
  const eligible = tickets.filter(ticketNeedsInsightNotes);
  const ticketIds = eligible.map((t) => t.id);
  const activitiesByTicket = await fetchTicketActivities(ticketIds);

  const byTicketId = new Map<string, TicketInsightNotesRecord>();
  const bySource: Record<string, number> = {};
  let totalNotes = 0;

  for (const ticket of eligible) {
    const activities = activitiesByTicket.get(ticket.id) ?? [];
    if (!activities.length) continue;

    const rankedBodies = rankClinicalNotes(activities.map((activity) => activity.body));
    const notes = rankedBodies.map((body, index) => {
      const activity =
        activities.find((item) => item.body === body) ??
        activities.find((item) => item.body.includes(body.slice(0, 80)));
      const source = activity?.source ?? "note";
      bySource[source] = (bySource[source] ?? 0) + 1;
      return {
        id: activity?.id ?? `note-${ticket.id}-${index}`,
        body,
        createdAt: activity?.createdAt ?? null,
        source,
      };
    });

    totalNotes += notes.length;
    byTicketId.set(ticket.id, {
      ticketId: ticket.id,
      ticketNumber: ticket.ticketNumber,
      notes,
    });
  }

  const summary = {
    ticketsChecked: eligible.length,
    ticketsWithNotes: byTicketId.size,
    totalNotes,
    bySource,
  };

  const payload: TicketNotesFile = {
    syncedAt: new Date().toISOString(),
    summary,
    byTicketId: Object.fromEntries(byTicketId),
  };

  try {
    writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2));
  } catch (e) {
    console.warn("Could not write ticket-notes.json:", e);
  }

  return { byTicketId, summary };
}

export function attachInsightNotesToTickets(
  tickets: Ticket[],
  byTicketId: Map<string, TicketInsightNotesRecord>
): Ticket[] {
  if (!byTicketId.size) return tickets;

  return tickets.map((ticket) => {
    const rec = byTicketId.get(ticket.id);
    if (!rec?.notes.length) return ticket;
    return {
      ...ticket,
      insightNotes: rec.notes.map((n) => n.body),
    };
  });
}

export function isHubSpotTicketNotesConfigured(): boolean {
  return Boolean(getToken());
}
