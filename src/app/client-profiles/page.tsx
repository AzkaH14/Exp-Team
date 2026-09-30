import { AppHeader } from "@/components/dashboard/app-header";
import { ClientRegistryHub } from "@/components/dashboard/client-registry-hub";
import { HubSpotSyncButton } from "@/components/dashboard/hubspot-sync-button";
import { getClientProfileListItems } from "@/lib/client-registry/merge";
import { kickOffHubSpotProfileRefreshIfStale } from "@/lib/client-registry/refresh-hubspot-profile-cache";
import { reconcileHubSpotWithRegistry } from "@/lib/client-registry/reconcile";
import { getRegistrySource, getRegistrySummary } from "@/lib/client-registry/store";
import { getDataSyncMeta } from "@/lib/data-source";
import { ensureSession } from "@/lib/ensure-session";

// ISR — was force-dynamic. Session cache is in-memory; revalidatePath() after a sync forces an immediate refresh (see sync routes), so this is a ceiling, not a wait.
export const revalidate = 900;

export default async function ClientProfilesPage() {
  await ensureSession();
  kickOffHubSpotProfileRefreshIfStale();
  const syncMeta = getDataSyncMeta();

  const initial = {
    profiles: getClientProfileListItems(),
    reconcile: reconcileHubSpotWithRegistry(),
    sacredSummary: getRegistrySummary(),
    odooUrl: process.env.ODOO_URL?.trim().replace(/\/+$/, "") || null,
  };
  const fromOdoo = getRegistrySource() === "odoo";

  return (
    <>
      <AppHeader
        title="Client Profiles"
        description={fromOdoo ? "Benefactors, beneficiaries, birthdays and family notes from Odoo contacts" : "Sacred client registry — beneficiary (parent) profiles cross-checked with HubSpot"}
        badge={`${initial.reconcile.summary.sacredTotal} ${fromOdoo ? "Odoo" : "sacred"} clients`}
        actions={<HubSpotSyncButton />}
      />
      {syncMeta.source === "static" && (
        <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          Showing static fallback data — open Settings and run{" "}
          <strong>Sync now from HubSpot</strong> for live client matches.
        </p>
      )}
      <ClientRegistryHub initial={initial} />
    </>
  );
}
