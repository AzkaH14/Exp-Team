import "server-only";
import { invalidateMergedClientProfilesCache } from "./merge";
import { getHubSpotBirthdaysMeta, setHubSpotBirthdayCache } from "./hubspot-birthdays";
import {
  isHubSpotBirthdaysConfigured,
  syncHubSpotBirthdays,
} from "../integrations/hubspot-birthdays-sync";

/** Pull latest birthdays from HubSpot before rendering client profiles */
export async function refreshHubSpotBirthdaysFromHubSpot(): Promise<{
  ok: boolean;
  error?: string;
  meta: ReturnType<typeof getHubSpotBirthdaysMeta>;
}> {
  if (!isHubSpotBirthdaysConfigured()) {
    return { ok: false, error: "HubSpot not configured", meta: getHubSpotBirthdaysMeta() };
  }

  try {
    const { records, summary } = await syncHubSpotBirthdays();
    setHubSpotBirthdayCache(records);
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
      error: e instanceof Error ? e.message : "Birthday sync failed",
      meta: getHubSpotBirthdaysMeta(),
    };
  }
}
