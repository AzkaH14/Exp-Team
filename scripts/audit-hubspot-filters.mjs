/**
 * Diagnostic: how many HubSpot tickets survive each dashboard filter layer.
 * Run: npx tsx scripts/audit-hubspot-filters.mjs
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const line of readFileSync(join(root, ".env.local"), "utf-8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2].trim();
}

// hubspot-sync.ts pulls in "server-only"; inline the two pieces we need.
const TICKET_PROPERTIES = [
  "subject", "content", "ticket_category", "ticket_sub_category", "serving_city",
  "benefactor_name", "benefactor_email", "hs_all_associated_contact_firstnames",
  "hs_all_associated_contact_emails", "createdate", "closed_date",
  "hs_ticket_priority", "hs_pipeline_stage", "special_requests__notes",
  "any_other_requirementnotes", "doctor_name", "type_of_session", "session_frequency",
];
const { formatHubSpotBenefactorLabel } = await import(
  "../src/lib/client-registry/name-match.ts"
);
const fmtMonth = (iso) => iso ? new Date(iso).toLocaleDateString("en-GB",
  { month: "short", year: "numeric", timeZone: "Asia/Karachi" }) : "";
function mapHubSpotTicketToDashboard(row) {
  const p = row.properties;
  const clientRaw = p.benefactor_name ?? p.hs_all_associated_contact_firstnames ?? "";
  return {
    id: row.id,
    client: formatHubSpotBenefactorLabel(clientRaw),
    categoryFull: p.ticket_category || "Unspecified",
    city: p.serving_city ?? "Other",
    createdRaw: p.createdate ?? "",
    month: fmtMonth(p.createdate ?? ""),
  };
}
const { isExcludedHubSpotContact } = await import(
  "../src/lib/client-registry/hubspot-blocklist.ts"
);
const { canonicalizeHubSpotClientName, matchRegistryRecord } = await import(
  "../src/lib/client-registry/name-match.ts"
);
const { applyRegistrySupplement } = await import(
  "../src/lib/client-registry/registry-supplement.ts"
);

const registryAll = applyRegistrySupplement(
  JSON.parse(readFileSync(join(root, "src/data/client-registry.json"), "utf-8")).clients
);
const registry = registryAll.filter((c) => c.status !== "cancelled");

const since = Date.UTC(2025, 10, 1);
const token = process.env.HUBSPOT_ACCESS_TOKEN;
const raw = [];
let after;
do {
  const body = {
    filterGroups: [{ filters: [{ propertyName: "createdate", operator: "GTE", value: String(since) }] }],
    properties: [...TICKET_PROPERTIES],
    limit: 100,
    sorts: [{ propertyName: "createdate", direction: "DESCENDING" }],
  };
  if (after) body.after = after;
  const res = await fetch("https://api.hubapi.com/crm/v3/objects/tickets/search", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const page = await res.json();
  if (page.status === "error") throw new Error(page.message);
  for (const r of page.results ?? []) raw.push(mapHubSpotTicketToDashboard(r));
  after = page.paging?.next?.after;
  if (after) await new Promise((r) => setTimeout(r, 120));
  if (raw.length % 1000 < 100) process.stderr.write(`  fetched ${raw.length}\r`);
} while (after);

const monthKey = (t) => { const d = new Date(t.createdRaw ?? 0); return t.month || "?"; };
const byMonth = (list) => {
  const m = new Map();
  for (const t of list) m.set(t.month, (m.get(t.month) || 0) + 1);
  return [...m.entries()].sort((a, b) => new Date("1 " + a[0]) - new Date("1 " + b[0]));
};

const blockDrops = new Map();
const afterBlock = raw.filter((t) => {
  if (isExcludedHubSpotContact(t.client)) {
    blockDrops.set(t.client, (blockDrops.get(t.client) || 0) + 1);
    return false;
  }
  return true;
});

const regDrops = new Map();
const afterRegistry = afterBlock.filter((t) => {
  const canon = canonicalizeHubSpotClientName(t.client, registry);
  if (matchRegistryRecord(canon, registry) === null) {
    regDrops.set(t.client, (regDrops.get(t.client) || 0) + 1);
    return false;
  }
  return true;
});

console.log("\n================ HUBSPOT FILTER AUDIT ================");
console.log(`Window: createdate >= 2025-11-01 (no upper bound)\n`);
console.log(`1. RAW from HubSpot API            : ${raw.length}`);
console.log(`2. after blocklist                 : ${afterBlock.length}   (-${raw.length - afterBlock.length})`);
console.log(`3. after sacred-registry whitelist : ${afterRegistry.length}   (-${afterBlock.length - afterRegistry.length})`);
console.log(`\nRegistry size (non-cancelled): ${registry.length} of ${registryAll.length}`);

console.log("\n--- RAW by month ---");
for (const [m, c] of byMonth(raw)) console.log(`  ${m.padEnd(10)} ${c}`);
console.log("\n--- SURVIVING by month ---");
for (const [m, c] of byMonth(afterRegistry)) console.log(`  ${m.padEnd(10)} ${c}`);

const top = (map, n) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
console.log(`\n--- Top 15 dropped by BLOCKLIST (${blockDrops.size} distinct labels) ---`);
for (const [n, c] of top(blockDrops, 15)) console.log(`  ${String(c).padStart(5)}  ${n || "(empty)"}`);
console.log(`\n--- Top 25 dropped by REGISTRY whitelist (${regDrops.size} distinct names) ---`);
for (const [n, c] of top(regDrops, 25)) console.log(`  ${String(c).padStart(5)}  ${n}`);
