import "server-only";
import { getRegistryVersion } from "../client-registry/store";
import { getLiveTickets } from "../data-source";
import type { FamilyMonthlyReport } from "./types";

const MAX_ENTRIES = 48;

export interface CachedFamilyReport {
  report: FamilyMonthlyReport;
  html: string;
}

const cache = new Map<string, CachedFamilyReport>();

const REPORT_FORMAT_VERSION = "period-intel-v4";

export function reportCacheKey(
  registryId: string,
  month: string,
  beneficiary: string | undefined
): string {
  const version = getRegistryVersion();
  const ticketCount = getLiveTickets().length;
  const ben = beneficiary ?? "";
  return `${REPORT_FORMAT_VERSION}|${version}|${ticketCount}|${registryId}|${month}|${ben}`;
}

export function getCachedFamilyReport(
  registryId: string,
  month: string,
  beneficiary: string | undefined
): CachedFamilyReport | undefined {
  const key = reportCacheKey(registryId, month, beneficiary);
  const entry = cache.get(key);
  if (!entry) return undefined;
  cache.delete(key);
  cache.set(key, entry);
  return entry;
}

export function setCachedFamilyReport(
  registryId: string,
  month: string,
  beneficiary: string | undefined,
  report: FamilyMonthlyReport,
  html: string
): void {
  const key = reportCacheKey(registryId, month, beneficiary);
  if (cache.has(key)) {
    cache.delete(key);
  } else if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { report, html });
}

export function invalidateFamilyReportCache(): void {
  cache.clear();
}
