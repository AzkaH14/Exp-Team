"use client";

import { RefreshCw } from "lucide-react";
import { cn, formatSyncTime } from "@/lib/utils";

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
  onRefresh,
}: LiveStatusBarProps) {
  const formatted = formatSyncTime(lastUpdated);

  return (
    <div className="flex items-center justify-end gap-3 rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
      {error ? (
        <span className="min-w-0 flex-1 text-red-500">Sync failed · {error}</span>
      ) : lastUpdated ? (
        <span className="min-w-0 flex-1">Synced {formatted}</span>
      ) : null}
      <button
        type="button"
        onClick={() => onRefresh?.()}
        disabled={isSyncing}
        className="flex items-center gap-1 rounded px-2 py-1 hover:bg-muted disabled:opacity-50"
        title="Sync new tasks from Odoo"
      >
        <RefreshCw
          className={cn("h-3.5 w-3.5", isSyncing && "animate-spin text-primary")}
        />
        <span className="hidden sm:inline">Sync</span>
      </button>
    </div>
  );
}
