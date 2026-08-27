/**
 * Verifies the Odoo client + mapper against the live instance.
 * Run: npx tsx --conditions=react-server scripts/check-odoo.mjs
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const l of readFileSync(join(root, ".env.local"), "utf-8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] ??= m[2].trim();
}
const { CUTOVER_ODOO_UTC, CUTOVER_DATE } = await import("../src/lib/cutover.ts");
const { authenticate, getOdooConfig, searchCount } = await import("../src/lib/integrations/odoo.ts");
const { fetchOdooTickets } = await import("../src/lib/integrations/odoo-sync.ts");

let fail = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`);
  if (!ok) fail++;
};

const uid = await authenticate(getOdooConfig());
check("auth returns uid 2", uid === 2, `got ${uid}`);
console.log(`\n  cutover ${CUTOVER_DATE} -> odoo domain "${CUTOVER_ODOO_UTC}"\n`);

const t0 = performance.now();
const tickets = await fetchOdooTickets();
console.log(`  fetched ${tickets.length} tickets in ${(performance.now() - t0).toFixed(0)}ms\n`);

check("test 3: >= 202 tickets", tickets.length >= 202, `got ${tickets.length}`);
const importDay = tickets.filter(t => t.created === "08 Jul 2026");
check("test 4: zero import-batch tasks", importDay.length === 0, `got ${importDay.length}`);
const withEmail = tickets.filter(t => t.email);
check("test 10: email ~100%", withEmail.length / tickets.length > 0.95,
  `${withEmail.length}/${tickets.length}`);
const urgent = tickets.filter(t => t.priority === "urgent");
check("test 11: urgent tickets exist", urgent.length > 0, `${urgent.length} urgent`);
const cities = [...new Set(tickets.map(t => t.city))];
check("test 12: no Faislabad", !cities.includes("Faislabad"), cities.join(", "));
check("ids prefixed odoo-", tickets.every(t => t.id.startsWith("odoo-")));
check("all have month", tickets.every(t => t.month));
check("all have client", tickets.every(t => t.client));
const html = tickets.filter(t => /<[a-z]|data-last-history/i.test(t.description));
check("descriptions stripped of HTML", html.length === 0, `${html.length} with markup`);

const preCutover = await searchCount("project.task",
  [["project_id","=",2],["create_date","<",CUTOVER_ODOO_UTC]]);
console.log(`\n  excluded by the date filter: ${preCutover} tasks (import batch + pilot + double-entry)`);

const months = {}; for (const t of tickets) months[t.month] = (months[t.month]||0)+1;
console.log("  months:", JSON.stringify(months));
console.log("\n  sample:");
for (const t of tickets.slice(0,3))
  console.log("   ", JSON.stringify({id:t.id,client:t.client,city:t.city,cat:t.category,
    created:t.created,priority:t.priority,stage:t.stage,email:t.email}));
console.log(fail ? `\n${fail} FAILURE(S)` : "\nALL CHECKS PASSED");
process.exit(fail ? 1 : 0);
