import { AppHeader } from "@/components/dashboard/app-header";
import { DashboardLiveContent } from "@/components/dashboard/dashboard-live-content";
import { ensureSession } from "@/lib/ensure-session";
import { getDashboardLiveSnapshot } from "@/lib/data-provider";

// ISR — was force-dynamic. Session cache is in-memory; revalidatePath() after a sync forces an immediate refresh (see sync routes), so this is a ceiling, not a wait.
export const revalidate = 900;

export default async function DashboardPage() {
  await ensureSession();
  const snapshot = getDashboardLiveSnapshot();

  return (
    <>
      <AppHeader
        title="Operations Dashboard"
        description="Live utilization metrics, QoL alerts, and forecast intelligence"
        badge={snapshot.period}
      />
      <DashboardLiveContent
        key={`${snapshot.sync?.source ?? "static"}-${snapshot.sync?.lastSyncedAt ?? snapshot.generatedAt}`}
        snapshot={snapshot}
      />
    </>
  );
}
