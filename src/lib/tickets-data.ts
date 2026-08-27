import "server-only";
import { getLiveTickets } from "./data-source";
import type { Ticket } from "./types/ticket";

export type { Ticket };

export function clientKey(name: string): string {
  return name.toLowerCase().replace(/\s+/g, " ").trim();
}

let indexRef: Ticket[] | null = null;
let byClient = new Map<string, Ticket[]>();

export function buildTicketsByClientIndex(tickets: Ticket[]): Map<string, Ticket[]> {
  const index = new Map<string, Ticket[]>();
  for (const t of tickets) {
    const key = clientKey(t.client);
    const list = index.get(key);
    if (list) list.push(t);
    else index.set(key, [t]);
  }
  return index;
}

export function ticketStatsFromList(tickets: Ticket[]) {
  const categories: Record<string, number> = {};
  const subCategories: Record<string, number> = {};
  let urgentCount = 0;

  for (const t of tickets) {
    categories[t.categoryFull] = (categories[t.categoryFull] ?? 0) + 1;
    subCategories[t.subCategory] = (subCategories[t.subCategory] ?? 0) + 1;
    if (t.priority === "urgent") urgentCount++;
  }

  return { tickets, categories, subCategories, urgentCount };
}

function rebuildIndex(tickets: Ticket[]) {
  if (tickets === indexRef) return;
  byClient = buildTicketsByClientIndex(tickets);
  indexRef = tickets;
}

export function invalidateTicketIndex(): void {
  indexRef = null;
  byClient = new Map();
}

export function getTicketsData(): Ticket[] {
  return getLiveTickets();
}

export function getTicketsByClient(client: string): Ticket[] {
  const tickets = getLiveTickets();
  rebuildIndex(tickets);
  return byClient.get(clientKey(client)) ?? [];
}

export function getClientTicketStats(client: string) {
  return ticketStatsFromList(getTicketsByClient(client));
}
