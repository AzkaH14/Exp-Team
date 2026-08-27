import type { QoLDistributionBucket, QoLUrgentClient } from "./qol";

export interface DashboardLiveSnapshot {
  generatedAt: string;
  period: string;
  sync?: {
    source: "odoo" | "hubspot" | "static";
    lastSyncedAt: string | null;
    ticketCount: number;
    clientCount: number;
    error: string | null;
  };
  kpis: {
    totalTickets: number;
    uniqueClients: number;
    serviceCategories: number;
    distinctSubServices: number;
    /** Latest month's ticket count minus the prior month's. */
    momDelta: number;
    /** e.g. "Aug vs Jul" — the two months momDelta compares. */
    momLabel: string;
    forecastValue: number;
    /** e.g. "Sep Forecast" — the month forecastValue projects. */
    forecastLabel: string;
  };
  monthly: { month: string; tickets: number }[];
  cities: { city: string; tickets: number; pct: number }[];
  categories: { category: string; tickets: number; pct: number }[];
  topSubServices: { subService: string; tickets: number }[];
  forecast: {
    nextMonthForecast: number;
    forecastMonth: string;
    slopePerMonth: number;
    historical: { month: string; tickets: number }[];
  };
  monteCarlo: {
    p10: number;
    p50: number;
    p90: number;
    mean: number;
  };
  insights: string[];
  recommendations: string[];
  urgentClients: QoLUrgentClient[];
  qolDistribution: QoLDistributionBucket[];
  ticketSummary: {
    total: number;
    urgentEstimate: number;
    openEstimate: number;
  };
}
