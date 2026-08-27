/**
 * One-off sacred registry sync from published Google Sheet CSV.
 * Usage: npx tsx scripts/sync-registry-once.mjs
 */
import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const sheetUrl =
  process.env.GOOGLE_SHEETS_PUBLISH_CSV_URL?.trim() ||
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vRoo-mn25LvSODIecDcpgChSUgZzPDAGbDv651m40RT9L8qHTLZ_dI6OgvOkt6wOMtNk6y_SrBqnG1i/pub?gid=0&single=true&output=csv";

const supplement = JSON.parse(
  readFileSync(join(root, "src/data/client-registry-supplement.json"), "utf8")
);

// Dynamic import TS modules via tsx child or inline minimal sync
const { parseMohsynSacredSheet, mohsynClientsToRegistry } = await import(
  "../src/lib/client-registry/parse-mohsyn-sheet.ts"
);
const { filterSacredRegistryClients } = await import(
  "../src/lib/client-registry/hubspot-blocklist.ts"
);
const { slugFromBenefactor } = await import(
  "../src/lib/client-registry/name-match.ts"
);

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') inQuotes = false;
      else cell += ch;
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(cell.trim());
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && next === "\n") i++;
      row.push(cell.trim());
      if (row.some((c) => c)) rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell.trim());
    if (row.some((c) => c)) rows.push(row);
  }
  return rows;
}

function buildSummary(records) {
  const visible = records.filter((c) => c.status !== "cancelled");
  const active = visible.filter((c) => c.status === "active");
  return {
    total: visible.length,
    active: active.length,
    pause: visible.filter((c) => c.status === "pause").length,
    cancelled: records.filter((c) => c.status === "cancelled").length,
    gratis: visible.filter((c) => c.status === "gratis").length,
    byCity: {
      Islamabad: active.filter((c) => c.city === "Islamabad").length,
      Karachi: active.filter((c) => c.city === "Karachi").length,
      Lahore: active.filter((c) => c.city === "Lahore").length,
      Lodhran: active.filter((c) => c.city === "Lodhran").length,
      Gujranwala: active.filter((c) => c.city === "Gujranwala").length,
      Other: active.filter((c) => c.city === "Other").length,
    },
  };
}

const res = await fetch(sheetUrl);
if (!res.ok) throw new Error(`Sheet fetch failed: ${res.status}`);
const rows = parseCsv(await res.text());
const parsed = parseMohsynSacredSheet(rows);
const clients = mohsynClientsToRegistry(parsed, supplement.byBenefactor ?? {});
const records = filterSacredRegistryClients(
  clients.map((c) => ({ ...c, id: slugFromBenefactor(c.benefactor) }))
);

const summary = {
  ...buildSummary(records),
  sheetRows: rows.length - 1,
  addedFromHubSpot: 0,
};

const payload = {
  version: 3,
  updatedAt: new Date().toISOString().slice(0, 10),
  source: "Google Sheet (live CSV)",
  sheetUrl,
  summary,
  clients: records,
};

const out = join(root, "src/data/client-registry.json");
writeFileSync(out, JSON.stringify(payload, null, 2));
console.log(`Wrote ${records.length} clients (${summary.total} visible) → ${out}`);
console.log(JSON.stringify(summary, null, 2));
