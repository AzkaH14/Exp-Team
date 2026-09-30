import "server-only";
import type { AnalyticsClient } from "../analytics-data";
import { getAnalyticsData } from "../analytics-data";
import { matchRegistryRecord, namesMatch } from "../client-registry/name-match";
import { getSacredRegistry } from "../client-registry/store";
import type { ClientRegistryRecord } from "../types/client-registry";
import type { EngagementCity } from "../types/engagement";
import {
  engagementCityMatches,
  resolveEngagementClientMeta,
} from "./client-meta";
import { isUnderutilisingClient } from "./last-activity";
import { isExcludedFromUtilization } from "./calendar-clients";
import type { UnderutilisingSheetEntry } from "./underutilising-sheet";

export interface UnderutilisingCandidate {
  hubspotKey: string;
  email: string | null;
  tickets: number;
  analyticsCity: string;
  registryId: string;
  benefactor: string;
  onOpsSheet: boolean;
}

function findAnalyticsForRegistry(
  record: ClientRegistryRecord,
  analyticsClients: AnalyticsClient[],
  preferredEmail: string | null = null
): AnalyticsClient | null {
  if (preferredEmail) {
    const email = preferredEmail.toLowerCase();
    const byEmail = analyticsClients.find((c) => c.email?.toLowerCase() === email);
    if (byEmail && matchRegistryRecord(byEmail.client, [record])) return byEmail;
  }

  const exact = analyticsClients.find((c) => c.client === record.benefactor);
  if (exact) return exact;

  for (const client of analyticsClients) {
    if (matchRegistryRecord(client.client, [record])) return client;
  }

  return null;
}

function shouldExcludeFromEngagement(hubspotKey: string): boolean {
  return isExcludedFromUtilization(resolveEngagementClientMeta(hubspotKey).status);
}

function addCandidate(
  byRegistryId: Map<string, UnderutilisingCandidate>,
  record: ClientRegistryRecord,
  hubspotKey: string,
  email: string | null,
  tickets: number,
  analyticsCity: string,
  onOpsSheet: boolean,
  city: EngagementCity
): void {
  if (shouldExcludeFromEngagement(hubspotKey)) return;

  const meta = resolveEngagementClientMeta(hubspotKey);
  if (!engagementCityMatches(city, meta, analyticsCity)) return;

  const existing = byRegistryId.get(record.id);
  if (existing) {
    if (onOpsSheet) existing.onOpsSheet = true;
    return;
  }

  byRegistryId.set(record.id, {
    hubspotKey,
    email,
    tickets,
    analyticsCity,
    registryId: record.id,
    benefactor: meta.benefactor,
    onOpsSheet,
  });
}

/** Ops sheet (28-day non-utilizers) when configured, merged with HubSpot ticket inactivity.
 * Recent HubSpot tickets always clear the underutilising flag — a stale ops sheet cannot
 * keep an active family flagged. */
export function collectUnderutilisingCandidates(
  city: EngagementCity = "all",
  sheetEntries: UnderutilisingSheetEntry[] | null = null,
  lastByRegistry?: Map<string, Date>
): UnderutilisingCandidate[] {
  const analytics = getAnalyticsData();
  const registry = getSacredRegistry();
  const byRegistryId = new Map<string, UnderutilisingCandidate>();
  const lastMap = lastByRegistry ?? undefined;

  if (sheetEntries) {
    for (const entry of sheetEntries) {
      const record = resolveSheetEntryToRegistry(entry, analytics.clients);
      if (!record) continue;
      const hs = findAnalyticsForRegistry(record, analytics.clients, entry.email);
      const hubspotKey = hs?.client ?? record.benefactor;

      // Stale ops sheet: if HubSpot shows activity within the window, skip
      if (lastMap && !isUnderutilisingClient(hubspotKey, lastMap)) continue;

      addCandidate(
        byRegistryId,
        record,
        hubspotKey,
        hs?.email ?? entry.email,
        hs?.tickets ?? 0,
        entry.city ?? hs?.city ?? "Other",
        true,
        city
      );
    }
  }

  if (lastMap) {
    for (const client of analytics.clients) {
      if (!isUnderutilisingClient(client.client, lastMap)) continue;
      const record = matchRegistryRecord(client.client, registry);
      if (!record) continue;
      addCandidate(
        byRegistryId,
        record,
        client.client,
        client.email,
        client.tickets,
        client.city,
        false,
        city
      );
    }
  }

  return [...byRegistryId.values()];
}

export function resolveSheetEntryToRegistry(
  entry: UnderutilisingSheetEntry,
  analyticsClients: AnalyticsClient[]
): ClientRegistryRecord | null {
  const registry = getSacredRegistry();

  const byName = matchRegistryRecord(entry.displayName, registry);
  if (byName) return byName;

  for (const record of registry) {
    if (namesMatch(entry.displayName, record.benefactor)) return record;
    const parts = record.beneficiary.split("/").map((p) => p.trim());
    if (parts.some((p) => namesMatch(entry.displayName, p))) return record;
  }

  if (entry.email) {
    const email = entry.email.toLowerCase();
    const hs = analyticsClients.find((c) => c.email?.toLowerCase() === email);
    if (hs) {
      const match = matchRegistryRecord(hs.client, registry);
      if (match) return match;
    }
  }

  return null;
}
