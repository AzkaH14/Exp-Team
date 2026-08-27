import { AppHeader } from "@/components/dashboard/app-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { INTEGRATIONS, getIntegrationStatus } from "@/lib/integrations/config";
import { getDataSyncMeta } from "@/lib/data-source";
import { isGoogleSheetsConfigured } from "@/lib/integrations/google-sheets";
import { HubSpotSyncButton } from "@/components/dashboard/hubspot-sync-button";
import { formatNumber, formatSyncTime } from "@/lib/utils";

// ISR — was only dynamic transitively via the root layout's force-dynamic (removed).
export const revalidate = 900;

export default function SettingsPage() {
  const syncMeta = getDataSyncMeta();

  return (
    <>
      <AppHeader
        title="Integrations"
        description="Connect HubSpot, Odoo, and WhatsApp for live data sync"
      />

      <Card className="mb-4 border-blue-200 bg-blue-50/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Sacred registry (Google Sheet)</CardTitle>
          <CardDescription>
            Live sheet:{" "}
            <a
              href="https://docs.google.com/spreadsheets/d/1pTj0G-cXt30Vx2A_qiLwIA9M2rQ4tqZPe60AGnUwcis"
              className="underline"
              target="_blank"
              rel="noreferrer"
            >
              Client Data Base
            </a>
            {" · "}
            {isGoogleSheetsConfigured()
              ? "Connected via published CSV — syncs on HubSpot refresh"
              : "Not connected — add GOOGLE_SHEETS_PUBLISH_CSV_URL to .env.local"}
          </CardDescription>
        </CardHeader>
      </Card>

      {(syncMeta.source === "odoo" ||
        syncMeta.source === "hubspot" ||
        syncMeta.source === "static") && (
        <Card className="mb-4 border-emerald-200 bg-emerald-50/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              {syncMeta.source === "odoo" ? "Session cache" : "HubSpot session cache"}
            </CardTitle>
            <CardDescription>
              {formatNumber(syncMeta.ticketCount)} tickets · {syncMeta.clientCount}{" "}
              clients
              {syncMeta.lastSyncedAt &&
                ` · Loaded ${formatSyncTime(syncMeta.lastSyncedAt)}`}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-center gap-3">
            <HubSpotSyncButton />
            {syncMeta.error && (
              <span className="text-sm text-red-600">{syncMeta.error}</span>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {INTEGRATIONS.map((integration) => {
          const status = getIntegrationStatus(integration.id);
          return (
            <Card key={integration.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{integration.name}</CardTitle>
                  <Badge
                    variant={
                      status === "connected"
                        ? "success"
                        : status === "pending"
                          ? "warning"
                          : "secondary"
                    }
                  >
                    {status}
                  </Badge>
                </div>
                <CardDescription>{integration.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  Required env: {integration.envKeys.join(", ")}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </>
  );
}
