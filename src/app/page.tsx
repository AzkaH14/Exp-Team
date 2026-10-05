import { AppHeader } from "@/components/dashboard/app-header";
import { DashboardLiveContent } from "@/components/dashboard/dashboard-live-content";
import { ensureSession } from "@/lib/ensure-session";
import { getDashboardLiveSnapshot } from "@/lib/data-provider";

// Dynamic, not ISR: live data sits in each serverless instance's memory, and an
// ISR copy rendered on a cold instance would serve the frozen baseline for up to
// 15 min. The root layout's warmSession() keeps this cheap (per-instance cache).
export const dynamic = "force-dynamic";

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
