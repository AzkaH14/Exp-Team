import { AppHeader } from "@/components/dashboard/app-header";
import { TicketsTable } from "@/components/dashboard/tickets-table";
import { getAnalyticsData } from "@/lib/analytics-data";
import { getTicketsPage } from "@/lib/tickets-query";

// Dynamic, not ISR: live data sits in each serverless instance's memory, and an
// ISR copy rendered on a cold instance would serve the frozen baseline for up to
// 15 min. The root layout's warmSession() keeps this cheap (per-instance cache).
export const dynamic = "force-dynamic";

export default function TicketsPage() {
  const { totalTickets } = getAnalyticsData().kpis;
  const initial = getTicketsPage();

  return (
    <>
      <AppHeader
        title="Ticket Queue"
        description="Service quality, open duration, and attention flags — filter by family"
      />
      <TicketsTable initial={initial} />
    </>
  );
}
