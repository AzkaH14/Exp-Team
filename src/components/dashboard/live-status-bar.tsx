"use client";

import { RefreshCw, Wifi, WifiOff } from "lucide-react";
import { cn, formatNumber, formatSyncTime } from "@/lib/utils";

interface LiveStatusBarProps {
  lastUpdated: string | null;
  isSyncing: boolean;
  error: string | null;
  source?: "odoo" | "hubspot" | "static";
  ticketCount?: number;
  onRefresh?: () => void;
}

export function LiveStatusBar({
  lastUpdated,
  isSyncing,
  error,
  source,
  ticketCount,
  onRefresh,
}: LiveStatusBarProps) {
  const formatted = formatSyncTime(lastUpdated);

  const sourceLabel =
    source === "hubspot"
      ? lastUpdated
        ? `HubSpot live${ticketCount != null ? ` · ${formatNumber(ticketCount)} tickets` : ""}`
        : `HubSpot snapshot${ticketCount != null ? ` · ${formatNumber(ticketCount)} tickets` : ""}`
      : error
        ? "Static fallback — HubSpot sync failed"
        : "Legacy report data (not HubSpot)";

  return (
    <div className="flex items-center gap-3 rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
      {error ? (
        <WifiOff className="h-3.5 w-3.5 shrink-0 text-red-500" />
      ) : (
        <Wifi className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
      )}
      <span className="min-w-0 flex-1">
        {sourceLabel}
        {source === "hubspot" && lastUpdated && <> · Updated {formatted}</>}
        {source === "hubspot" && !lastUpdated && (
          <> · Bundled with deploy · Sync for live refresh</>
        )}
        {source !== "hubspot" && !error && (
          <> · Click Sync to load from HubSpot</>
        )}
        {source !== "hubspot" && error && (
          <span className="ml-1 text-red-500">· {error}</span>
        )}
      </span>
      <button
        type="button"
        onClick={() => onRefresh?.()}
        disabled={isSyncing}
        className="flex items-center gap-1 rounded px-2 py-1 hover:bg-muted disabled:opacity-50"
        title="Sync from HubSpot"
      >
        <RefreshCw
          className={cn("h-3.5 w-3.5", isSyncing && "animate-spin text-primary")}
        />
        <span className="hidden sm:inline">Sync</span>
      </button>
    </div>
  );
}
