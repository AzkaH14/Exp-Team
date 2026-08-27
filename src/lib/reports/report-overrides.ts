import "server-only";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { canonicalRegistryId, legacyRegistryId, allRegistryIdVariants } from "../client-registry/registry-id-aliases";
import type { HealthReportOverride } from "./types";

const OVERRIDES_PATH = join(process.cwd(), "src/data/health-report-overrides.json");

interface OverridesFile {
  version: number;
  overrides: Record<string, HealthReportOverride>;
}

let cache: OverridesFile | null = null;

function load(): OverridesFile {
  if (cache) return cache;
  try {
    cache = JSON.parse(readFileSync(OVERRIDES_PATH, "utf-8")) as OverridesFile;
  } catch {
    cache = { version: 1, overrides: {} };
  }
  return cache;
}

export function reportOverrideKey(clientId: string, month: string): string {
  return `${clientId}:${month}`;
}

export function getHealthReportOverride(
  clientId: string,
  month: string
): HealthReportOverride | null {
  const file = load();
  for (const id of allRegistryIdVariants(clientId)) {
    const hit = file.overrides[reportOverrideKey(id, month)];
    if (hit) return hit;
  }
  return null;
}

export function saveHealthReportOverride(
  clientId: string,
  month: string,
  patch: HealthReportOverride
): HealthReportOverride {
  const file = load();
  const canonical = canonicalRegistryId(clientId);
  const key = reportOverrideKey(canonical, month);
  const legacyKey = reportOverrideKey(legacyRegistryId(canonical), month);
  const merged: HealthReportOverride = {
    ...file.overrides[key],
    ...file.overrides[legacyKey],
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  file.overrides[key] = merged;
  if (legacyKey !== key) {
    file.overrides[legacyKey] = merged;
  }
  writeFileSync(OVERRIDES_PATH, JSON.stringify(file, null, 2));
  cache = file;
  return merged;
}
