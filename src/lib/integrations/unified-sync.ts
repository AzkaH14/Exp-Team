/**
 * The board's data pipeline: frozen HubSpot history + live Odoo delta.
 *
 * History is immutable and was filtered and aggregated at build time, so the
 * only per-request work is the small Odoo delta (~330 rows today, ~30/day) and
 * a merge of two count maps. That is what keeps the board inside the Vercel
 * free tier — see odoo_instruct.md §12.3.
 */
import "server-only";
import type { AnalyticsData } from "../analytics-data";
import type { Ticket } from "../types/ticket";
import {
  accumulate,
  finalizeAggregate,
  mergeAggregates,
  type TicketAggregate,
} from "../analytics-aggregate";
import {
  getHistoricalAggregate,
  getHistoricalMeta,
  getHistoricalTickets,
  isHistoricalAggregateFresh,
} from "../historical";
import {
  isExcludedHubSpotContact,
  REGISTRY_BLOCKLIST_VERSION,
} from "../client-registry/hubspot-blocklist";
import {
  canonicalizeHubSpotClientName,
  matchRegistryRecord,
} from "../client-registry/name-match";
import { getRegistryVersion, getSacredRegistry } from "../client-registry/store";
import { fetchOdooTickets } from "./odoo-sync";
import { isOdooConfigured } from "./odoo";

export interface UnifiedSyncResult {
  tickets: Ticket[];
  analytics: AnalyticsData;
  meta: {
    historicalCount: number;
    odooCount: number;
    /** True when the live Odoo fetch failed and only history is present. */
    degraded: boolean;
    odooError: string | null;
    /** True when the frozen aggregate had to be recomputed from the index. */
    aggregateRebuilt: boolean;
  };
}

/**
 * Same pipeline the build script applies to history, so both eras are filtered
 * identically: blocklist, then the sacred-registry whitelist, canonicalising
 * the client name on the way through.
 */
function filterByRegistry(tickets: Ticket[]): Ticket[] {
  const strict = process.env.CLIENT_REGISTRY_FILTER !== "false";
  const registry = getSacredRegistry();
  // Live Odoo tasks carry the customer's partner id — an exact key that name
  // matching can never misroute. Names are the fallback for history.
  const byPartner = new Map(
    registry
      .filter((r) => typeof r.odooPartnerId === "number")
      .map((r) => [r.odooPartnerId!, r] as const)
  );
  const out: Ticket[] = [];

  for (const t of tickets) {
    const partnerId = (t as Ticket & { partnerId?: number | null }).partnerId;
    const owner = typeof partnerId === "number" ? byPartner.get(partnerId) : undefined;
    if (owner) {
      out.push(owner.benefactor === t.client ? t : { ...t, client: owner.benefactor });
      continue;
    }
    if (isExcludedHubSpotContact(t.client)) continue;
    const canonical = canonicalizeHubSpotClientName(t.client, registry);
    if (strict && matchRegistryRecord(canonical, registry) === null) continue;
    out.push(canonical === t.client ? t : { ...t, client: canonical });
  }
  return out;
}

/**
 * The frozen aggregate bakes in the registry and blocklist current at build
 * time. If either has moved, recompute from the frozen index rather than
 * serving stale counts — correct but slower, and loud about it.
 */
function historicalAggregate(): { aggregate: TicketAggregate; rebuilt: boolean } {
  if (isHistoricalAggregateFresh(getRegistryVersion(), REGISTRY_BLOCKLIST_VERSION)) {
    return { aggregate: getHistoricalAggregate(), rebuilt: false };
  }
  console.warn(
    `[unified-sync] Frozen aggregate is stale (built against registry ` +
      `${getHistoricalMeta().registryVersion}, now ${getRegistryVersion()}). ` +
      `Recomputing from the index — re-run scripts/build-historical.mjs to restore the fast path.`
  );
  return {
    aggregate: accumulate(filterByRegistry(getHistoricalTickets())),
    rebuilt: true,
  };
}

export async function syncAllTickets(): Promise<UnifiedSyncResult> {
  const historical = getHistoricalTickets();
  const { aggregate: histAgg, rebuilt } = historicalAggregate();

  let odoo: Ticket[] = [];
  let odooError: string | null = null;

  if (isOdooConfigured()) {
    try {
      odoo = filterByRegistry(await fetchOdooTickets());
    } catch (e) {
      // Never silently serve history as if it were current.
      odooError = e instanceof Error ? e.message : "Odoo fetch failed";
      console.warn("[unified-sync] Odoo fetch failed:", odooError);
    }
  } else {
    odooError = "Odoo is not configured";
  }

  const merged = mergeAggregates(histAgg, accumulate(odoo));
  const meta = getHistoricalMeta();

  const analytics = finalizeAggregate(merged, {
    source: odooError
      ? `HubSpot history to ${meta.cutover} (Odoo unavailable)`
      : `Odoo Field Service + HubSpot history to ${meta.cutover}`,
    periodFallback: meta.cutover,
  });

  return {
    // Odoo first: newest tickets lead the queue, matching the previous
    // createdate-DESC ordering from HubSpot.
    tickets: [...odoo, ...historical],
    analytics,
    meta: {
      historicalCount: historical.length,
      odooCount: odoo.length,
      degraded: odooError !== null,
      odooError,
      aggregateRebuilt: rebuilt,
    },
  };
}
