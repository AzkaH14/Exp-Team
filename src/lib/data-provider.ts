import "server-only";
import { getDataSyncMeta } from "./data-source";
import { getAnalyticsData } from "./analytics-data";
import { getUrgentAttentionClients, getQoLDistribution } from "./qol-engine";
import type { DashboardLiveSnapshot } from "./types/dashboard";
import { getRegistryVersion } from "./client-registry/store";

export type { DashboardLiveSnapshot };

let snapshotCache: { version: string; snapshot: DashboardLiveSnapshot } | null = null;

export function getDashboardLiveSnapshot(): DashboardLiveSnapshot {
  const syncMeta = getDataSyncMeta();
  const version = `${getRegistryVersion()}:${syncMeta.lastSyncedAt ?? "static"}:${syncMeta.ticketCount}`;
  if (snapshotCache?.version === version) {
    return snapshotCache.snapshot;
  }

  const data = getAnalyticsData();
  const monthly = data.monthly;
  const momDelta =
    monthly.length >= 2
      ? monthly[monthly.length - 1].tickets - monthly[monthly.length - 2].tickets
      : 0;
  const shortMonth = (label: string) => label.split(" ")[0] ?? label;
  const momLabel =
    monthly.length >= 2
      ? `${shortMonth(monthly[monthly.length - 1].month)} vs ${shortMonth(monthly[monthly.length - 2].month)}`
      : "MoM";
  const forecastLabel = `${shortMonth(data.forecast.forecastMonth)} Forecast`;

  const urgentClients = getUrgentAttentionClients(8);
  const qolDistribution = getQoLDistribution();

  const snapshot: DashboardLiveSnapshot = {
    generatedAt: new Date().toISOString(),
    period: data.period,
    sync: {
      source: syncMeta.source,
      lastSyncedAt: syncMeta.lastSyncedAt,
      ticketCount: syncMeta.ticketCount,
      clientCount: syncMeta.clientCount,
      error: syncMeta.error,
    },
    kpis: {
      totalTickets: data.kpis.totalTickets,
      uniqueClients: data.kpis.uniqueClients,
      serviceCategories: data.kpis.serviceCategories,
      distinctSubServices: data.kpis.distinctSubServices,
      momDelta,
      momLabel,
      forecastValue: data.forecast.nextMonthForecast,
      forecastLabel,
    },
    monthly: data.monthly,
    cities: data.cities.map((c) => ({
      city: c.city,
      tickets: c.tickets,
      pct: c.pct,
    })),
    categories: data.categories
      .slice()
      .sort((a, b) => b.tickets - a.tickets)
      .slice(0, 8)
      .map((c) => ({
        category: c.category,
        tickets: c.tickets,
        pct: c.pct,
      })),
    topSubServices: data.topSubServices.slice(0, 10),
    forecast: data.forecast,
    monteCarlo: {
      p10: data.monteCarlo.p10,
      p50: data.monteCarlo.p50,
      p90: data.monteCarlo.p90,
      mean: data.monteCarlo.mean,
    },
    insights: data.insights,
    recommendations: data.recommendations,
    urgentClients,
    qolDistribution,
    ticketSummary: {
      total: data.kpis.totalTickets,
      urgentEstimate: Math.round(data.kpis.totalTickets * 0.12),
      openEstimate: Math.round(data.kpis.totalTickets * 0.03),
    },
  };
  snapshotCache = { version, snapshot };
  return snapshot;
}

export function invalidateDashboardSnapshotCache(): void {
  snapshotCache = null;
}
