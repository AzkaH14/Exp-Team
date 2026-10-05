import { AppHeader } from "@/components/dashboard/app-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getUrgentAttentionClients } from "@/lib/qol-engine";
import { getAnalyticsData } from "@/lib/analytics-data";

// Dynamic, not ISR: live data sits in each serverless instance's memory, and an
// ISR copy rendered on a cold instance would serve the frozen baseline for up to
// 15 min. The root layout's warmSession() keeps this cheap (per-instance cache).
export const dynamic = "force-dynamic";

export default function AlertsPage() {
  const urgent = getUrgentAttentionClients(20);
  const analytics = getAnalyticsData();

  const operationalAlerts = [
    {
      id: "forecast",
      severity: "medium" as const,
      title: "June volume forecast exceeds May",
      detail: `Monte Carlo median ~${analytics.monteCarlo.p50} tickets (P90: ${analytics.monteCarlo.p90})`,
    },
    {
      id: "concentration",
      severity: "high" as const,
      title: "Top 10 client concentration",
      detail: "Top 10 clients account for 38.3% of all ticket volume",
    },
    {
      id: "complaints",
      severity: "medium" as const,
      title: "Customer complaints",
      detail: "11 complaint tickets require root-cause analysis within 48h",
    },
    {
      id: "data-hygiene",
      severity: "low" as const,
      title: "Data hygiene",
      detail: "Unspecified categories and sparse email records detected",
    },
  ];

  const severityVariant = {
    high: "destructive" as const,
    medium: "warning" as const,
    low: "secondary" as const,
  };

  return (
    <>
      <AppHeader
        title="Alerts"
        description="Operational alerts and QoL risk notifications"
      />

      <div className="mb-6 grid gap-4 md:grid-cols-2">
        {operationalAlerts.map((a) => (
          <Card key={a.id}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">{a.title}</CardTitle>
                <Badge variant={severityVariant[a.severity]}>{a.severity}</Badge>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{a.detail}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">QoL Risk Alerts ({urgent.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-3">
            {urgent.map((c) => (
              <li key={c.slug} className="flex items-center justify-between border-b pb-2 last:border-0">
                <div>
                  <p className="font-medium">{c.client}</p>
                  <p className="text-xs text-muted-foreground">
                    {c.city} · QoL {c.overall} · {c.urgentFlags.join(", ")}
                  </p>
                </div>
                <Badge variant="warning">{c.band}</Badge>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}
