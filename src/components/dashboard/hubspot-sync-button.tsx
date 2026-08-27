"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function HubSpotSyncButton() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSync() {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/sync/hubspot", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.sync?.error ?? "Sync failed");
      }
      setMessage(
        `Synced ${data.sync.ticketCount?.toLocaleString()} tickets · ${data.sync.clientCount} clients. Dashboard updated — open other pages or refresh once to pick up the new snapshot on this server.`
      );
      // Avoid full reload on Vercel: it often lands on a cold instance and shows stale bundled JSON.
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button size="sm" type="button" onClick={() => void handleSync()} disabled={loading}>
        <RefreshCw className={cn("mr-2 h-4 w-4", loading && "animate-spin")} />
        Sync now (Sheet + HubSpot)
      </Button>
      {message && <p className="text-xs text-muted-foreground">{message}</p>}
    </div>
  );
}
