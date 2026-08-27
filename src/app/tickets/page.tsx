import { AppHeader } from "@/components/dashboard/app-header";
import { TicketsTable } from "@/components/dashboard/tickets-table";
import { getAnalyticsData } from "@/lib/analytics-data";
import { getTicketsPage } from "@/lib/tickets-query";

// ISR — was only dynamic transitively via the root layout's force-dynamic (removed).
export const revalidate = 900;

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
