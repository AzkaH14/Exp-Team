/**
 * Which pre-cutover tickets does the registry filter drop, and why?
 * "churned" = matches a cancelled (Churned in Odoo) family — expected.
 * "unmatched" = matches no family at all — a name-mapping gap worth fixing.
 *
 *   npx tsx scripts/audit-registry-drops.mts
 */
import { readFileSync } from "fs";
import { join } from "path";

const root = join(import.meta.dirname, "..");
const { fetchHistoricalTickets } = await import("../src/lib/integrations/historical-sheet.ts");
const { CUTOVER_MS } = await import("../src/lib/cutover.ts");
const { filterSacredRegistryClients, isExcludedHubSpotContact } = await import(
  "../src/lib/client-registry/hubspot-blocklist.ts"
);
const { canonicalizeHubSpotClientName, matchRegistryRecord } = await import(
  "../src/lib/client-registry/name-match.ts"
);
const { applyRegistrySupplement } = await import("../src/lib/client-registry/registry-supplement.ts");

const file = JSON.parse(readFileSync(join(root, "src/data/client-registry.json"), "utf-8"));
const all = filterSacredRegistryClients(applyRegistrySupplement(file.clients));
const live = all.filter((c: { status: string }) => c.status !== "cancelled");

const tickets = (await fetchHistoricalTickets()).filter((t: { createdMs: number }) => t.createdMs < CUTOVER_MS);
const churned = new Map<string, number>();
const unmatched = new Map<string, number>();
for (const t of tickets) {
  if (isExcludedHubSpotContact(t.client)) continue;
  const canonical = canonicalizeHubSpotClientName(t.client, live);
  if (matchRegistryRecord(canonical, live)) continue;
  const hit = matchRegistryRecord(t.client, all);
  const bucket = hit ? churned : unmatched;
  const key = hit ? hit.benefactor : t.client;
  bucket.set(key, (bucket.get(key) ?? 0) + 1);
}
const fmt = (m: Map<string, number>) =>
  [...m].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} (${v})`).join(" | ");
const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);
console.log(`churned families: ${sum(churned)} tickets\n  ${fmt(churned)}`);
console.log(`unmatched names: ${sum(unmatched)} tickets\n  ${fmt(unmatched)}`);
