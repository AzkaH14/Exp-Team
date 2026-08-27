#!/usr/bin/env node
/**
 * Print HubSpot ticket pipeline + stage IDs for .env.local / Vercel.
 *   node scripts/discover-hubspot-pipelines.mjs
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
  console.error("Set HUBSPOT_ACCESS_TOKEN in .env.local");
  process.exit(1);
}

const res = await fetch("https://api.hubapi.com/crm/v3/pipelines/tickets", {
  headers: { Authorization: `Bearer ${token}` },
});
if (!res.ok) {
  console.error(await res.text());
  process.exit(1);
}
const data = await res.json();
for (const pipe of data.results ?? []) {
  console.log(`\nPipeline: ${pipe.label} (id=${pipe.id})`);
  for (const stage of pipe.stages ?? []) {
    console.log(
      `  Stage: ${stage.label} id=${stage.id} state=${stage.metadata?.ticketState ?? "?"}`
    );
  }
}
console.log("\nAdd to .env.local (optional — auto-discovered if omitted):");
const first = data.results?.[0];
const open =
  first?.stages?.find((s) => s.metadata?.ticketState === "OPEN") ?? first?.stages?.[0];
if (first && open) {
  console.log(`HUBSPOT_TICKET_PIPELINE_ID=${first.id}`);
  console.log(`HUBSPOT_TICKET_STAGE_ID=${open.id}`);
}
