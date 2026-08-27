/**
 * Fetch HubSpot tickets → write tickets.json + analytics.json (for durable deploys).
 *   node scripts/sync-hubspot-tickets.mjs
 */
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnvLocal() {
  try {
    const text = readFileSync(join(ROOT, ".env.local"), "utf-8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch {
    // ignore
  }
}

loadEnvLocal();

const token = process.env.HUBSPOT_ACCESS_TOKEN?.trim();
if (!token) {
  console.error("HUBSPOT_ACCESS_TOKEN missing");
  process.exit(1);
}

const sinceRaw = process.env.HUBSPOT_SYNC_SINCE?.trim() || "2025-11-01";
const since = Date.parse(`${sinceRaw}T00:00:00Z`);
if (Number.isNaN(since)) {
  console.error("Invalid HUBSPOT_SYNC_SINCE");
  process.exit(1);
}

const PROPERTIES = [
  "subject",
  "content",
  "ticket_category",
  "ticket_sub_category",
  "serving_city",
  "benefactor_name",
  "benefactor_email",
  "hs_all_associated_contact_firstnames",
  "hs_all_associated_contact_emails",
  "createdate",
  "closed_date",
  "hs_ticket_priority",
  "hs_pipeline_stage",
  "special_requests__notes",
  "any_other_requirementnotes",
  "doctor_name",
  "type_of_session",
  "session_frequency",
];

function formatDisplayDate(iso) {
  if (!iso) return "";
  const dt = new Date(iso);
  return dt.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Karachi",
  });
}

function formatMonth(iso) {
  if (!iso) return "";
  const dt = new Date(iso);
  return dt.toLocaleDateString("en-GB", {
    month: "short",
    year: "numeric",
    timeZone: "Asia/Karachi",
  });
}

function formatHubSpotBenefactorLabel(raw) {
  const s = String(raw || "").replace(/\s+/g, " ").trim();
  if (!s) return s;
  return s
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

function mapTicket(row) {
  const p = row.properties || {};
  let email = p.benefactor_email || p.hs_all_associated_contact_emails || "";
  if (email.includes(";")) email = email.split(";")[0].trim();
  const clientRaw = p.benefactor_name || p.hs_all_associated_contact_firstnames || "";
  const catFull = p.ticket_category || "";
  const priority = (p.hs_ticket_priority || "normal").toLowerCase();
  return {
    id: row.id,
    ticketNumber: `MOH-${String(row.id).slice(-5)}`,
    client: formatHubSpotBenefactorLabel(clientRaw),
    email: email && email.includes("@") ? email : null,
    city: p.serving_city || "Other",
    category: catFull ? catFull.split(/[\s/]/)[0] : "",
    categoryFull: catFull || "Unspecified",
    subCategory: p.ticket_sub_category || "",
    name: p.subject || "",
    description: p.content || "",
    created: formatDisplayDate(p.createdate || ""),
    closed: formatDisplayDate(p.closed_date || ""),
    month: formatMonth(p.createdate || ""),
    priority: priority === "urgent" || priority === "high" ? "urgent" : "normal",
  };
}

async function fetchAll() {
  const all = [];
  let after;
  let pages = 0;
  do {
    const body = {
      filterGroups: [
        {
          filters: [
            { propertyName: "createdate", operator: "GTE", value: String(since) },
          ],
        },
      ],
      properties: PROPERTIES,
      limit: 100,
      sorts: [{ propertyName: "createdate", direction: "DESCENDING" }],
    };
    if (after) body.after = after;
    const res = await fetch("https://api.hubapi.com/crm/v3/objects/tickets/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HubSpot search ${res.status}: ${await res.text()}`);
    const data = await res.json();
    for (const row of data.results || []) all.push(mapTicket(row));
    after = data.paging?.next?.after;
    pages++;
    process.stdout.write(`\rFetched ${all.length} tickets (${pages} pages)`);
    if (after) await new Promise((r) => setTimeout(r, 150));
  } while (after);
  console.log("");
  return all;
}

const tickets = await fetchAll();
writeFileSync(join(ROOT, "src/data/tickets.json"), JSON.stringify(tickets));
console.log(`Wrote tickets.json (${tickets.length})`);

// Rebuild analytics via existing script
const { spawnSync } = await import("child_process");
const rebuilt = spawnSync("npx", ["--yes", "tsx", "scripts/rebuild-analytics-from-tickets.mjs"], {
  cwd: ROOT,
  encoding: "utf-8",
  env: process.env,
});
process.stdout.write(rebuilt.stdout || "");
process.stderr.write(rebuilt.stderr || "");
if (rebuilt.status !== 0) process.exit(rebuilt.status || 1);
console.log("Done.");
