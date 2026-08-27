import { NextResponse } from "next/server";
import { discoverHubSpotBenefactors } from "@/lib/client-registry/discover-hubspot";
import { getClientProfileListItems } from "@/lib/client-registry/merge";
import { kickOffHubSpotProfileRefreshIfStale } from "@/lib/client-registry/refresh-hubspot-profile-cache";
import { reconcileHubSpotWithRegistry } from "@/lib/client-registry/reconcile";
import { getRegistrySummary } from "@/lib/client-registry/store";
import { getHubSpotBirthdaysMeta } from "@/lib/client-registry/hubspot-birthdays";
import { getHubSpotNotesMeta } from "@/lib/client-registry/hubspot-notes";
import { ensureSession } from "@/lib/ensure-session";

export const dynamic = "force-dynamic";

export async function GET() {
  await ensureSession();
  kickOffHubSpotProfileRefreshIfStale();
  const profiles = getClientProfileListItems();
  const { rows, summary } = reconcileHubSpotWithRegistry();
  const sacredSummary = getRegistrySummary();
  const hubspotDiscoveries = discoverHubSpotBenefactors().slice(0, 20);
  const hubspotBirthdays = getHubSpotBirthdaysMeta();
  const hubspotNotes = getHubSpotNotesMeta();

  return NextResponse.json({
    profiles,
    reconcile: { rows, summary },
    sacredSummary,
    hubspotDiscoveries,
    hubspotBirthdays,
    hubspotNotes,
  });
}
