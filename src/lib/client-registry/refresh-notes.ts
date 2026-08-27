import "server-only";
import { invalidateMergedClientProfilesCache } from "./merge";
import { getHubSpotNotesMeta, setHubSpotNotesCache } from "./hubspot-notes";
import {
  isHubSpotNotesConfigured,
  syncHubSpotNotes,
} from "../integrations/hubspot-notes-sync";

/** Pull latest profile notes from HubSpot before rendering client profiles */
export async function refreshHubSpotNotesFromHubSpot(): Promise<{
  ok: boolean;
  error?: string;
  meta: ReturnType<typeof getHubSpotNotesMeta>;
}> {
  if (!isHubSpotNotesConfigured()) {
    return { ok: false, error: "HubSpot not configured", meta: getHubSpotNotesMeta() };
  }

  try {
    const { records, summary } = await syncHubSpotNotes();
    setHubSpotNotesCache(records);
    invalidateMergedClientProfilesCache();
    return {
      ok: true,
      meta: {
        syncedAt: new Date().toISOString(),
        summary,
      },
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Notes sync failed",
      meta: getHubSpotNotesMeta(),
    };
  }
}
