import { AppHeader } from "@/components/dashboard/app-header";
import { FamilyReportsHub } from "@/components/dashboard/family-reports-hub";
import { ensureCachedSession, getDataSyncMeta } from "@/lib/data-source";
import {
  appendPeriodToSearchParams,
  defaultReportPeriod,
  listFamiliesForReports,
  periodInputFromReportPeriod,
} from "@/lib/reports/family-monthly-report";

// ISR — was force-dynamic. Session cache is in-memory; revalidatePath() after a sync forces an immediate refresh (see sync routes), so this is a ceiling, not a wait.
export const revalidate = 900;

export default function FamilyReportsPage() {
  ensureCachedSession();
  const syncMeta = getDataSyncMeta();
  const period = defaultReportPeriod();
  const families = listFamiliesForReports(period);
  const initialPeriod = periodInputFromReportPeriod(period);

  return (
    <>
      <AppHeader
        title="Family Reports"
        description="Monthly health & care progress reports per family — auto-filled from HubSpot tickets, with clinical notes for physio/consultant"
      />
      {syncMeta.source === "static" && (
        <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Showing cached ticket data. Click <strong>Sync now (Sheet + HubSpot)</strong> in
          the sidebar, wait for it to finish, then refresh this page for live reports.
        </p>
      )}
      <FamilyReportsHub initialPeriod={initialPeriod} initialFamilies={families} />
    </>
  );
}
