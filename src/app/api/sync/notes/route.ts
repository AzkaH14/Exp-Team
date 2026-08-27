import { NextResponse } from "next/server";
import { refreshHubSpotNotesFromHubSpot } from "@/lib/client-registry/refresh-notes";
import { getHubSpotNotesMeta } from "@/lib/client-registry/hubspot-notes";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Pull profile notes from HubSpot contact records */
export async function POST() {
  const result = await refreshHubSpotNotesFromHubSpot();
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error ?? "Notes sync failed" },
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

export async function GET() {
  return NextResponse.json(getHubSpotNotesMeta());
}
