import type { AnalyticsData } from "./analytics-data";
import type { Ticket } from "./types/ticket";
import { accumulate, finalizeAggregate } from "./analytics-aggregate";

const DEFAULT_SYNC_SINCE = "2025-11-01";

export function parseSyncSinceMs(): number {
  const raw = process.env.HUBSPOT_SYNC_SINCE?.trim() || DEFAULT_SYNC_SINCE;

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  }

  const parsed = Date.parse(raw);
  if (!Number.isNaN(parsed)) return parsed;

  const days = parseInt(process.env.HUBSPOT_SYNC_DAYS ?? "90", 10) || 90;
  return Date.now() - days * 24 * 60 * 60 * 1000;
}

export function syncPeriodLabel(sinceMs: number): string {
  const start = new Date(sinceMs).toLocaleDateString("en-GB", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  return `${start} – live (HubSpot)`;
}

/**
 * Full rebuild from a ticket list. Retained as the build-time path and as the
 * fallback; the hot path is finalizeAggregate(mergeAggregates(...)) — see
 * analytics-aggregate.ts and odoo_instruct.md §12.3.
 */
export function buildAnalyticsFromTickets(tickets: Ticket[]): AnalyticsData {
  return finalizeAggregate(accumulate(tickets), {
    source: "HubSpot CRM API (live sync)",
    insightPrefix: "Live sync: ",
    periodFallback: syncPeriodLabel(parseSyncSinceMs()),
  });
}

export function isBundledHubSpotAnalytics(analytics: AnalyticsData): boolean {
  return /hubspot/i.test(analytics.source ?? "");
}
