"use client";

import { useCallback, useState } from "react";
import type { DashboardLiveSnapshot } from "@/lib/types/dashboard";
import { MetricCards } from "./metric-cards";
import { DashboardCharts } from "./dashboard-charts";
import { QoLUrgentAttention } from "./qol-urgent-attention";
import { QoLDistributionChart } from "./qol-distribution-chart";
import { LiveStatusBar } from "./live-status-bar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface DashboardLiveContentProps {
  snapshot: DashboardLiveSnapshot;
}

export function DashboardLiveContent({ snapshot }: DashboardLiveContentProps) {
  const [live, setLive] = useState(snapshot);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(snapshot.sync?.error ?? null);

  const syncFromHubSpot = useCallback(async () => {
    setIsSyncing(true);
    try {
      const res = await fetch("/api/sync/hubspot", { method: "POST" });
      const data = (await res.json()) as {
        ok: boolean;
        dashboard?: DashboardLiveSnapshot;
        sync?: { error?: string | null };
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.sync?.error ?? "Sync failed");
      }
      if (data.dashboard) {
        setLive(data.dashboard);
        setError(data.dashboard.sync?.error ?? null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setIsSyncing(false);
    }
  }, []);

  // Home dashboard relies on layout AutoHubSpotSync (once per 24h) + manual Sync.

  const isLiveSource =
    live.sync?.source === "odoo" || live.sync?.source === "hubspot";

  return (
    <div className="space-y-6">
      {!isLiveSource && (
        <div className="rounded-md border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm text-amber-950">
          Showing legacy report data ({live.kpis.totalTickets.toLocaleString()} tickets
          {live.period ? `, ${live.period}` : ""}). Click <strong>Sync</strong> below to refresh
          from HubSpot. On Vercel, Sync updates this session in memory — for a permanent snapshot,
          redeploy after running{" "}
          <code className="rounded bg-amber-100 px-1">node scripts/sync-hubspot-tickets.mjs</code>{" "}
          locally.
        </div>
      )}

      {isLiveSource && live.sync?.lastSyncedAt == null && (
        <div className="rounded-md border border-sky-200 bg-sky-50/80 px-4 py-3 text-sm text-sky-950">
          {live.sync?.source === "odoo" ? (
            <>
              Frozen HubSpot history only ({live.kpis.totalTickets.toLocaleString()} tickets
              {live.period ? ` · ${live.period}` : ""}). Post-cutover tickets load from Odoo —
              click <strong>Sync</strong> to pull them.
            </>
          ) : (
            <>
              HubSpot snapshot bundled with this deploy (
              {live.kpis.totalTickets.toLocaleString()} tickets
              {live.period ? ` · ${live.period}` : ""}). Click <strong>Sync</strong> for a live
              refresh (stays on this server instance — avoid a hard browser refresh right after).
            </>
          )}
        </div>
      )}

      <LiveStatusBar
        lastUpdated={isLiveSource ? live.sync?.lastSyncedAt ?? null : null}
        isSyncing={isSyncing}
        error={error}
        source={live.sync?.source}
        ticketCount={live.sync?.ticketCount}
        onRefresh={syncFromHubSpot}
      />

      <MetricCards kpis={live.kpis} />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <QoLUrgentAttention clients={live.urgentClients} />
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">QoL Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <QoLDistributionChart data={live.qolDistribution} />
          </CardContent>
        </Card>
      </div>

      <DashboardCharts
        monthly={live.monthly}
        cities={live.cities}
        categories={live.categories}
        topSubServices={live.topSubServices}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Insights</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-inside list-disc space-y-2 text-sm text-muted-foreground">
              {live.insights.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recommendations</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-inside list-disc space-y-2 text-sm text-muted-foreground">
              {live.recommendations.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{live.forecast.forecastMonth} Forecast (Monte Carlo)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-6 text-sm">
            <div>
              <span className="text-muted-foreground">P10</span>
              <p className="text-xl font-bold">{live.monteCarlo.p10}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Median (P50)</span>
              <p className="text-xl font-bold">{live.monteCarlo.p50}</p>
            </div>
            <div>
              <span className="text-muted-foreground">P90</span>
              <p className="text-xl font-bold">{live.monteCarlo.p90}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Mean</span>
              <p className="text-xl font-bold">{live.monteCarlo.mean.toFixed(1)}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
