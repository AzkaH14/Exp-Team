/**
 * Freeze the HubSpot export into src/data/historical-*.json.
 *
 * Run once (and again only if the sheet, blocklist or registry changes):
 *   npx tsx scripts/build-historical.mjs
 *
 * Produces three files, all committed:
 *   historical-tickets-index.json   list + analytics fields  (hot path)
 *   historical-tickets-detail.json  descriptions + notes     (lazy)
 *   historical-aggregates.json      additive counts + meta   (hot path)
 *
 * This is a build/maintenance script. Nothing here runs at request time.
 * See odoo_instruct.md §4.4 and §12.3.
 */
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

for (const line of readFileSync(join(root, ".env.local"), "utf-8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2].trim();
}

const { fetchHistoricalTickets } = await import(
  "../src/lib/integrations/historical-sheet.ts"
);
const { CUTOVER_DATE, CUTOVER_MS } = await import("../src/lib/cutover.ts");
const { accumulate } = await import("../src/lib/analytics-aggregate.ts");
const { isExcludedHubSpotContact, REGISTRY_BLOCKLIST_VERSION, filterSacredRegistryClients } =
  await import("../src/lib/client-registry/hubspot-blocklist.ts");
const { canonicalizeHubSpotClientName, matchRegistryRecord } = await import(
  "../src/lib/client-registry/name-match.ts"
);
const { applyRegistrySupplement } = await import(
  "../src/lib/client-registry/registry-supplement.ts"
);

const registryFile = JSON.parse(
  readFileSync(join(root, "src/data/client-registry.json"), "utf-8")
);
// Ticket matching uses the supplemented registry, exactly as getSacredRegistry() does.
const registry = filterSacredRegistryClients(
  applyRegistrySupplement(registryFile.clients)
).filter((c) => c.status !== "cancelled");

// The VERSION STRING must mirror getRegistryVersion() in client-registry/store.ts
// byte for byte — it filters the raw file clients WITHOUT the supplement.
// Getting this wrong makes the frozen aggregate look permanently stale.
const registryVersion = `${registryFile.version ?? 1}:${registryFile.updatedAt ?? "0"}:${
  filterSacredRegistryClients(registryFile.clients).length
}:bl${REGISTRY_BLOCKLIST_VERSION}`;

console.log("Fetching historical sheet…");
const all = await fetchHistoricalTickets();
console.log(`  ${all.length} rows parsed`);

const historical = all.filter((t) => t.createdMs < CUTOVER_MS);
console.log(
  `  ${historical.length} before cutover ${CUTOVER_DATE}, ${all.length - historical.length} stragglers dropped`
);

// Same pipeline as filterTicketsByRegistry() in integrations/hubspot-sync.ts
let droppedBlocklist = 0;
let droppedRegistry = 0;
const kept = [];
for (const t of historical) {
  if (isExcludedHubSpotContact(t.client)) {
    droppedBlocklist++;
    continue;
  }
  const canonical = canonicalizeHubSpotClientName(t.client, registry);
  if (matchRegistryRecord(canonical, registry) === null) {
    droppedRegistry++;
    continue;
  }
  kept.push(canonical === t.client ? t : { ...t, client: canonical });
}
console.log(
  `  -${droppedBlocklist} blocklist, -${droppedRegistry} registry -> ${kept.length} kept`
);

const index = [];
const detail = {};
for (const t of kept) {
  const { description, hubspotFieldNotes, createdMs, ...rest } = t;
  index.push(rest);
  if (description || hubspotFieldNotes) {
    detail[t.id] = {
      ...(description ? { description } : {}),
      ...(hubspotFieldNotes ? { hubspotFieldNotes } : {}),
    };
  }
}

const aggregate = accumulate(index);
const months = Object.keys(aggregate.months);
const meta = {
  builtAt: new Date().toISOString(),
  cutover: CUTOVER_DATE,
  sheetRows: all.length,
  historicalRows: historical.length,
  keptRows: kept.length,
  droppedBlocklist,
  droppedRegistry,
  registryVersion,
  blocklistVersion: REGISTRY_BLOCKLIST_VERSION,
};

const write = (name, data) => {
  const path = join(root, "src/data", name);
  writeFileSync(path, JSON.stringify(data));
  const mb = (readFileSync(path).length / 1048576).toFixed(2);
  console.log(`  wrote ${name.padEnd(32)} ${mb} MB`);
};

console.log("Writing frozen files…");
write("historical-tickets-index.json", index);
write("historical-tickets-detail.json", detail);
write("historical-aggregates.json", { meta, aggregate });

console.log("\nSummary");
console.log(`  tickets      : ${index.length}`);
console.log(`  with detail  : ${Object.keys(detail).length}`);
console.log(`  clients      : ${Object.keys(aggregate.clients).length}`);
console.log(`  months       : ${months.length} (${months.join(", ")})`);
console.log(`  registry ver : ${registryVersion}`);
