import "server-only";
import { getHubSpotBirthdaysMeta } from "./hubspot-birthdays";
import { getHubSpotNotesMeta } from "./hubspot-notes";
import { refreshHubSpotBirthdaysFromHubSpot } from "./refresh-birthdays";
import { refreshHubSpotNotesFromHubSpot } from "./refresh-notes";
import { isHubSpotBirthdaysConfigured } from "../integrations/hubspot-birthdays-sync";
import { isHubSpotNotesConfigured } from "../integrations/hubspot-notes-sync";

/** Don't block page render — refresh at most once per interval */
const PROFILE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

let refreshPromise: Promise<void> | null = null;
let lastRefreshAttempt = 0;

function isStale(syncedAt: string | null | undefined): boolean {
  if (!syncedAt) return true;
  const t = Date.parse(syncedAt);
  if (Number.isNaN(t)) return true;
  return Date.now() - t > PROFILE_CACHE_TTL_MS;
}

/** Load profiles from disk immediately; refresh HubSpot birthdays/notes in background when stale */
export function kickOffHubSpotProfileRefreshIfStale(): void {
  const needsBirthdays =
    isHubSpotBirthdaysConfigured() && isStale(getHubSpotBirthdaysMeta().syncedAt);
  const needsNotes =
    isHubSpotNotesConfigured() && isStale(getHubSpotNotesMeta().syncedAt);

  if (!needsBirthdays && !needsNotes) return;
  if (refreshPromise) return;
  if (Date.now() - lastRefreshAttempt < 60_000) return;

  lastRefreshAttempt = Date.now();
  refreshPromise = (async () => {
    try {
      await Promise.all([
        needsBirthdays
          ? refreshHubSpotBirthdaysFromHubSpot()
          : Promise.resolve(),
        needsNotes ? refreshHubSpotNotesFromHubSpot() : Promise.resolve(),
      ]);
    } catch (e) {
      console.warn("Background HubSpot profile refresh failed:", e);
    } finally {
      refreshPromise = null;
    }
  })();
}

/** Explicit sync (Settings / API) — always await */
export async function refreshHubSpotProfileDataNow(): Promise<{
  birthdays: Awaited<ReturnType<typeof refreshHubSpotBirthdaysFromHubSpot>>;
  notes: Awaited<ReturnType<typeof refreshHubSpotNotesFromHubSpot>>;
}> {
  const [birthdays, notes] = await Promise.all([
    isHubSpotBirthdaysConfigured()
      ? refreshHubSpotBirthdaysFromHubSpot()
      : Promise.resolve({
          ok: false as const,
          error: "HubSpot not configured",
          meta: getHubSpotBirthdaysMeta(),
        }),
    isHubSpotNotesConfigured()
      ? refreshHubSpotNotesFromHubSpot()
      : Promise.resolve({
          ok: false as const,
          error: "HubSpot not configured",
          meta: getHubSpotNotesMeta(),
        }),
  ]);
  return { birthdays, notes };
}
