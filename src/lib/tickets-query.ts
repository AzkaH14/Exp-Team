import "server-only";
import { getTicketsData } from "./tickets-data";
import type { TicketsPageResult } from "./types/ticket";
import {
  enrichTicketForQueue,
  listFamiliesForTicketFilter,
  summarizeTicketQueue,
  type TicketAttentionLevel,
  type TicketQueueRow,
} from "./ticket-queue-intelligence";
// test commit ..
const PAGE_SIZE = 25;

let cityCache: string[] | null = null;
let enrichedCache: { count: number; rows: TicketQueueRow[] } | null = null;

export function invalidateTicketsQueryCache(): void {
  cityCache = null;
  enrichedCache = null;
}

function getCities(): string[] {
  if (!cityCache) {
    cityCache = [...new Set(getTicketsData().map((t) => t.city))].sort();
  }
  return cityCache;
}

function getEnrichedTickets(): TicketQueueRow[] {
  const tickets = getTicketsData();
  if (enrichedCache && enrichedCache.count === tickets.length) {
    return enrichedCache.rows;
  }
  const rows = tickets.map((t) => enrichTicketForQueue(t));
  enrichedCache = { count: tickets.length, rows };
  return rows;
}

const ATTENTION_RANK: Record<TicketAttentionLevel, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export function getTicketsPage(
  page = 1,
  search = "",
  city = "",
  priority = "",
  registryId = "",
  status = "",
  attention = "",
  quality = ""
): TicketsPageResult {
  const q = search.toLowerCase().trim();
  const all = getEnrichedTickets();

  let filtered = all.filter((t) => {
    if (city && t.city !== city) return false;
    if (priority && t.priority !== priority) return false;
    if (registryId && t.registryId !== registryId) return false;
    if (status === "open" && !t.isOpen) return false;
    if (status === "closed" && t.isOpen) return false;
    if (attention && t.attention !== attention) return false;
    if (quality && t.qualitySignal !== quality) return false;
    if (!q) return true;
    return (
      t.client.toLowerCase().includes(q) ||
      t.ticketNumber.toLowerCase().includes(q) ||
      t.name.toLowerCase().includes(q) ||
      t.subCategory.toLowerCase().includes(q) ||
      (t.familyLabel?.toLowerCase().includes(q) ?? false)
    );
  });

  filtered = filtered.sort((a, b) => {
    const att = ATTENTION_RANK[a.attention] - ATTENTION_RANK[b.attention];
    if (att !== 0) return att;
    if (a.isOpen !== b.isOpen) return a.isOpen ? -1 : 1;
    return b.daysOpen - a.daysOpen;
  });

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * PAGE_SIZE;

  return {
    tickets: filtered.slice(start, start + PAGE_SIZE),
    total,
    page: safePage,
    pageSize: PAGE_SIZE,
    totalPages,
    cities: getCities(),
    families: listFamiliesForTicketFilter(),
    summary: summarizeTicketQueue(filtered),
  };
}
