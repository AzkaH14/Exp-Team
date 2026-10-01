import "server-only";
import { waitUntil } from "@vercel/functions";
import type { AnalyticsData } from "./analytics-data";
import { getRegistryVersion } from "./client-registry/store";
import { isBundledHubSpotAnalytics } from "./analytics-build";
import {
  isHubSpotConfigured,
  syncHubSpotData,
} from "./integrations/hubspot-sync";
import {
  isHubSpotBirthdaysConfigured,
  syncHubSpotBirthdays,
} from "./integrations/hubspot-birthdays-sync";
import {
  isHubSpotNotesConfigured,
  syncHubSpotNotes,
} from "./integrations/hubspot-notes-sync";
import { setHubSpotBirthdayCache } from "./client-registry/hubspot-birthdays";
import { setHubSpotNotesCache } from "./client-registry/hubspot-notes";
import { syncSacredRegistryFromSheet } from "./client-registry/sheet-sync";
import { isOdooRegistryEnabled, syncOdooRegistry } from "./integrations/odoo-registry";
import { filterExcludedTickets, filterAnalyticsData } from "./client-registry/hubspot-blocklist";
import {
  filterCancelledAnalyticsClients,
  filterCancelledTickets,
  invalidateCancelledFilterCaches,
} from "./client-registry/filter-cancelled-analytics";
import { normalizeTicketsByRegistry } from "./integrations/hubspot-sync";
import { isGoogleSheetsConfigured } from "./integrations/google-sheets";
import {
  clearSessionDerived,
  getSessionDerived,
  rebuildSessionMetrics,
} from "./session-metrics";
import { invalidateFamilyReportCache } from "./reports/report-cache";
import { invalidateReportTicketIndex } from "./reports/ticket-index";
import { invalidateDashboardSnapshotCache } from "./data-provider";
import { invalidateMergedClientProfilesCache } from "./client-registry/merge";
import { invalidateReconcileCache } from "./client-registry/reconcile";
import { invalidateTicketIndex } from "./tickets-data";
import { invalidateTicketsQueryCache } from "./tickets-query";
import { invalidateLastActivityCache } from "./engagement/last-activity";
import {
  invalidateUnderutilisingSheetCache,
  refreshUnderutilisingSheetCache,
} from "./engagement/underutilising-sheet";
import { isUnderutilisingSheetConfigured } from "./integrations/google-sheets";
import { mergeInsightNotesOntoTickets } from "./ticket-insight-notes";
import { syncAllTickets } from "./integrations/unified-sync";
import {
  getHistoricalAggregate,
  getHistoricalMeta,
  getHistoricalTickets,
} from "./historical";
import { finalizeAggregate } from "./analytics-aggregate";
import type { Ticket } from "./types/ticket";

/**
 * HubSpot is dead as an operational source. `unified` = frozen HubSpot history
 * + live Odoo. Set MOHSYN_DATA_SOURCE=hubspot to fall back to the old live
 * HubSpot path while it still exists.
 */
function isUnifiedSource(): boolean {
  return process.env.MOHSYN_DATA_SOURCE?.trim() !== "hubspot";
}

export interface DataSyncMeta {
  /** "odoo" = frozen HubSpot history + live Odoo delta (the current pipeline). */
  source: "odoo" | "hubspot" | "static";
  lastSyncedAt: string | null;
  ticketCount: number;
  clientCount: number;
  syncing: boolean;
  error: string | null;
}

export interface WarmSessionOptions {
  /** Re-fetch all tickets from HubSpot (Sync button / explicit refresh) */
  force?: boolean;
  /** Pull sacred registry from Google Sheet (slow — default off unless force) */
  syncSheet?: boolean;
}

interface CacheState {
  tickets: Ticket[];
  analytics: AnalyticsData;
  syncedAt: number;
  registryVersion: string;
}

interface MohsynStore {
  cache: CacheState | null;
  syncPromise: Promise<void> | null;
  lastError: string | null;
}

/** Persist across Next.js dev HMR so tab navigation stays fast after first sync */
const globalStore = globalThis as typeof globalThis & {
  __mohsynStore?: MohsynStore;
};

if (!globalStore.__mohsynStore) {
  globalStore.__mohsynStore = {
    cache: null,
    syncPromise: null,
    lastError: null,
  };
}

const store = globalStore.__mohsynStore;

/** On Vercel, skip merging 5k+ ticket insight notes into every request (reports load notes separately). */
/** Ticket-notes merge is opt-in — keep default off for faster page loads. */
function shouldMergeTicketInsightNotes(): boolean {
  return process.env.MOHSYN_MERGE_TICKET_NOTES === "true";
}

/**
 * Zero-network baseline for readers that never trigger a sync (API routes,
 * cold instances) — the frozen, pre-cutover HubSpot history.
 *
 * Used in BOTH modes. There is no separate "static" snapshot anymore — the
 * old bundled tickets.json/analytics.json were an unfiltered mid-July dump
 * that silently lied about being current (5,781 vs the real 7,397+); this is
 * real, correctly-filtered data through the cutover, just missing whatever
 * hasn't synced from Odoo yet on this instance.
 */
function baselineTickets(): Ticket[] {
  return getHistoricalTickets();
}

let baselineAnalyticsCache: AnalyticsData | null = null;

function baselineAnalytics(): AnalyticsData {
  if (!baselineAnalyticsCache) {
    const meta = getHistoricalMeta();
    baselineAnalyticsCache = finalizeAggregate(getHistoricalAggregate(), {
      source: `HubSpot history to ${meta.cutover} (Odoo not yet loaded)`,
      periodFallback: meta.cutover,
    });
  }
  return baselineAnalyticsCache;
}

let mergedTicketsCache: { raw: Ticket[]; merged: Ticket[] } | null = null;

function invalidateMergedTicketsCache(): void {
  mergedTicketsCache = null;
}

function hasLiveCache(): boolean {
  if (isUnifiedSource()) return Boolean(store.cache);
  return Boolean(store.cache && isHubSpotConfigured());
}

/**
 * Filter + canonicalize the ticket list, memoized on the SOURCE array.
 *
 * The memo used to key on `filtered` — the output of
 * filterCancelledTickets(filterExcludedTickets(raw)) — but those return a new
 * array every call, so the reference check never matched and the whole
 * pipeline (two full blocklist scans plus a canonicalization pass over every
 * ticket) re-ran on EVERY call. getTicketsPage() alone calls this three times.
 *
 * Keying on `raw` instead makes it run once per sync. Invalidated by
 * invalidateMergedTicketsCache() whenever the cache or registry changes.
 */
function cachedTickets(): Ticket[] {
  const raw = store.cache ? store.cache.tickets : baselineTickets();
  if (mergedTicketsCache?.raw === raw) {
    return mergedTicketsCache.merged;
  }

  const filtered = filterCancelledTickets(filterExcludedTickets(raw));
  let merged = normalizeTicketsByRegistry(filtered);
  if (shouldMergeTicketInsightNotes()) {
    merged = mergeInsightNotesOntoTickets(merged);
  }

  mergedTicketsCache = { raw, merged };
  return merged;
}

function cachedAnalytics(): AnalyticsData {
  const raw = store.cache ? store.cache.analytics : baselineAnalytics();
  return filterCancelledAnalyticsClients(filterAnalyticsData(raw));
}

/**
 * Zero-network baseline.
 *
 * Under `unified` this is the frozen HubSpot history, which is real data
 * through the cutover rather than a stale mid-July snapshot — so a cold
 * instance that never reaches Odoo still renders a correct board, just
 * without the post-cutover tail.
 */
function getStaticFallback(): CacheState {
  return {
    tickets: baselineTickets(),
    analytics: baselineAnalytics(),
    syncedAt: 0,
    registryVersion: getRegistryVersion(),
  };
}

function ensureDerived(state: CacheState): void {
  if (!getSessionDerived()) {
    invalidateTicketIndex();
    invalidateTicketsQueryCache();
    const tickets = normalizeTicketsByRegistry(
      filterCancelledTickets(filterExcludedTickets(state.tickets))
    );
    rebuildSessionMetrics(
      filterCancelledAnalyticsClients(filterAnalyticsData(state.analytics)),
      tickets
    );
  }
}

export function getDataSyncMeta(): DataSyncMeta {
  const live = hasLiveCache();

  if (isUnifiedSource()) {
    // The frozen history is real data through the cutover, so an instance that
    // has not reached Odoo yet is still "odoo" — never the "static" warning.
    return {
      source: "odoo",
      lastSyncedAt: live ? new Date(store.cache!.syncedAt).toISOString() : null,
      ticketCount: live
        ? store.cache!.tickets.length
        : getHistoricalMeta().keptRows,
      clientCount: live
        ? store.cache!.analytics.kpis.uniqueClients
        : Object.keys(getHistoricalAggregate().clients).length,
      syncing: store.syncPromise !== null,
      error: store.lastError,
    };
  }

  // MOHSYN_DATA_SOURCE=hubspot escape hatch: falls back to the same frozen
  // history baseline (not a stale bundled JSON) until a live HubSpot sync runs.
  const bundledHubSpot = !live && isBundledHubSpotAnalytics(baselineAnalytics());
  return {
    source: live || bundledHubSpot ? "hubspot" : "static",
    lastSyncedAt: live
      ? new Date(store.cache!.syncedAt).toISOString()
      : bundledHubSpot
        ? baselineAnalytics().exportedAt ?? null
        : null,
    ticketCount: live
      ? store.cache!.tickets.length
      : bundledHubSpot
        ? baselineTickets().length
        : baselineAnalytics().kpis.totalTickets,
    clientCount: live
      ? store.cache!.analytics.kpis.uniqueClients
      : baselineAnalytics().kpis.uniqueClients,
    syncing: store.syncPromise !== null,
    error: store.lastError,
  };
}

/**
 * Warm the session: HubSpot fetch runs ONCE until manual force refresh.
 * Tab navigation reuses in-memory cache + precomputed metrics (fast).
 */
export async function warmSession(
  options: WarmSessionOptions = {}
): Promise<DataSyncMeta> {
  const force = options.force ?? false;

  // Reuse a fresh in-memory snapshot as-is — the fast path for repeat renders
  // on a warm instance. Each serverless instance keeps its own cache, so this
  // is what stops a hot instance from re-pulling Odoo on every request.
  const FRESH_MS = Number(process.env.HUBSPOT_CACHE_FRESH_MS ?? 12 * 60 * 1000);
  const registryVersion = getRegistryVersion();
  const cacheFresh =
    store.cache !== null &&
    Date.now() - store.cache.syncedAt < FRESH_MS &&
    store.cache.registryVersion === registryVersion;

  if (!force && cacheFresh) {
    ensureDerived(store.cache!);
    return getDataSyncMeta();
  }

  if (!isUnifiedSource() && !isHubSpotConfigured()) {
    const state = getStaticFallback();
    ensureDerived(state);
    return getDataSyncMeta();
  }

  const cacheStale =
    store.cache !== null && store.cache.registryVersion !== registryVersion;

  // Block the render on the fetch when this instance has nothing fresh to show
  // (cold, or a version-stale cache) or a manual Sync forces it — so a cold
  // serverless instance never serves the frozen pre-cutover baseline while it
  // can reach Odoo. That is what keeps the board consistent across tab moves:
  // every instance warms itself to the same figure on its first render.
  // An instance whose cache has merely AGED keeps serving it and refreshes in
  // the background, so navigation never flickers back to history.
  const blockOnFetch = force || store.cache === null || cacheStale;

  if (store.syncPromise) {
    if (blockOnFetch) {
      await store.syncPromise;
      return getDataSyncMeta();
    }
    ensureDerived(store.cache ?? getStaticFallback());
    return getDataSyncMeta();
  }

  store.syncPromise = (async () => {
    try {
      const odooRegistry = isOdooRegistryEnabled();
      const syncSheet =
        options.syncSheet ??
        (force && process.env.SACRED_SHEET_ON_WARM?.trim() !== "false");

      if (odooRegistry) {
        // Odoo is the client registry: benefactors, beneficiaries, status,
        // birthdays, Family Overview and chatter. Runs BEFORE the ticket sync,
        // which filters tickets against the registry.
        const reg = await syncOdooRegistry();
        if (!reg.ok) {
          console.warn("Odoo registry sync:", reg.error);
        } else {
          console.info(
            `Odoo registry: ${reg.clientCount} clients, ${reg.withoutBeneficiaries.length} without beneficiaries, ${reg.newIds.length} new ids`
          );
        }
      } else if (syncSheet && isGoogleSheetsConfigured()) {
        const sheetResult = await syncSacredRegistryFromSheet({
          // Pull new HubSpot benefactors into the live registry (default on)
          autoAddHubSpot:
            process.env.SACRED_AUTO_ADD_HUBSPOT?.trim() !== "false",
        });
        if (!sheetResult.ok) {
          console.warn("Sacred sheet sync:", sheetResult.error);
        }
      }

      const { tickets, analytics } = isUnifiedSource()
        ? await syncAllTickets()
        : await syncHubSpotData();
      if (isUnderutilisingSheetConfigured()) {
        try {
          await refreshUnderutilisingSheetCache(true);
        } catch (e) {
          console.warn("Underutilising sheet fetch failed:", e);
        }
      }
      // Birthdays and profile notes come from Odoo in registry mode; the
      // HubSpot contact caches only feed the legacy sheet path.
      if (!odooRegistry && isHubSpotBirthdaysConfigured()) {
        try {
          const { records, summary } = await syncHubSpotBirthdays();
          setHubSpotBirthdayCache(records);
          console.info(
            `HubSpot birthdays: ${summary.withBeneficiaryBirthday} beneficiary, ${summary.withBenefactorBirthday} benefactor`
          );
        } catch (e) {
          console.warn("HubSpot birthday sync failed:", e);
        }
      }
      if (!odooRegistry && isHubSpotNotesConfigured()) {
        try {
          const { records, summary } = await syncHubSpotNotes();
          setHubSpotNotesCache(records);
          console.info(
            `HubSpot notes: ${summary.withNotes} families, ${summary.totalNotes} notes`
          );
        } catch (e) {
          console.warn("HubSpot notes sync failed:", e);
        }
      }
      store.cache = {
        tickets,
        analytics,
        syncedAt: Date.now(),
        registryVersion: getRegistryVersion(),
      };
      store.lastError = null;
      clearSessionDerived();
      invalidateCancelledFilterCaches();
      invalidateMergedTicketsCache();
      invalidateMergedClientProfilesCache();
      invalidateReconcileCache();
      invalidateDashboardSnapshotCache();
      invalidateTicketIndex();
      invalidateReportTicketIndex();
      invalidateFamilyReportCache();
      invalidateTicketsQueryCache();
      invalidateLastActivityCache();
      invalidateUnderutilisingSheetCache();
      rebuildSessionMetrics(
        filterCancelledAnalyticsClients(filterAnalyticsData(analytics)),
        filterCancelledTickets(filterExcludedTickets(tickets))
      );
    } catch (e) {
      store.lastError =
        e instanceof Error
          ? e.message
          : isUnifiedSource()
            ? "Data sync failed"
            : "HubSpot sync failed";
      if (!store.cache) {
        const state = getStaticFallback();
        ensureDerived(state);
      }
    } finally {
      store.syncPromise = null;
    }
  })();

  if (blockOnFetch) {
    await store.syncPromise;
    return getDataSyncMeta();
  }

  // Background refresh of an aged cache: the response goes out now with the
  // cached data. waitUntil keeps the Vercel function alive until the refresh
  // finishes, so it is not cut off once the response is sent (no-op locally).
  waitUntil(store.syncPromise);

  const state = store.cache ?? getStaticFallback();
  ensureDerived(state);
  return getDataSyncMeta();
}

/** @deprecated Use warmSession */
export async function ensureHubSpotSync(
  options: WarmSessionOptions & { allowFetch?: boolean } = {}
): Promise<DataSyncMeta> {
  if (options.allowFetch === false && !store.cache) {
    const state = getStaticFallback();
    ensureDerived(state);
    return getDataSyncMeta();
  }
  return warmSession({ force: options.force });
}

export function getLiveTickets(): Ticket[] {
  return cachedTickets();
}

/** Use in-memory/static tickets only — never triggers HubSpot fetch */
export function ensureCachedSession(): DataSyncMeta {
  if (store.cache) {
    ensureDerived(store.cache);
  } else {
    ensureDerived(getStaticFallback());
  }
  return getDataSyncMeta();
}

export function getLiveAnalytics(): AnalyticsData {
  return cachedAnalytics();
}
