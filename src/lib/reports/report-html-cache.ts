import "server-only";
import { getRegistryVersion } from "../client-registry/store";
import { getLiveTickets } from "../data-source";

const MAX_ENTRIES = 48;

interface CacheEntry {
  html: string;
}

const cache = new Map<string, CacheEntry>();

function cacheKey(
  registryId: string,
  month: string,
  beneficiary: string | undefined
): string {
  const version = getRegistryVersion();
  const ticketCount = getLiveTickets().length;
  const ben = beneficiary ?? "";
  return `${version}|${ticketCount}|${registryId}|${month}|${ben}`;
}

export function getCachedReportHtml(
  registryId: string,
  month: string,
  beneficiary: string | undefined
): string | undefined {
  const key = cacheKey(registryId, month, beneficiary);
  const entry = cache.get(key);
  if (!entry) return undefined;
  cache.delete(key);
  cache.set(key, entry);
  return entry.html;
}

export function setCachedReportHtml(
  registryId: string,
  month: string,
  beneficiary: string | undefined,
  html: string
): void {
  const key = cacheKey(registryId, month, beneficiary);
  if (cache.has(key)) {
    cache.delete(key);
  } else if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { html });
}

export function invalidateReportHtmlCache(): void {
  cache.clear();
}
