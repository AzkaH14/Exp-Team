import "server-only";
import { readFileSync } from "fs";
import { join } from "path";
import type { OdooFamilyProfile } from "../types/client-registry";
import { allRegistryIdVariants } from "./registry-id-aliases";

/**
 * Odoo family data keyed by registry id: members (prodo.partner.family.relation),
 * Family Overview sections and chatter notes. Filled by syncOdooRegistry();
 * the JSON snapshot is what a cold serverless instance renders before its
 * first sync, exactly like the HubSpot caches it replaces.
 */
export const ODOO_FAMILIES_PATH = join(process.cwd(), "src/data/odoo-families.json");

export interface OdooFamiliesFile {
  syncedAt: string | null;
  families: OdooFamilyProfile[];
}

let runtimeMap: Map<string, OdooFamilyProfile> | null = null;
let syncedAt: string | null = null;

function ensureLoaded(): Map<string, OdooFamilyProfile> {
  if (runtimeMap) return runtimeMap;
  try {
    const file = JSON.parse(readFileSync(ODOO_FAMILIES_PATH, "utf-8")) as OdooFamiliesFile;
    runtimeMap = new Map(file.families.map((f) => [f.registryId, f]));
    syncedAt = file.syncedAt ?? null;
  } catch {
    runtimeMap = new Map();
    syncedAt = null;
  }
  return runtimeMap;
}

export function setOdooFamiliesCache(families: OdooFamilyProfile[], at: string): void {
  runtimeMap = new Map(families.map((f) => [f.registryId, f]));
  syncedAt = at;
}

export function getOdooFamily(registryId: string): OdooFamilyProfile | undefined {
  const map = ensureLoaded();
  for (const variant of allRegistryIdVariants(registryId)) {
    const hit = map.get(variant);
    if (hit) return hit;
  }
  return undefined;
}

export function getOdooFamilies(): OdooFamilyProfile[] {
  return [...ensureLoaded().values()];
}

/** Patch one family in memory after a successful write-back, so the UI sees it at once. */
export function patchOdooFamily(
  registryId: string,
  update: (f: OdooFamilyProfile) => OdooFamilyProfile
): void {
  const map = ensureLoaded();
  const current = map.get(registryId);
  if (!current) return;
  const next = new Map(map);
  next.set(registryId, update(current));
  runtimeMap = next;
  syncedAt = new Date().toISOString();
}

export function getOdooFamiliesMeta(): { syncedAt: string | null; families: number } {
  const map = ensureLoaded();
  return { syncedAt, families: map.size };
}

/** Changes whenever family data changes — part of the merged-profile cache key. */
export function getOdooFamiliesVersion(): string {
  ensureLoaded();
  return `${syncedAt ?? "0"}:${runtimeMap?.size ?? 0}`;
}
