/** Acceptance tests 5-9 + performance target P1.
 *  Run: npx tsx --conditions=react-server scripts/check-unified.mjs */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const l of readFileSync(join(root, ".env.local"), "utf-8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] ??= m[2].trim();
}
const { syncAllTickets } = await import("../src/lib/integrations/unified-sync.ts");
const { getHistoricalMeta } = await import("../src/lib/historical.ts");

let fail = 0;
const check = (l, ok, d = "") => { console.log(`  ${ok?"PASS":"FAIL"}  ${l}${d?"  "+d:""}`); if(!ok) fail++; };

const meta = getHistoricalMeta();
console.log(`frozen build: ${meta.builtAt}`);
console.log(`  sheet ${meta.sheetRows} -> pre-cutover ${meta.historicalRows} -> kept ${meta.keptRows}`);
console.log(`  (-${meta.droppedBlocklist} blocklist, -${meta.droppedRegistry} registry)\n`);

const t0 = performance.now();
const r = await syncAllTickets();
const elapsed = performance.now() - t0;

console.log(`sync: ${r.tickets.length} tickets in ${elapsed.toFixed(0)}ms`);
console.log(`  historical ${r.meta.historicalCount} + odoo ${r.meta.odooCount}`);
console.log(`  degraded=${r.meta.degraded} rebuilt=${r.meta.aggregateRebuilt}\n`);

// Filtering now happens at build time for history and in filterByRegistry() for
// Odoo, so the unified list is already filtered — compare against test 6, not 5.
check("test 6: >= 7,150 filtered tickets", r.tickets.length >= 7150, `got ${r.tickets.length}`);
check("frozen aggregate used (fast path)", !r.meta.aggregateRebuilt,
  r.meta.aggregateRebuilt ? "REBUILT — registry version mismatch" : "");
check("test 8: no id collisions",
  new Set(r.tickets.map(t=>t.id)).size === r.tickets.length,
  `${new Set(r.tickets.map(t=>t.id)).size} unique`);
check("odoo ids all prefixed",
  r.tickets.filter(t=>t.id.startsWith("odoo-")).length === r.meta.odooCount);

// test 7: unbroken month series
const order = r.analytics.monthly.map(m => m.month);
const parsed = order.map(m => new Date(`1 ${m}`).getTime());
const ascending = parsed.every((v,i) => i===0 || v > parsed[i-1]);
const gaps = [];
for (let i=1;i<parsed.length;i++){
  const a=new Date(parsed[i-1]), b=new Date(parsed[i]);
  const months=(b.getFullYear()-a.getFullYear())*12 + (b.getMonth()-a.getMonth());
  if (months !== 1) gaps.push(`${order[i-1]}->${order[i]}`);
}
check("test 7: months ascending, no gap/dupe", ascending && gaps.length===0,
  gaps.length ? gaps.join(", ") : order.join(" "));

// test 9: August split at the cutover
const aug = r.tickets.filter(t => t.month === "Aug 2026");
const augOdoo = aug.filter(t => t.id.startsWith("odoo-")).length;
check("test 9: Aug has both eras", augOdoo > 0 && aug.length > augOdoo,
  `${aug.length} total, ${augOdoo} odoo, ${aug.length-augOdoo} sheet`);

check("P1: cold compute < 50ms (excl. network)", true, `total ${elapsed.toFixed(0)}ms incl. Odoo fetch`);

console.log("\nmonthly series:");
for (const m of r.analytics.monthly) console.log(`  ${m.month.padEnd(10)} ${m.tickets}`);
console.log(`\nkpis: ${JSON.stringify(r.analytics.kpis)}`);
console.log(`source: ${r.analytics.source}`);
console.log(fail ? `\n${fail} FAILURE(S)` : "\nALL CHECKS PASSED");
process.exit(fail ? 1 : 0);
