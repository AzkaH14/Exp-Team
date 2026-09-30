import type { ClientRegistryRecord } from "../types/client-registry";
import { filterSacredRegistryClients, REGISTRY_BLOCKLIST_VERSION } from "./hubspot-blocklist";

/**
 * Registry version derived from CONTENT, not from when it was loaded.
 *
 * The frozen historical aggregate records the version it was built against;
 * a mismatch forces the slow recompute (~8s per instance). A timestamp-based
 * version made every live registry sync look like a change. Hashing what the
 * ticket filters actually depend on (ids, names, aliases, status) keeps the
 * fast path until the registry really changes.
 *
 * scripts/build-historical.mjs imports this, so both sides agree byte for byte.
 */
export function registryContentVersion(clients: ClientRegistryRecord[]): string {
  const visible = filterSacredRegistryClients(clients);
  const lines = visible
    .map((c) =>
      [c.id, c.status, c.benefactor, [...(c.aliases ?? [])].sort().join(",")].join("|")
    )
    .sort();

  // FNV-1a, 32-bit — stable across Node versions, no crypto import needed.
  let hash = 0x811c9dc5;
  for (const line of lines) {
    for (let i = 0; i < line.length; i++) {
      hash ^= line.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    hash ^= 0x0a;
    hash = Math.imul(hash, 0x01000193);
  }
  const hex = (hash >>> 0).toString(16).padStart(8, "0");
  return `c:${hex}:${visible.length}:bl${REGISTRY_BLOCKLIST_VERSION}`;
}
