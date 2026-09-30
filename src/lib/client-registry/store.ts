import "server-only";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import registryJson from "@/data/client-registry.json";
import enrichmentJson from "@/data/client-enrichment.json";
import { filterSacredRegistryClients } from "./hubspot-blocklist";
import { applyRegistrySupplement } from "./registry-supplement";
import { canonicalRegistryId, legacyRegistryId } from "./registry-id-aliases";
import { registryContentVersion } from "./registry-version";
import type {
  ClientEnrichment,
  ClientProfileOverrides,
  ClientRegistryRecord,
} from "../types/client-registry";

const OVERRIDES_PATH = join(process.cwd(), "src/data/client-profile-overrides.json");

interface RegistryFile {
  version?: number;
  updatedAt?: string;
  clients: ClientRegistryRecord[];
  summary: Record<string, unknown>;
}

interface EnrichmentFile {
  profiles: ClientEnrichment[];
}

let overridesCache: Record<string, ClientProfileOverrides> | null = null;
let runtimeRegistry: ClientRegistryRecord[] | null = null;
let runtimeSummary: Record<string, unknown> | null = null;

export function setSacredRegistryCache(
  clients: ClientRegistryRecord[],
  summary?: Record<string, unknown>
): void {
  runtimeRegistry = filterSacredRegistryClients(applyRegistrySupplement(clients));
  if (summary) runtimeSummary = summary;
}

/** Where the live registry came from — "odoo" once an Odoo sync has run or the file was built from Odoo. */
export function getRegistrySource(): "odoo" | "sacred" {
  const raw = rawRegistry();
  return raw.length > 0 && raw.every((c) => c.source === "odoo") ? "odoo" : "sacred";
}

/**
 * Derived registry views, memoized on the raw source array.
 *
 * These getters used to recompute filterSacredRegistryClients(
 * applyRegistrySupplement(raw)) on EVERY call — around 90ms, because the
 * blocklist runs ~30 regex phrases against every record and alias. Callers
 * invoke them per ticket (familyLabelForRegistry, isCancelledHubSpotClient),
 * so a 7,000-ticket page spent minutes rebuilding the same 143-record list.
 *
 * The cache key is the raw array reference, which only changes via
 * setSacredRegistryCache() — so a live registry sync still invalidates it.
 */
interface DerivedRegistry {
  raw: ClientRegistryRecord[];
  all: ClientRegistryRecord[];
  active: ClientRegistryRecord[];
}

let derivedCache: DerivedRegistry | null = null;

function rawRegistry(): ClientRegistryRecord[] {
  return runtimeRegistry ?? (registryJson as RegistryFile).clients;
}

function derivedRegistry(): DerivedRegistry {
  const raw = rawRegistry();
  if (derivedCache?.raw === raw) return derivedCache;

  const all = filterSacredRegistryClients(applyRegistrySupplement(raw));
  derivedCache = {
    raw,
    all,
    active: all.filter((c) => c.status !== "cancelled"),
  };
  return derivedCache;
}

/** Full sacred list including cancelled (for status checks / ticket matching). */
export function getSacredRegistryIncludingCancelled(): ClientRegistryRecord[] {
  return derivedRegistry().all;
}

/** Active portfolio only — cancelled families are hidden from dashboard lists. */
export function getSacredRegistry(): ClientRegistryRecord[] {
  return derivedRegistry().active;
}

export function buildRegistrySummary(clients: ClientRegistryRecord[]) {
  const visible = clients.filter((c) => c.status !== "cancelled");
  const active = visible.filter((c) => c.status === "active");
  return {
    total: visible.length,
    active: active.length,
    pause: visible.filter((c) => c.status === "pause").length,
    cancelled: clients.filter((c) => c.status === "cancelled").length,
    gratis: visible.filter((c) => c.status === "gratis").length,
    byCity: {
      Islamabad: active.filter((c) => c.city === "Islamabad").length,
      Karachi: active.filter((c) => c.city === "Karachi").length,
      Lahore: active.filter((c) => c.city === "Lahore").length,
      Lodhran: active.filter((c) => c.city === "Lodhran").length,
      Gujranwala: active.filter((c) => c.city === "Gujranwala").length,
      Faisalabad: active.filter((c) => c.city === "Faisalabad").length,
      Other: active.filter((c) => c.city === "Other").length,
    },
  };
}

export function getRegistrySummary() {
  // buildRegistrySummary hides cancelled itself; passing getSacredRegistry()
  // (already cancelled-free) made the cancelled count always 0.
  const clients = getSacredRegistryIncludingCancelled();
  const fileSummary = runtimeSummary ?? (registryJson as RegistryFile).summary;
  return {
    ...fileSummary,
    ...buildRegistrySummary(clients),
  };
}

/**
 * Memoized on the raw array reference, which only changes via
 * setSacredRegistryCache(). It is on the hot path — per-ticket callers hit it
 * through getCancelledClientKeys() — so never hash on every call.
 */
let versionCache: { raw: ClientRegistryRecord[]; version: string } | null = null;

/** Bust session caches when the registry content or blocklist changes */
export function getRegistryVersion(): string {
  const raw = rawRegistry();
  if (versionCache?.raw !== raw) {
    versionCache = { raw, version: registryContentVersion(raw) };
  }
  return versionCache.version;
}

export function getEnrichmentMap(): Map<string, ClientEnrichment> {
  const file = enrichmentJson as EnrichmentFile;
  const map = new Map<string, ClientEnrichment>();
  for (const profile of file.profiles) {
    const key = legacyRegistryId(profile.benefactorId);
    map.set(key, profile);
    map.set(canonicalRegistryId(profile.benefactorId), profile);
  }
  return map;
}

export function getOverrides(): Record<string, ClientProfileOverrides> {
  if (overridesCache) return overridesCache;
  try {
    const raw = readFileSync(OVERRIDES_PATH, "utf-8");
    overridesCache = JSON.parse(raw) as Record<string, ClientProfileOverrides>;
  } catch {
    overridesCache = {};
  }
  return overridesCache!;
}

export function saveOverride(
  benefactorId: string,
  patch: ClientProfileOverrides,
  updatedBy: string
): ClientProfileOverrides {
  const all = getOverrides();
  const merged: ClientProfileOverrides = {
    ...all[benefactorId],
    ...patch,
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
  all[benefactorId] = merged;
  writeFileSync(OVERRIDES_PATH, JSON.stringify(all, null, 2));
  overridesCache = all;
  return merged;
}

export function getRegistryRecordById(id: string): ClientRegistryRecord | undefined {
  return getSacredRegistry().find((c) => c.id === id);
}
