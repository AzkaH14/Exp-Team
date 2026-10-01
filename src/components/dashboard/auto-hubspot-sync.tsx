"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

const DEFAULT_INTERVAL_MS = 30 * 60 * 1000;
/** How often to check whether the interval has elapsed while a tab stays open. */
const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const STORAGE_KEY = "mohsyn.hubspot.lastAutoSyncAt";

/**
 * Background sync (frozen history + live Odoo) at most once per interval
 * while the board is open, tracked per-browser in localStorage.
 *
 * This is the only periodic refresh mechanism — there is no Vercel Cron.
 * Vercel Cron on Hobby caps at once/day, which added nothing this doesn't
 * already cover: any visitor's browser self-heals within ~60s of opening the
 * tab if the interval has elapsed. The one gap this leaves — the board goes
 * fully unvisited for a stretch and the first visitor after that briefly
 * sees stale/frozen data until their own sync completes — is an accepted,
 * self-correcting tradeoff for an actively-used internal tool.
 */
export function AutoHubSpotSync({
  intervalMs = DEFAULT_INTERVAL_MS,
  cold = false,
}: {
  intervalMs?: number;
  /**
   * The server rendered this page WITHOUT live data (no in-memory cache on this
   * serverless instance) — it is showing the frozen pre-cutover baseline. That
   * baseline is now weeks past the cutover, so every client reads as stale /
   * underutilising until a live sync lands. When cold, warm immediately and
   * ignore the per-browser throttle: the throttle tracks this browser, but the
   * cache is per-instance, so a browser that synced recently elsewhere must
   * still warm a different cold instance it lands on.
   */
  cold?: boolean;
}) {
  const router = useRouter();
  const inFlight = useRef(false);
  const forcedColdSync = useRef(false);

  useEffect(() => {
    const due = () => {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        const last = raw ? Number(raw) : 0;
        if (!Number.isFinite(last) || last <= 0) return true;
        return Date.now() - last >= intervalMs;
      } catch {
        return true;
      }
    };

    const markDone = () => {
      try {
        window.localStorage.setItem(STORAGE_KEY, String(Date.now()));
      } catch {
        // ignore
      }
    };

    const run = async () => {
      if (document.visibilityState !== "visible") return;
      if (inFlight.current) return;
      // A cold render warms once per mount regardless of the throttle; every
      // other check respects the per-browser interval.
      const forceCold = cold && !forcedColdSync.current;
      if (!forceCold && !due()) return;
      inFlight.current = true;
      if (forceCold) forcedColdSync.current = true;
      try {
        const res = await fetch("/api/sync/hubspot", { method: "POST" });
        if (res.ok) {
          markDone();
          router.refresh();
        }
      } catch {
        // silent — manual Sync still available
      } finally {
        inFlight.current = false;
      }
    };

    // Cold instances self-heal within a couple of seconds; a warm page just
    // checks whether the refresh interval has elapsed.
    const initial = window.setTimeout(run, cold ? 2_000 : 60_000);
    const id = window.setInterval(run, CHECK_INTERVAL_MS);

    return () => {
      window.clearTimeout(initial);
      window.clearInterval(id);
    };
  }, [intervalMs, router, cold]);

  return null;
}
