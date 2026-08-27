import "server-only";
import { matchRegistryRecord, namesMatch } from "../client-registry/name-match";
import { getSacredRegistry } from "../client-registry/store";
import { getLiveTickets } from "../data-source";
import { parseTicketDate, ticketBelongsToRegistryClient } from "../reports/ticket-match";
import { UNDERUTILISING_INACTIVE_DAYS } from "./constants";

export { UNDERUTILISING_INACTIVE_DAYS };

let cachedLastByRegistry: Map<string, Date> | null = null;
let cachedTicketCount = 0;

export function buildLastTicketByRegistryId(): Map<string, Date> {
  const tickets = getLiveTickets();
  if (cachedLastByRegistry && cachedTicketCount === tickets.length) {
    return cachedLastByRegistry;
  }

  const registry = getSacredRegistry();
  const map = new Map<string, Date>();

  for (const record of registry) {
    for (const ticket of tickets) {
      if (!ticketBelongsToRegistryClient(ticket, record)) continue;
      const d = parseTicketDate(ticket.closed) ?? parseTicketDate(ticket.created);
      if (!d) continue;
      const prev = map.get(record.id);
      if (!prev || d > prev) map.set(record.id, d);
    }
  }

  cachedLastByRegistry = map;
  cachedTicketCount = tickets.length;
  return map;
}

export function invalidateLastActivityCache(): void {
  cachedLastByRegistry = null;
  cachedTicketCount = 0;
}

export function getLastTicketDateForHubSpotClient(
  hubspotClientName: string,
  lastByRegistry: Map<string, Date>
): Date | null {
  const match = matchRegistryRecord(hubspotClientName, getSacredRegistry());
  if (match) return lastByRegistry.get(match.id) ?? null;

  let last: Date | null = null;
  for (const ticket of getLiveTickets()) {
    if (!namesMatch(ticket.client, hubspotClientName)) continue;
    const d = parseTicketDate(ticket.closed) ?? parseTicketDate(ticket.created);
    if (d && (!last || d > last)) last = d;
  }
  return last;
}

export function daysSinceLastTicket(
  hubspotClientName: string,
  lastByRegistry: Map<string, Date>,
  now = new Date()
): number | null {
  const last = getLastTicketDateForHubSpotClient(hubspotClientName, lastByRegistry);
  if (!last) return null;
  return Math.floor((now.getTime() - last.getTime()) / (24 * 60 * 60 * 1000));
}

export function isUnderutilisingClient(
  hubspotClientName: string,
  lastByRegistry: Map<string, Date>,
  inactiveDays = UNDERUTILISING_INACTIVE_DAYS,
  now = new Date()
): boolean {
  const last = getLastTicketDateForHubSpotClient(hubspotClientName, lastByRegistry);
  if (!last) return true;
  const cutoff = now.getTime() - inactiveDays * 24 * 60 * 60 * 1000;
  return last.getTime() < cutoff;
}
