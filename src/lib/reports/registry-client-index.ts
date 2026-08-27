import "server-only";
import {
  compactRegistryName,
  hubSpotMatchLabels,
  matchRegistryRecord,
  normalizeRegistryName,
} from "../client-registry/name-match";
import { getRegistryVersion, getSacredRegistry } from "../client-registry/store";
import type { ClientRegistryRecord } from "../types/client-registry";
import type { Ticket } from "../types/ticket";

interface RegistryClientIndex {
  version: string;
  byNormalizedName: Map<string, string>;
  byCompactName: Map<string, string>;
  registry: ClientRegistryRecord[];
  /**
   * Memo of every name already resolved, INCLUDING misses (stored as null).
   *
   * Without this, every ticket whose client misses the fast maps triggers a
   * full fuzzy matchRegistryRecord() scan. enrichTicketForQueue() runs per
   * ticket, so the /tickets page paid that scan 7,000+ times and effectively
   * hung. There are only ~130 distinct client names, so the memo bounds the
   * work at one scan per name.
   */
  resolved: Map<string, string | null>;
}

let cache: RegistryClientIndex | null = null;

function buildIndex(registry: ClientRegistryRecord[]): RegistryClientIndex {
  const byNormalizedName = new Map<string, string>();
  const byCompactName = new Map<string, string>();

  for (const record of registry) {
    const names = [record.benefactor, record.beneficiary, ...record.aliases];
    for (const name of names) {
      const norm = normalizeRegistryName(name);
      const compact = compactRegistryName(name);
      if (norm && !byNormalizedName.has(norm)) {
        byNormalizedName.set(norm, record.id);
      }
      if (compact && !byCompactName.has(compact)) {
        byCompactName.set(compact, record.id);
      }
    }
  }

  return {
    version: getRegistryVersion(),
    byNormalizedName,
    byCompactName,
    registry,
    resolved: new Map(),
  };
}

function getIndex(): RegistryClientIndex {
  const version = getRegistryVersion();
  if (cache && cache.version === version) {
    return cache;
  }
  const registry = getSacredRegistry();
  cache = buildIndex(registry);
  return cache;
}

/** Fast exact-name lookup, then fuzzy matchRegistryRecord fallback. Memoized. */
export function resolveRegistryIdForClient(hubspotName: string): string | null {
  const index = getIndex();

  const memo = index.resolved.get(hubspotName);
  if (memo !== undefined) return memo;

  const id = resolveUncached(index, hubspotName);
  index.resolved.set(hubspotName, id);
  return id;
}

function resolveUncached(
  index: RegistryClientIndex,
  hubspotName: string
): string | null {
  const labels = hubSpotMatchLabels(hubspotName);

  for (const label of labels) {
    const norm = normalizeRegistryName(label);
    if (norm) {
      const id = index.byNormalizedName.get(norm);
      if (id) return id;
    }
    const compact = compactRegistryName(label);
    if (compact) {
      const id = index.byCompactName.get(compact);
      if (id) return id;
    }
  }

  const match = matchRegistryRecord(hubspotName, index.registry);
  return match?.id ?? null;
}

/** Match benefactor on ticket.client; fall back to ticket title when client is blank */
export function resolveRegistryIdForTicket(ticket: Ticket): string | null {
  const client = ticket.client?.trim();
  if (client) {
    const id = resolveRegistryIdForClient(client);
    if (id) return id;
  }
  const title = ticket.name?.trim();
  if (title) return resolveRegistryIdForClient(title);
  return null;
}

export function invalidateRegistryClientIndex(): void {
  cache = null;
}
