#!/usr/bin/env node
/**
 * Verify the Engagement Calendar Google Sheet integration end-to-end.
 *
 *   npm run verify:calendar
 *
 * Reads .env.local, authenticates as the service account, ensures the header
 * row, appends a test row, reads it back, then deletes the test row.
 * Prints the service account email so you know who to share the sheet with.
 */
import { readFileSync } from "fs";
import { createSign } from "crypto";
import path from "path";

const ROOT = process.cwd();
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const RW_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const LAST_COL = "O";
const COLUMNS = [
  "id", "registryId", "clientLabel", "city", "lead", "type", "title", "notes",
  "date", "time", "status", "rescheduledFrom", "createdBy", "createdAt", "updatedAt",
];

function loadEnvLocal() {
  const p = path.join(ROOT, ".env.local");
  let text = "";
  try {
    text = readFileSync(p, "utf-8");
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

function loadServiceAccount() {
  const inline = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (inline) return JSON.parse(inline);
  const p = process.env.GOOGLE_SERVICE_ACCOUNT_PATH?.trim();
  if (p) return JSON.parse(readFileSync(p, "utf-8"));
  return null;
}

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

async function getToken(sa) {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: RW_SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    })
  );
  const signInput = `${header}.${payload}`;
  const sign = createSign("RSA-SHA256");
  sign.update(signInput);
  const signature = sign.sign(sa.private_key, "base64url");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${signInput}.${signature}`,
    }),
  });
  if (!res.ok) throw new Error(`Auth failed: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

async function api(token, url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text}`);
  return text ? JSON.parse(text) : {};
}

async function main() {
  loadEnvLocal();
  const sa = loadServiceAccount();
  if (!sa) {
    console.error(
      "\n✗ No service account found.\n  Set GOOGLE_SERVICE_ACCOUNT_JSON (or GOOGLE_SERVICE_ACCOUNT_PATH) in .env.local\n"
    );
    process.exit(1);
  }

  console.log(`\nService account email:\n  ${sa.client_email}`);
  console.log("  → Share your calendar spreadsheet with this address as Editor.\n");

  const sheetId = process.env.ENGAGEMENT_CALENDAR_SHEET_ID?.trim();
  const tab = process.env.ENGAGEMENT_CALENDAR_SHEET_TAB?.trim() || "Calendar";
  if (!sheetId) {
    console.error("✗ ENGAGEMENT_CALENDAR_SHEET_ID is not set in .env.local\n");
    process.exit(1);
  }

  const token = await getToken(sa);
  console.log("✓ Authenticated with Google (write scope).");

  const quoted = `'${tab.replace(/'/g, "''")}'`;
  const range = encodeURIComponent(`${quoted}!A:${LAST_COL}`);

  // Ensure header
  const existing = await api(token, `${SHEETS_API}/${sheetId}/values/${range}`);
  const rows = existing.values || [];
  const hasHeader = rows.length > 0 && String(rows[0][0]).toLowerCase() === "id";
  if (!hasHeader) {
    await api(
      token,
      `${SHEETS_API}/${sheetId}/values/${encodeURIComponent(`${quoted}!A1:${LAST_COL}1`)}?valueInputOption=RAW`,
      { method: "PUT", body: JSON.stringify({ values: [COLUMNS] }) }
    );
    console.log(`✓ Wrote header row to "${tab}" tab.`);
  } else {
    console.log(`✓ "${tab}" tab already has a header row.`);
  }

  // Append a test row
  const testId = `verify_${Date.now()}`;
  const testRow = [
    testId, "verify-test", "VERIFY TEST (safe to delete)", "Lahore", "Seemab",
    "checkin_call", "Connectivity test", "Written by verify:calendar", "2026-07-08",
    "", "planned", "", "verify-script", new Date().toISOString(), new Date().toISOString(),
  ];
  await api(
    token,
    `${SHEETS_API}/${sheetId}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { method: "POST", body: JSON.stringify({ values: [testRow] }) }
  );
  console.log("✓ Appended a test row.");

  // Read back + locate the test row
  const after = await api(token, `${SHEETS_API}/${sheetId}/values/${range}`);
  const allRows = after.values || [];
  const idx = allRows.findIndex((r) => r[0] === testId);
  if (idx === -1) throw new Error("Test row not found after append.");
  console.log("✓ Read the test row back.");

  // Resolve gid + delete the test row
  const meta = await api(
    token,
    `${SHEETS_API}/${sheetId}?fields=sheets(properties(sheetId,title))`
  );
  const gid = meta.sheets?.find((s) => s.properties?.title === tab)?.properties
    ?.sheetId;
  if (gid != null) {
    await api(token, `${SHEETS_API}/${sheetId}:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({
        requests: [
          {
            deleteDimension: {
              range: { sheetId: gid, dimension: "ROWS", startIndex: idx, endIndex: idx + 1 },
            },
          },
        ],
      }),
    });
    console.log("✓ Cleaned up the test row.");
  }

  console.log("\n✅ Google Sheet calendar storage is working. You're all set.\n");
}

main().catch((e) => {
  const msg = String(e.message || e);
  console.error(`\n✗ Verification failed:\n  ${msg}`);
  if (msg.includes("403")) {
    console.error(
      "\n  A 403 usually means the spreadsheet isn't shared with the service account,\n  or the Google Sheets API isn't enabled for the project."
    );
  }
  if (msg.includes("404")) {
    console.error("\n  A 404 usually means ENGAGEMENT_CALENDAR_SHEET_ID is wrong, or the tab name doesn't exist.");
  }
  console.error("");
  process.exit(1);
});
