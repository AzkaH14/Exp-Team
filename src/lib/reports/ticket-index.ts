import "server-only";
import { getRegistryVersion, getSacredRegistry } from "../client-registry/store";
import { getLiveTickets } from "../data-source";
import type { Ticket } from "../types/ticket";
import { ticketMonthKey } from "./family-monthly-report";
import {
  invalidateRegistryClientIndex,
  resolveRegistryIdForTicket,
} from "./registry-client-index";

interface ReportTicketIndex {
  version: string;
  ticketCount: number;
  byRegistryId: Map<string, Ticket[]>;
  byRegistryMonth: Map<string, Map<string, Ticket[]>>;
  monthCounts: Map<string, Map<string, number>>;
}

let cache: ReportTicketIndex | null = null;

export function getReportTicketIndex(): ReportTicketIndex {
  const version = getRegistryVersion();
  const tickets = getLiveTickets();

  if (
    cache &&
    cache.version === version &&
    cache.ticketCount === tickets.length
  ) {
    return cache;
  }

  const registry = getSacredRegistry();
  const byRegistryId = new Map<string, Ticket[]>();
  const byRegistryMonth = new Map<string, Map<string, Ticket[]>>();
  const monthCounts = new Map<string, Map<string, number>>();

  for (const record of registry) {
    byRegistryId.set(record.id, []);
    byRegistryMonth.set(record.id, new Map());
  }

  for (const ticket of tickets) {
    const registryId = resolveRegistryIdForTicket(ticket);
    if (!registryId) continue;

    byRegistryId.get(registryId)!.push(ticket);

    const month = ticketMonthKey(ticket);
    if (!month) continue;

    let perMonth = byRegistryMonth.get(registryId);
    if (!perMonth) {
      perMonth = new Map();
      byRegistryMonth.set(registryId, perMonth);
    }
    let monthTickets = perMonth.get(month);
    if (!monthTickets) {
      monthTickets = [];
      perMonth.set(month, monthTickets);
    }
    monthTickets.push(ticket);

    let perFamily = monthCounts.get(month);
    if (!perFamily) {
      perFamily = new Map();
      monthCounts.set(month, perFamily);
    }
    perFamily.set(registryId, (perFamily.get(registryId) ?? 0) + 1);
  }

  cache = {
    version,
    ticketCount: tickets.length,
    byRegistryId,
    byRegistryMonth,
    monthCounts,
  };
  return cache;
}

export function invalidateReportTicketIndex(): void {
  cache = null;
  invalidateRegistryClientIndex();
}
