import "server-only";
import { readFileSync } from "fs";
import { join } from "path";
import type { HubSpotNotesRecord } from "../types/client-registry";
import { allRegistryIdVariants } from "./registry-id-aliases";

const NOTES_PATH = join(process.cwd(), "src/data/hubspot-notes.json");

interface HubSpotNotesFile {
  syncedAt?: string | null;
  summary?: Record<string, number>;
  clients: HubSpotNotesRecord[];
}

let runtimeMap: Map<string, HubSpotNotesRecord> | null = null;
let runtimeSyncedAt: string | null = null;
let fileMeta: { syncedAt: string | null; summary: Record<string, number> } | null =
  null;

function readNotesFile(): HubSpotNotesFile {
  try {
    return JSON.parse(readFileSync(NOTES_PATH, "utf-8")) as HubSpotNotesFile;
  } catch {
    return { clients: [] };
  }
}

function ensureLoadedFromDisk(): Map<string, HubSpotNotesRecord> {
  if (runtimeMap) return runtimeMap;
  const file = readNotesFile();
  fileMeta = {
    syncedAt: file.syncedAt ?? null,
    summary: file.summary ?? {},
  };
  runtimeSyncedAt = file.syncedAt ?? null;
  runtimeMap = new Map(file.clients.map((c) => [c.id, c]));
  return runtimeMap;
}

export function setHubSpotNotesCache(records: HubSpotNotesRecord[]): void {
  runtimeMap = new Map(records.map((c) => [c.id, c]));
  runtimeSyncedAt = new Date().toISOString();
  fileMeta = {
    syncedAt: runtimeSyncedAt,
    summary: fileMeta?.summary ?? {},
  };
}

export function getHubSpotNotesMap(): Map<string, HubSpotNotesRecord> {
  return ensureLoadedFromDisk();
}

export function getHubSpotNotesForClient(id: string): HubSpotNotesRecord | undefined {
  const map = getHubSpotNotesMap();
  for (const variant of allRegistryIdVariants(id)) {
    const hit = map.get(variant);
    if (hit) return hit;
  }
  return undefined;
}

export function getHubSpotNotesMeta() {
  if (runtimeSyncedAt != null || fileMeta) {
    return {
      syncedAt: runtimeSyncedAt ?? fileMeta?.syncedAt ?? null,
      summary: fileMeta?.summary ?? {},
    };
  }
  const file = readNotesFile();
  fileMeta = {
    syncedAt: file.syncedAt ?? null,
    summary: file.summary ?? {},
  };
  return {
    syncedAt: file.syncedAt ?? null,
    summary: file.summary ?? {},
  };
}

export function getHubSpotNotesVersion(): string {
  if (runtimeSyncedAt) return runtimeSyncedAt;
  if (fileMeta?.syncedAt) return fileMeta.syncedAt;
  return getHubSpotNotesMeta().syncedAt ?? "0";
}
