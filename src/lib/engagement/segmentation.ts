import "server-only";
import { getAnalyticsData } from "../analytics-data";
import type { EngagementCity, EngagementSegment } from "../types/engagement";
import {
  buildLastTicketByRegistryId,
  isUnderutilisingClient,
} from "./last-activity";
import { resolveEngagementClientMeta } from "./client-meta";
import { isExcludedFromUtilization } from "./calendar-clients";
import { collectUnderutilisingCandidates } from "./underutilising-candidates";
import { getUnderutilisingSheetEntries } from "./underutilising-sheet";

const TOP_N = 15;

export function classifySegment(
  client: string,
  tickets: number,
  topClientNames: Set<string>,
  lastByRegistry = buildLastTicketByRegistryId()
): EngagementSegment {
  if (isUnderutilisingClient(client, lastByRegistry)) return "underutilising";
  if (topClientNames.has(client)) return "top";
  return "mid";
}

export function getTopClientNames(): Set<string> {
  const analytics = getAnalyticsData();
  const lastByRegistry = buildLastTicketByRegistryId();
  const sorted = [...analytics.clients]
    .filter((c) => !isUnderutilisingClient(c.client, lastByRegistry))
    .sort((a, b) => b.tickets - a.tickets);
  return new Set(sorted.slice(0, TOP_N).map((c) => c.client));
}

export function getSegmentCounts(city?: string) {
  const analytics = getAnalyticsData();
  const topNames = getTopClientNames();
  const lastByRegistry = buildLastTicketByRegistryId();
  const sheetEntries = getUnderutilisingSheetEntries();
  const cityFilter = (city ?? "all") as EngagementCity;

  const underutilisingIds = new Set(
    collectUnderutilisingCandidates(cityFilter, sheetEntries, lastByRegistry).map(
      (c) => c.registryId
    )
  );

  const counts: Record<EngagementSegment, number> = {
    underutilising: underutilisingIds.size,
    top: 0,
    mid: 0,
  };

  for (const c of analytics.clients) {
    const meta = resolveEngagementClientMeta(c.client);
    if (isExcludedFromUtilization(meta.status)) continue;
    if (city && city !== "all") {
      const displayCity = meta.registryId ? meta.city : c.city;
      if (displayCity !== city && c.city !== city) continue;
    }
    if (meta.registryId && underutilisingIds.has(meta.registryId)) continue;
    const seg = classifySegment(c.client, c.tickets, topNames, lastByRegistry);
    counts[seg]++;
  }

  return counts;
}
