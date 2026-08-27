import type { AnalyticsData } from "./analytics-data";
import { isBundledHubSpotAnalytics } from "./analytics-build";
import { getHistoricalAggregate, getHistoricalMeta } from "./historical";
import { finalizeAggregate } from "./analytics-aggregate";

/**
 * Sidebar/layout sync meta without loading the full ticket index.
 * Full ticket warm happens on pages that call ensureSession / warmSession.
 */
export function getSidebarBootstrap() {
  const globalStore = globalThis as typeof globalThis & {
    __mohsynStore?: {
      cache: {
        analytics: AnalyticsData;
        syncedAt: number;
        tickets: unknown[];
      } | null;
      syncPromise: Promise<void> | null;
      lastError: string | null;
    };
  };

  const store = globalStore.__mohsynStore;
  const live = Boolean(store?.cache);

  const meta = getHistoricalMeta();
  const baselineAnalytics = finalizeAggregate(getHistoricalAggregate(), {
    source: `HubSpot history to ${meta.cutover} (Odoo not yet loaded)`,
    periodFallback: meta.cutover,
  });

  const bundledHubSpot = !live && isBundledHubSpotAnalytics(baselineAnalytics);
  const analytics = live ? store!.cache!.analytics : baselineAnalytics;
  const unified = process.env.MOHSYN_DATA_SOURCE?.trim() !== "hubspot";

  return {
    period: analytics.period,
    syncSource: (unified
      ? "odoo"
      : live || bundledHubSpot
        ? "hubspot"
        : "static") as "odoo" | "hubspot" | "static",
    lastSyncedAt: live
      ? new Date(store!.cache!.syncedAt).toISOString()
      : bundledHubSpot
        ? baselineAnalytics.exportedAt ?? null
        : null,
  };
}
