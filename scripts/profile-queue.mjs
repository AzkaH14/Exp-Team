/** Isolates which stage of the /tickets path is slow. Progressive sizes to spot superlinearity. */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const l of readFileSync(join(root, ".env.local"), "utf-8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] ??= m[2].trim();
}
const T = async (label, fn) => {
  const t = performance.now(); const r = await fn();
  console.log(`  ${(performance.now()-t).toFixed(0).padStart(7)}ms  ${label}`); return r;
};
const { getHistoricalTickets } = await import("../src/lib/historical.ts");
const { filterExcludedTickets } = await import("../src/lib/client-registry/hubspot-blocklist.ts");
const { filterCancelledTickets } = await import("../src/lib/client-registry/filter-cancelled-analytics.ts");
const { normalizeTicketsByRegistry } = await import("../src/lib/integrations/hubspot-sync.ts");
const { enrichTicketForQueue, summarizeTicketQueue, listFamiliesForTicketFilter } =
  await import("../src/lib/ticket-queue-intelligence.ts");

const all = getHistoricalTickets();
console.log(`frozen index: ${all.length} tickets\n`);

for (const n of [1000, all.length]) {
  const slice = all.slice(0, n);
  console.log(`--- n = ${n} ---`);
  const a = await T("filterExcludedTickets", () => filterExcludedTickets(slice));
  const b = await T("filterCancelledTickets", () => filterCancelledTickets(a));
  const c = await T("normalizeTicketsByRegistry", () => normalizeTicketsByRegistry(b));
  const rows = await T("enrich all", () => c.map(t => enrichTicketForQueue(t)));
  await T("summarizeTicketQueue", () => summarizeTicketQueue(rows));
  await T("listFamiliesForTicketFilter", () => listFamiliesForTicketFilter());
  console.log("");
}
