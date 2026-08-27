import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatNumber } from "@/lib/utils";
import type { DashboardLiveSnapshot } from "@/lib/types/dashboard";

interface MetricCardsProps {
  kpis: DashboardLiveSnapshot["kpis"];
}

export function MetricCards({ kpis }: MetricCardsProps) {
  const metrics = [
    { label: "Total Tickets", value: formatNumber(kpis.totalTickets) },
    { label: "Unique Clients", value: formatNumber(kpis.uniqueClients) },
    { label: "Service Categories", value: String(kpis.serviceCategories) },
    { label: "Sub-services", value: String(kpis.distinctSubServices) },
    {
      label: kpis.momLabel,
      value: `${kpis.momDelta >= 0 ? "+" : ""}${kpis.momDelta}`,
      sub: "tickets MoM",
    },
    {
      label: kpis.forecastLabel,
      value: `~${formatNumber(kpis.forecastValue)}`,
      sub: "trend projection",
    },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      {metrics.map((m) => (
        <Card key={m.label}>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              {m.label}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{m.value}</div>
            {m.sub && <p className="text-xs text-muted-foreground">{m.sub}</p>}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
