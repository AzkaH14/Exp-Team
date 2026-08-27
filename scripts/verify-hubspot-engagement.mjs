#!/usr/bin/env node
/**
 * Verify HubSpot scopes for Engagement Calendar auto-tickets (no ticket created).
 *   npm run verify:hubspot-engagement
 */
import { readFileSync } from "fs";
import path from "path";

const ROOT = process.cwd();

function loadEnvLocal() {
  try {
    const text = readFileSync(path.join(ROOT, ".env.local"), "utf-8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch {
    // ignore
  }
}

loadEnvLocal();

const token = process.env.HUBSPOT_ACCESS_TOKEN?.trim();
if (!token) {
  console.error("FAIL: HUBSPOT_ACCESS_TOKEN not set in .env.local");
  process.exit(1);
}

const auto = process.env.HUBSPOT_AUTO_CREATE_ENGAGEMENT_TICKETS === "true";
console.log(`HUBSPOT_AUTO_CREATE_ENGAGEMENT_TICKETS=${auto}`);
console.log(`HUBSPOT_OWNER_LAIBA=${process.env.HUBSPOT_OWNER_LAIBA ?? "(not set)"}`);
console.log(`HUBSPOT_OWNER_WAJEEHA=${process.env.HUBSPOT_OWNER_WAJEEHA ?? "(not set)"}`);
console.log(`HUBSPOT_OWNER_FARWA=${process.env.HUBSPOT_OWNER_FARWA ?? "(not set)"}`);
console.log("");

const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

async function check(label, url, init) {
  const res = await fetch(url, { ...init, headers: { ...headers, ...(init?.headers ?? {}) } });
  const text = await res.text();
  const ok = res.ok;
  console.log(`${ok ? "OK" : "FAIL"} ${label}: ${res.status}`);
  if (!ok) console.log("  ", text.slice(0, 400));
  return ok;
}

let pass = true;

pass = (await check("Read tickets", "https://api.hubapi.com/crm/v3/objects/tickets?limit=1")) && pass;
pass =
  (await check("Read pipelines", "https://api.hubapi.com/crm/v3/pipelines/tickets")) && pass;

// Dry-run create: invalid body should return 400 (scope OK) not 403 (no scope)
const dry = await fetch("https://api.hubapi.com/crm/v3/objects/tickets", {
  method: "POST",
  headers,
  body: JSON.stringify({ properties: {} }),
});
const dryText = await dry.text();
const canWrite = dry.status === 400 || dry.status === 201;
console.log(`${canWrite ? "OK" : "FAIL"} Tickets write scope: ${dry.status}`);
if (!canWrite) {
  console.log("   ", dryText.slice(0, 400));
  console.log("\n→ Add crm.objects.tickets.write to your HubSpot private app and regenerate the token.");
}
pass = canWrite && pass;

if (!auto) {
  console.log("\nWARN: Set HUBSPOT_AUTO_CREATE_ENGAGEMENT_TICKETS=true to enable auto-create.");
}

console.log(pass && auto ? "\nReady for Engagement Calendar → HubSpot tickets." : "\nFix the items above, then restart the dev server.");
process.exit(pass && auto ? 0 : 1);
