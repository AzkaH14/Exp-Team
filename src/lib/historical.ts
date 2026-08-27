/**
 * Frozen HubSpot history, built by scripts/build-historical.mjs.
 *
 * The index and aggregate are imported statically (bundled, hot path).
 * The detail file is ~1.8 MB of ticket descriptions that only the report and
 * ticket-detail views need, so it loads lazily and is never on the hot path.
 *
 * See odoo_instruct.md §4.4 and §12.4.
 */
import "server-only";
import indexJson from "@/data/historical-tickets-index.json";
import aggregateJson from "@/data/historical-aggregates.json";
import type { TicketAggregate } from "./analytics-aggregate";
import type { Ticket } from "./types/ticket";

interface HistoricalMeta {
  builtAt: string;
  cutover: string;
  sheetRows: number;
  historicalRows: number;
  keptRows: number;
  droppedBlocklist: number;
  droppedRegistry: number;
  registryVersion: string;
  blocklistVersion: number;
}

const file = aggregateJson as unknown as {
  meta: HistoricalMeta;
  aggregate: TicketAggregate;
};

/** Pre-cutover tickets, blocklist- and registry-filtered at build time. */
export function getHistoricalTickets(): Ticket[] {
  return indexJson as unknown as Ticket[];
}

/** Frozen additive aggregate over the same tickets. */
export function getHistoricalAggregate(): TicketAggregate {
  return file.aggregate;
}

export function getHistoricalMeta(): HistoricalMeta {
  return file.meta;
}

type DetailEntry = { description?: string; hubspotFieldNotes?: string[] };
let detailCache: Record<string, DetailEntry> | null = null;

/**
 * Ticket descriptions and form notes. Loaded on first use only — importing
 * this eagerly would put ~1.8 MB of parsing back on every cold start.
 */
export async function getHistoricalDetail(): Promise<Record<string, DetailEntry>> {
  if (!detailCache) {
    const mod = await import("@/data/historical-tickets-detail.json");
    detailCache = (mod.default ?? mod) as unknown as Record<string, DetailEntry>;
  }
  return detailCache;
}

/** Re-attach descriptions to a slice of tickets (detail views, reports). */
export async function withHistoricalDetail(tickets: Ticket[]): Promise<Ticket[]> {
  const detail = await getHistoricalDetail();
  return tickets.map((t) => {
    const extra = detail[t.id];
    return extra ? { ...t, ...extra } : t;
  });
}

/**
 * The frozen aggregate bakes in the registry and blocklist that were current
 * when it was built. If either has moved, the aggregate is stale and callers
 * must recompute from the index instead of trusting it.
 */
export function isHistoricalAggregateFresh(
  registryVersion: string,
  blocklistVersion: number
): boolean {
  return (
    file.meta.registryVersion === registryVersion &&
    file.meta.blocklistVersion === blocklistVersion
  );
}
