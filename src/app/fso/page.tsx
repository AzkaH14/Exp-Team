import { AppHeader } from "@/components/dashboard/app-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getAnalyticsData } from "@/lib/analytics-data";
import { formatNumber } from "@/lib/utils";

// Dynamic, not ISR: live data sits in each serverless instance's memory, and an
// ISR copy rendered on a cold instance would serve the frozen baseline for up to
// 15 min. The root layout's warmSession() keeps this cheap (per-instance cache).
export const dynamic = "force-dynamic";

const FSO_KEYWORDS = [
  "FSO",
  "Grocery",
  "Medicine",
  "Delivery",
  "Assistance",
  "Visit",
  "Errand",
];

function isFsoSubService(name: string): boolean {
  const lower = name.toLowerCase();
  return FSO_KEYWORDS.some((k) => lower.includes(k.toLowerCase()));
}

export default function FsoPage() {
  const analytics = getAnalyticsData();

  const fsoSubServices = analytics.topSubServices
    .filter((s) => isFsoSubService(s.subService))
    .slice(0, 12);

  const fsoTicketTotal = fsoSubServices.reduce((sum, s) => sum + s.tickets, 0);

  const fsoCategories = analytics.categories
    .filter((c) =>
      ["General FSO", "Healthcare", "Household", "Errands", "Transport"].some((k) =>
        c.category.toLowerCase().includes(k.toLowerCase())
      )
    )
    .slice(0, 8);

  return (
    <>
      <AppHeader
        title="FSO Operations"
        description="Field service volume from live HubSpot tickets"
        badge={analytics.period}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              FSO-related tickets
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{formatNumber(fsoTicketTotal)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Active clients
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{analytics.kpis.uniqueClients}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Service categories
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{analytics.kpis.serviceCategories}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top FSO sub-services</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {fsoSubServices.map((s) => (
                <li key={s.subService} className="flex justify-between border-b pb-2 last:border-0">
                  <span className="max-w-[70%] truncate text-muted-foreground">
                    {s.subService}
                  </span>
                  <span className="font-semibold">{s.tickets}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Volume by city</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {analytics.cities.map((c) => (
                <li key={c.city} className="flex justify-between border-b pb-2 last:border-0">
                  <span className="text-muted-foreground">{c.city}</span>
                  <span className="font-semibold">
                    {c.tickets} ({c.pct.toFixed(1)}%)
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      {fsoCategories.length > 0 && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-base">FSO category breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-2 sm:grid-cols-2 text-sm">
              {fsoCategories.map((c) => (
                <li
                  key={c.category}
                  className="flex justify-between rounded-md border px-3 py-2"
                >
                  <span className="text-muted-foreground">{c.category}</span>
                  <span className="font-semibold">{c.tickets}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <p className="mt-6 text-xs text-muted-foreground">
        Dispatch, routing, and capacity planning modules are planned — this view reflects
        live ticket data from HubSpot.
      </p>
    </>
  );
}
