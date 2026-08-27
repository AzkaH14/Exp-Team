import "server-only";
import type { AnalyticsData } from "../analytics-data";
import type { Ticket } from "../types/ticket";
import {
  compactRegistryName,
  hubSpotMatchLabels,
  normalizeRegistryName,
} from "./name-match";
import { getRegistryVersion, getSacredRegistryIncludingCancelled } from "./store";

let cancelledKeysCache: { version: string; keys: Set<string> } | null = null;
let filteredAnalyticsCache: {
  version: string;
  source: AnalyticsData;
  result: AnalyticsData;
} | null = null;
let filteredTicketsCache: {
  version: string;
  source: Ticket[];
  result: Ticket[];
} | null = null;

function addNameKeys(keys: Set<string>, name: string): void {
  for (const label of hubSpotMatchLabels(name)) {
    const norm = normalizeRegistryName(label);
    const compact = compactRegistryName(label);
    if (norm) keys.add(norm);
    if (compact) keys.add(compact);
  }
}

/** Precomputed cancelled HubSpot name keys for O(1) membership checks. */
export function getCancelledClientKeys(): Set<string> {
  const version = getRegistryVersion();
  if (cancelledKeysCache?.version === version) return cancelledKeysCache.keys;

  const keys = new Set<string>();
  for (const c of getSacredRegistryIncludingCancelled()) {
    if (c.status !== "cancelled") continue;
    addNameKeys(keys, c.benefactor);
    for (const alias of c.aliases ?? []) addNameKeys(keys, alias);
  }
  cancelledKeysCache = { version, keys };
  return keys;
}

export function isCancelledHubSpotClient(name: string): boolean {
  const keys = getCancelledClientKeys();
  if (keys.size === 0) return false;
  for (const label of hubSpotMatchLabels(name)) {
    const norm = normalizeRegistryName(label);
    const compact = compactRegistryName(label);
    if ((norm && keys.has(norm)) || (compact && keys.has(compact))) return true;
  }
  return false;
}

/** Drop cancelled sacred families so QoL / KPIs / lists match the live portfolio. */
export function filterCancelledAnalyticsClients(data: AnalyticsData): AnalyticsData {
  const version = getRegistryVersion();
  if (
    filteredAnalyticsCache?.version === version &&
    filteredAnalyticsCache.source === data
  ) {
    return filteredAnalyticsCache.result;
  }

  const clients = data.clients.filter((c) => !isCancelledHubSpotClient(c.client));
  const topClients = data.topClients.filter((c) => !isCancelledHubSpotClient(c.client));
  const removedTickets = data.clients
    .filter((c) => isCancelledHubSpotClient(c.client))
    .reduce((sum, c) => sum + c.tickets, 0);

  const result: AnalyticsData = {
    ...data,
    clients,
    topClients,
    kpis: {
      ...data.kpis,
      uniqueClients: clients.length,
      totalTickets: Math.max(0, data.kpis.totalTickets - removedTickets),
    },
  };
  filteredAnalyticsCache = { version, source: data, result };
  return result;
}

export function filterCancelledTickets(tickets: Ticket[]): Ticket[] {
  const version = getRegistryVersion();
  if (
    filteredTicketsCache?.version === version &&
    filteredTicketsCache.source === tickets
  ) {
    return filteredTicketsCache.result;
  }

  const result = tickets.filter((t) => !isCancelledHubSpotClient(t.client));
  filteredTicketsCache = { version, source: tickets, result };
  return result;
}

export function invalidateCancelledFilterCaches(): void {
  cancelledKeysCache = null;
  filteredAnalyticsCache = null;
  filteredTicketsCache = null;
}
