import "server-only";
import { getAnalyticsData } from "../analytics-data";
import type {
  ClientReconcileRow,
  ClientRegistryRecord,
  ClientRegistrySummary,
} from "../types/client-registry";
import { getSacredRegistry, getRegistrySummary, getRegistryVersion } from "./store";
import { isExcludedHubSpotContact } from "./hubspot-blocklist";
import {
  isMohsynDuplicateLabel,
  isTestSuspectName,
  matchRegistryRecord,
  namesMatch,
  slugFromBenefactor,
} from "./name-match";

export { isTestSuspectName };

function matchHubSpotName(
  hubspotName: string,
  registry: ClientRegistryRecord[]
): ClientRegistryRecord | null {
  return matchRegistryRecord(hubspotName, registry);
}

function isHubSpotRowSuspect(
  hubspotName: string,
  match: ClientRegistryRecord | null
): boolean {
  if (isExcludedHubSpotContact(hubspotName)) return true;
  if (isTestSuspectName(hubspotName)) return true;
  if (isMohsynDuplicateLabel(hubspotName) && !match) return true;
  if (!match) return true;
  return false;
}

export function invalidateReconcileCache(): void {
  reconcileCache = null;
}

let reconcileCache: {
  version: string;
  clientCount: number;
  result: { rows: ClientReconcileRow[]; summary: ClientRegistrySummary };
} | null = null;

function computeReconcile(): { rows: ClientReconcileRow[]; summary: ClientRegistrySummary } {
  const registry = getSacredRegistry();
  const sacredMeta = getRegistrySummary();
  const hubspotClients = getAnalyticsData().clients;
  const matchedRegistryIds = new Set<string>();
  const rows: ClientReconcileRow[] = [];

  for (const hs of hubspotClients) {
    if (isExcludedHubSpotContact(hs.client)) continue;
    const match = matchHubSpotName(hs.client, registry);
    const testSuspect = isHubSpotRowSuspect(hs.client, match);

    if (match) {
      matchedRegistryIds.add(match.id);
      rows.push({
        registryId: match.id,
        benefactor: match.benefactor,
        beneficiary: match.beneficiary,
        city: match.city,
        hubspotName: hs.client,
        hubspotTickets: hs.tickets,
        status: namesMatch(hs.client, match.benefactor) ? "matched" : "name_mismatch",
        isTestSuspect: testSuspect,
        notes: testSuspect
          ? "Low ticket count or test-like name — review for removal from HubSpot metrics"
          : "",
      });
    } else {
      rows.push({
        registryId: null,
        benefactor: hs.client,
        beneficiary: null,
        city: hs.city,
        hubspotName: hs.client,
        hubspotTickets: hs.tickets,
        status: "hubspot_only",
        isTestSuspect: testSuspect,
        notes: testSuspect
          ? "Not in sacred registry — likely test or duplicate contact"
          : "New HubSpot contact — add profile details in Client Profiles tab",
      });
    }
  }

  for (const r of registry) {
    if (!matchedRegistryIds.has(r.id) && r.status === "active") {
      rows.push({
        registryId: r.id,
        benefactor: r.benefactor,
        beneficiary: r.beneficiary,
        city: r.city,
        hubspotName: null,
        hubspotTickets: 0,
        status: "registry_only",
        isTestSuspect: false,
        notes: "In sacred registry but no HubSpot ticket match yet",
      });
    }
  }

  rows.sort((a, b) => {
    if (a.isTestSuspect !== b.isTestSuspect) return a.isTestSuspect ? -1 : 1;
    return (b.hubspotTickets ?? 0) - (a.hubspotTickets ?? 0);
  });

  const summary: ClientRegistrySummary = {
    sacredTotal: Number(sacredMeta.total ?? registry.length),
    sacredActive: Number(sacredMeta.active ?? 0),
    sacredPause: Number(sacredMeta.pause ?? 0),
    sacredGratis: Number(sacredMeta.gratis ?? 0),
    sacredCancelled: Number(sacredMeta.cancelled ?? 0),
    hubspotUniqueClients: hubspotClients.filter(
      (h) => !isExcludedHubSpotContact(h.client)
    ).length,
    matched: rows.filter((r) => r.status === "matched" || r.status === "name_mismatch").length,
    hubspotOnly: rows.filter((r) => r.status === "hubspot_only").length,
    registryOnly: rows.filter((r) => r.status === "registry_only").length,
    testSuspects: rows.filter((r) => r.isTestSuspect).length,
  };

  return { rows, summary };
}

export function reconcileHubSpotWithRegistry(): {
  rows: ClientReconcileRow[];
  summary: ClientRegistrySummary;
} {
  const version = getRegistryVersion();
  const clientCount = getAnalyticsData().clients.length;
  if (
    reconcileCache &&
    reconcileCache.version === version &&
    reconcileCache.clientCount === clientCount
  ) {
    return reconcileCache.result;
  }
  const result = computeReconcile();
  reconcileCache = { version, clientCount, result };
  return result;
}

export function isVerifiedHubSpotClient(
  hubspotClientName: string,
  registry = getSacredRegistry()
): boolean {
  if (isExcludedHubSpotContact(hubspotClientName)) return false;
  if (isTestSuspectName(hubspotClientName)) return false;
  return matchHubSpotName(hubspotClientName, registry) !== null;
}

export function hubspotClientToRegistryId(hubspotName: string): string | null {
  const match = matchHubSpotName(hubspotName, getSacredRegistry());
  return match?.id ?? slugFromBenefactor(hubspotName);
}
