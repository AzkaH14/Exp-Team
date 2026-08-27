/**
 * Per-cold-instance compute cost, old pipeline vs new.
 * Run: npx tsx --conditions=react-server scripts/bench-compute.mjs
 *
 * Measures CPU only — the Odoo network fetch is excluded, since it happens
 * once per cron/refresh rather than per render.
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const l of readFileSync(join(root, ".env.local"), "utf-8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2].trim();
}
const ms = (a, b) => (b - a).toFixed(1).padStart(7) + "ms";
const mb = (p) => (readFileSync(join(root, "src/data", p)).length / 1048576).toFixed(2);

console.log("=== OLD: full rebuild from the monolithic snapshot ===");
{
  const file = join(root, "src/data/tickets.json");
  const t0 = performance.now();
  const raw = JSON.parse(readFileSync(file, "utf8"));
  const t1 = performance.now();
  const { filterExcludedTickets } = await import("../src/lib/client-registry/hubspot-blocklist.ts");
  const { buildAnalyticsFromTickets } = await import("../src/lib/analytics-build.ts");
  const t2 = performance.now();
  const filtered = filterExcludedTickets(raw);
  const t3 = performance.now();
  buildAnalyticsFromTickets(filtered);
  const t4 = performance.now();
  console.log(`  tickets.json              ${mb("tickets.json")} MB, ${raw.length} rows`);
  console.log(`  JSON.parse               ${ms(t0, t1)}`);
  console.log(`  module import            ${ms(t1, t2)}`);
  console.log(`  filterExcludedTickets    ${ms(t2, t3)}`);
  console.log(`  buildAnalyticsFromTickets${ms(t3, t4)}`);
  console.log(`  TOTAL                    ${ms(t0, t4)}`);
}

console.log("\n=== NEW: frozen aggregate + live delta ===");
{
  const { accumulate, mergeAggregates, finalizeAggregate } =
    await import("../src/lib/analytics-aggregate.ts");
  const { getHistoricalAggregate, getHistoricalTickets } =
    await import("../src/lib/historical.ts");

  const t0 = performance.now();
  const histAgg = getHistoricalAggregate();
  const histTickets = getHistoricalTickets();
  const t1 = performance.now();

  // Stand in for the Odoo delta without hitting the network: the newest
  // ~330 historical rows are the same order of magnitude.
  const delta = histTickets.slice(0, 330);
  const t2 = performance.now();
  const deltaAgg = accumulate(delta);
  const t3 = performance.now();
  const merged = mergeAggregates(histAgg, deltaAgg);
  const t4 = performance.now();
  finalizeAggregate(merged, { source: "bench" });
  const t5 = performance.now();

  console.log(`  index ${mb("historical-tickets-index.json")} MB (${histTickets.length} rows) + aggregate ${mb("historical-aggregates.json")} MB`);
  console.log(`  detail ${mb("historical-tickets-detail.json")} MB — NOT loaded on this path`);
  console.log(`  load frozen files        ${ms(t0, t1)}`);
  console.log(`  accumulate delta (330)   ${ms(t2, t3)}`);
  console.log(`  mergeAggregates          ${ms(t3, t4)}`);
  console.log(`  finalizeAggregate        ${ms(t4, t5)}`);
  console.log(`  TOTAL (excl. import)     ${ms(t2, t5)}`);
  console.log(`  TOTAL (incl. file load)  ${ms(t0, t5)}`);
}
