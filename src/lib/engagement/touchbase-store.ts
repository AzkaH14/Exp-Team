import "server-only";
import { writeFileSync } from "fs";
import path from "path";
import trackerJson from "@/data/touchbase-tracker.json";
import type { TouchbaseEntry } from "../types/touchbase";
import { isTouchbaseSheetConfigured, listSheetEntries } from "../integrations/touchbase-sheet";

/**
 * Touchbase entries: the "Benefactor Tracker" Google Sheet tab when a service
 * account is configured, otherwise src/data/touchbase-tracker.json (local dev).
 * Sheet writes go through syncSheetMonth (see touchbase-data.ts), which keeps
 * the tab a full monthly mirror of the board.
 */

interface TrackerFile {
  version: number;
  description?: string;
  entries: TouchbaseEntry[];
}

const TRACKER_JSON_PATH = path.join(process.cwd(), "src/data/touchbase-tracker.json");

const globalStore = globalThis as unknown as {
  __mohsynTouchbaseEntries?: TouchbaseEntry[];
};

export function getTouchbaseStorageMode(): "sheet" | "memory" {
  return isTouchbaseSheetConfigured() ? "sheet" : "memory";
}

function loadLocal(): TouchbaseEntry[] {
  if (!globalStore.__mohsynTouchbaseEntries) {
    globalStore.__mohsynTouchbaseEntries = [...((trackerJson as TrackerFile).entries ?? [])];
  }
  return globalStore.__mohsynTouchbaseEntries;
}

export async function getTouchbaseEntries(month: string, force = false): Promise<TouchbaseEntry[]> {
  const all = isTouchbaseSheetConfigured() ? await listSheetEntries(force) : loadLocal();
  return all.filter((e) => e.month === month);
}

/** Local (no sheet) save. */
export function saveLocalTouchbaseEntry(entry: TouchbaseEntry): TouchbaseEntry {
  const entries = loadLocal();
  const idx = entries.findIndex((e) => e.key === entry.key);
  if (idx >= 0) entries[idx] = entry;
  else entries.push(entry);
  const file = trackerJson as TrackerFile;
  try {
    writeFileSync(
      TRACKER_JSON_PATH,
      JSON.stringify({ version: file.version ?? 1, description: file.description, entries }, null, 2)
    );
  } catch (e) {
    console.warn("Could not persist touchbase-tracker.json:", e);
  }
  return entry;
}
