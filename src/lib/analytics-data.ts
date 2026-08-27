import "server-only";
import { getLiveAnalytics } from "./data-source";
import { isExcludedHubSpotContact } from "./client-registry/hubspot-blocklist";

export interface AnalyticsClient {
  client: string;
  city: string;
  tickets: number;
  email: string | null;
}

export interface AnalyticsTopClient {
  client: string;
  city: string;
  tickets: number;
  topServices: string;
}

export interface AnalyticsData {
  period: string;
  source: string;
  /** ISO timestamp when analytics.json was exported from tickets (Vercel bundle) */
  exportedAt?: string | null;
  kpis: {
    totalTickets: number;
    uniqueClients: number;
    serviceCategories: number;
    distinctSubServices: number;
  };
  monthly: { month: string; tickets: number }[];
  cities: { city: string; tickets: number; pct: number }[];
  categories: { category: string; tickets: number; pct: number; clients: number }[];
  topClients: AnalyticsTopClient[];
  topSubServices: { subService: string; tickets: number }[];
  pareto: { rank: number; cumulativePct: number; tickets: number }[];
  forecast: {
    nextMonthForecast: number;
    /** e.g. "Sep 2026" — the month after the latest data point. */
    forecastMonth: string;
    slopePerMonth: number;
    historical: { month: string; tickets: number }[];
  };
  cityMonth: Record<string, Record<string, number>>;
  insights: string[];
  recommendations: string[];
  clients: AnalyticsClient[];
  monteCarlo: {
    simulations: number;
    mean: number;
    std: number;
    p10: number;
    p50: number;
    p90: number;
  };
}

export function getAnalyticsData(): AnalyticsData {
  // getLiveAnalytics already applies blocklist + cancelled filters
  return getLiveAnalytics();
}

export { isExcludedHubSpotContact };
