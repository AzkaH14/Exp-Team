/**
 * Tarim Wasim and Tarim/Faisal are the same sacred-registry family.
 * Legacy docs (enrichment, risk, health overrides) use `tarim-faisal`;
 * the live registry id is `tarim-wasim`.
 */
export const REGISTRY_ID_ALIASES: Record<string, string> = {
  "tarim-wasim": "tarim-faisal",
  "syed-faraz-ali": "faraz-ali",
  // Enrichment / HubSpot legacy id → live sacred id
  "ensherah-khan": "ghazi-khan-ensherah",
};

const CANONICAL_BY_LEGACY: Record<string, string> = Object.fromEntries(
  Object.entries(REGISTRY_ID_ALIASES).map(([canonical, legacy]) => [legacy, canonical])
);

/** Sacred registry id used for tickets and the client list */
export function canonicalRegistryId(id: string): string {
  return CANONICAL_BY_LEGACY[id] ?? id;
}

/** Legacy doc id (enrichment / risk / overrides) when one exists */
export function legacyRegistryId(id: string): string {
  const canonical = canonicalRegistryId(id);
  return REGISTRY_ID_ALIASES[canonical] ?? id;
}

/** All ids that refer to the same family */
export function allRegistryIdVariants(id: string): string[] {
  const canonical = canonicalRegistryId(id);
  const legacy = legacyRegistryId(canonical);
  return [...new Set([id, canonical, legacy])];
}

/** @deprecated Prefer canonicalRegistryId / legacyRegistryId */
export function resolveRegistryId(id: string): string {
  return legacyRegistryId(id);
}

export function registryIdsMatch(a: string, b: string): boolean {
  return canonicalRegistryId(a) === canonicalRegistryId(b);
}
