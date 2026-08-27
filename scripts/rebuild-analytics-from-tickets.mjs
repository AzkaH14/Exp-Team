/**
 * Rebuild src/data/analytics.json from src/data/tickets.json (HubSpot export).
 * Run after HubSpot sync before deploying to Vercel.
 */
import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const { buildAnalyticsFromTickets } = await import("../src/lib/analytics-build.ts");
const { filterExcludedTickets } = await import(
  "../src/lib/client-registry/hubspot-blocklist.ts"
);
const {
  canonicalizeHubSpotClientName,
  matchRegistryRecord,
} = await import("../src/lib/client-registry/name-match.ts");
const { applyRegistrySupplement } = await import(
  "../src/lib/client-registry/registry-supplement.ts"
);

const registry = applyRegistrySupplement(
  JSON.parse(readFileSync(join(root, "src/data/client-registry.json"), "utf-8")).clients
);

const raw = JSON.parse(readFileSync(join(root, "src/data/tickets.json"), "utf-8"));
let tickets = filterExcludedTickets(raw).map((t) => ({
  ...t,
  client: canonicalizeHubSpotClientName(t.client, registry),
}));

if (process.env.CLIENT_REGISTRY_FILTER !== "false") {
  tickets = tickets.filter((t) => {
    const match = matchRegistryRecord(t.client, registry);
    return match != null && match.status !== "cancelled";
  });
} else {
  tickets = tickets.filter((t) => {
    const match = matchRegistryRecord(t.client, registry);
    return !match || match.status !== "cancelled";
  });
}

const analytics = {
  ...buildAnalyticsFromTickets(tickets),
  exportedAt: new Date().toISOString(),
};

writeFileSync(join(root, "src/data/analytics.json"), JSON.stringify(analytics, null, 2));
console.log(
  `Wrote analytics.json: ${analytics.kpis.totalTickets} tickets, ${analytics.kpis.uniqueClients} clients, period ${analytics.period}`
);
