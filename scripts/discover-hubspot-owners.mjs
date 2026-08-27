#!/usr/bin/env node
/**
 * List HubSpot users/owners for engagement calendar env vars.
 *   npm run discover:hubspot-owners
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

const headers = { Authorization: `Bearer ${token}` };

async function fetchJson(url) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${url}: ${res.status} ${await res.text()}`);
  return res.json();
}

console.log("HubSpot owners / users:\n");

try {
  const owners = await fetchJson(
    "https://api.hubapi.com/crm/v3/owners?limit=100&archived=false"
  );
  for (const o of owners.results ?? []) {
    const name = [o.firstName, o.lastName].filter(Boolean).join(" ");
    console.log(`  id=${o.id}  ${name}  ${o.email ?? ""}`);
  }
} catch (e) {
  console.warn("crm/v3/owners:", e.message);
}

try {
  const users = await fetchJson("https://api.hubapi.com/settings/v3/users?limit=100");
  for (const u of users.results ?? []) {
    console.log(`  user id=${u.id}  ${u.firstName ?? ""} ${u.lastName ?? ""}  ${u.email ?? ""}`);
  }
} catch (e) {
  console.warn("settings/v3/users:", e.message);
}

console.log(`
Add to .env.local (match names to Laiba, Dr Wajeeha, Dr Farwa):

HUBSPOT_OWNER_LAIBA=<id>
HUBSPOT_OWNER_WAJEEHA=<id>
HUBSPOT_OWNER_FARWA=<id>
`);
