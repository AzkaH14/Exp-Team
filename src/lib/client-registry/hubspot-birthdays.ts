import "server-only";
import { readFileSync } from "fs";
import { join } from "path";
import type { HubSpotBirthdayRecord } from "../types/client-registry";
import { allRegistryIdVariants } from "./registry-id-aliases";

const BIRTHDAYS_PATH = join(process.cwd(), "src/data/hubspot-birthdays.json");

interface HubSpotBirthdaysFile {
  syncedAt?: string;
  summary?: Record<string, number>;
  clients: HubSpotBirthdayRecord[];
}

let runtimeMap: Map<string, HubSpotBirthdayRecord> | null = null;
let runtimeSyncedAt: string | null = null;
let fileMeta: { syncedAt: string | null; summary: Record<string, number> } | null =
  null;

function readBirthdaysFile(): HubSpotBirthdaysFile {
  try {
    return JSON.parse(readFileSync(BIRTHDAYS_PATH, "utf-8")) as HubSpotBirthdaysFile;
  } catch {
    return { clients: [] };
  }
}

function ensureLoadedFromDisk(): Map<string, HubSpotBirthdayRecord> {
  if (runtimeMap) return runtimeMap;
  const file = readBirthdaysFile();
  fileMeta = {
    syncedAt: file.syncedAt ?? null,
    summary: file.summary ?? {},
  };
  runtimeSyncedAt = file.syncedAt ?? null;
  runtimeMap = new Map(file.clients.map((c) => [c.id, c]));
  return runtimeMap;
}

export function setHubSpotBirthdayCache(records: HubSpotBirthdayRecord[]): void {
  runtimeMap = new Map(records.map((c) => [c.id, c]));
  runtimeSyncedAt = new Date().toISOString();
  fileMeta = {
    syncedAt: runtimeSyncedAt,
    summary: fileMeta?.summary ?? {},
  };
}

export function getHubSpotBirthdayMap(): Map<string, HubSpotBirthdayRecord> {
  return ensureLoadedFromDisk();
}

export function getHubSpotBirthdayForClient(id: string): HubSpotBirthdayRecord | undefined {
  const map = getHubSpotBirthdayMap();
  for (const variant of allRegistryIdVariants(id)) {
    const hit = map.get(variant);
    if (hit) return hit;
  }
  return undefined;
}

export function getHubSpotBirthdaysMeta() {
  if (runtimeSyncedAt != null || fileMeta) {
    return {
      syncedAt: runtimeSyncedAt ?? fileMeta?.syncedAt ?? null,
      summary: fileMeta?.summary ?? {},
    };
  }
  const file = readBirthdaysFile();
  fileMeta = {
    syncedAt: file.syncedAt ?? null,
    summary: file.summary ?? {},
  };
  return {
    syncedAt: file.syncedAt ?? null,
    summary: file.summary ?? {},
  };
}

/** Bust merged profile cache when HubSpot birthday data changes */
export function getHubSpotBirthdaysVersion(): string {
  if (runtimeSyncedAt) return runtimeSyncedAt;
  if (fileMeta?.syncedAt) return fileMeta.syncedAt;
  return getHubSpotBirthdaysMeta().syncedAt ?? "0";
}
