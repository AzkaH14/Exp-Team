import { AppHeader } from "@/components/dashboard/app-header";
import { EngagementCalendar } from "@/components/dashboard/engagement-calendar";
import { getEngagementCalendarData } from "@/lib/engagement/calendar-data";
import { ensureSession } from "@/lib/ensure-session";

export const dynamic = "force-dynamic";

export default async function EngagementCalendarPage() {
  await ensureSession();
  const initial = await getEngagementCalendarData("all");

  return (
    <>
      <AppHeader
        title="Engagement Calendar"
        description="Plan outreach by city — underutilising clients highlighted; every family touched monthly"
      />
      <EngagementCalendar initial={initial} />
    </>
  );
}
