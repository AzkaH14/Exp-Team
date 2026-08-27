import { NextResponse } from "next/server";
import { invalidateMergedClientProfilesCache } from "@/lib/client-registry/merge";
import { refreshHubSpotBirthdaysFromHubSpot } from "@/lib/client-registry/refresh-birthdays";
import { getHubSpotBirthdaysMeta } from "@/lib/client-registry/hubspot-birthdays";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Pull benefactor + beneficiary birthdays from HubSpot contacts */
export async function POST() {
  const result = await refreshHubSpotBirthdaysFromHubSpot();
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error ?? "Birthday sync failed" },
      { status: result.error === "HubSpot not configured" ? 400 : 500 }
    );
  }

  // ISR is now on: force an immediate refresh across the app rather than waiting for the 900s window.
  revalidatePath("/", "layout");
  return NextResponse.json({
    ok: true,
    summary: result.meta.summary,
    syncedAt: result.meta.syncedAt,
  });
}
