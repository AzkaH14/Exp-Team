import { AppHeader } from "@/components/dashboard/app-header";
import { TouchbaseStatusBadges, TouchbaseTracker } from "@/components/dashboard/touchbase-tracker";
import { getTouchbaseData, parseMonthParam } from "@/lib/engagement/touchbase-data";
import { ensureSession } from "@/lib/ensure-session";

export const dynamic = "force-dynamic";

export default async function TouchbasePage() {
  await ensureSession();
  const initial = await getTouchbaseData(parseMonthParam(null));

  return (
    <>
      <AppHeader
        title="Touchbase Tracker"
        actions={<TouchbaseStatusBadges storageMode={initial.storageMode} odooLive={initial.odooLive} />}
      />
      <TouchbaseTracker initial={initial} />
    </>
  );
}
