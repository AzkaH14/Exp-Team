#!/usr/bin/env node
/**
 * Generates Client Family Relationship Health Assessment PDF.
 * Merges sacred registry + PDF assessment scores + utilization analytics.
 */
import { readFileSync, writeFileSync, mkdirSync, createWriteStream } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import PDFDocument from "pdfkit";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DATA = join(__dirname, "data");

const registry = JSON.parse(
  readFileSync(join(ROOT, "src/data/client-registry.json"), "utf8")
);
const assessments = JSON.parse(
  readFileSync(join(DATA, "client-engagement-assessments.json"), "utf8")
);
const analytics = JSON.parse(
  readFileSync(join(ROOT, "src/data/analytics.json"), "utf8")
);
let enrichment = { profiles: [] };
try {
  enrichment = JSON.parse(
    readFileSync(join(ROOT, "src/data/client-enrichment.json"), "utf8")
  );
} catch {
  /* optional */
}

const supplement = JSON.parse(
  readFileSync(join(ROOT, "src/data/client-registry-supplement.json"), "utf8")
);

/** @param {string} s */
function norm(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

/** Build ticket lookup by normalized benefactor name */
const ticketByNorm = new Map();
for (const row of analytics.clients || []) {
  ticketByNorm.set(norm(row.client), row.tickets);
}
for (const row of analytics.topClients || []) {
  if (!ticketByNorm.has(norm(row.client))) {
    ticketByNorm.set(norm(row.client), row.tickets);
  }
}

/** @param {{benefactor:string, aliases?:string[]}} client */
function getTickets(client) {
  const names = [client.benefactor, ...(client.aliases || [])];
  const sup = supplement.byBenefactor?.[client.benefactor];
  if (sup?.aliases) names.push(...sup.aliases);
  let best = 0;
  for (const n of names) {
    const t = ticketByNorm.get(norm(n));
    if (t != null && t > best) best = t;
  }
  return best;
}

/** @param {number} tickets @param {string} status */
function inferMohsynScore(tickets, status) {
  if (status === "pause" || status === "cancelled") {
    return tickets === 0 ? 2 : 3;
  }
  if (tickets === 0) return 2;
  if (tickets <= 5) return 3;
  if (tickets <= 20) return 4;
  return 5;
}

/** @param {string} id */
function getEnrichmentSnippet(id) {
  const p = enrichment.profiles?.find((x) => x.benefactorId === id);
  if (!p) return "";
  if (p.generalOverview) return p.generalOverview.slice(0, 120).trim() + "…";
  if (p.engagementNotes?.[0]) return p.engagementNotes[0].slice(0, 120).trim() + "…";
  return "";
}

/** @param {string | null | undefined} iso */
function formatJoinDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** @param {object} client */
function buildRow(client) {
  const a = assessments.byId[client.id] || {};
  const tickets = getTickets(client);
  const topSvc =
    (analytics.topClients || []).find(
      (t) => norm(t.client) === norm(client.benefactor)
    )?.topServices || "";

  let mohsynScore = a.relationshipMohsyn;
  if (mohsynScore == null) {
    mohsynScore = inferMohsynScore(tickets, client.status);
  }

  let mohsynDetail = a.mohsynUsageDetail || "";
  if (!mohsynDetail && mohsynScore === 3 && topSvc) {
    mohsynDetail = topSvc.split(";")[0].trim();
  }
  if (!mohsynDetail && mohsynScore === 3 && tickets > 0) {
    mohsynDetail = `~${Math.round(tickets / 3)} tickets/quarter (Mar–May 2026)`;
  }

  let relYou = a.relationshipYou;
  if (relYou == null) {
    if (client.status === "pause" || client.status === "cancelled") relYou = 2;
    else if (client.signupDate >= "2026-05-01") relYou = 2;
    else relYou = 3;
  }

  const enrich = getEnrichmentSnippet(client.id);
  const primary =
    a.primaryConcerns ||
    (enrich ? `See profile: ${enrich}` : "To be documented");
  const ongoing =
    a.ongoingConcerns ||
    (client.status === "pause"
      ? "Paused"
      : client.status === "cancelled"
        ? "Cancelled"
        : primary);

  return {
    benefactor: client.benefactor,
    beneficiary: client.beneficiary,
    joiningDate: formatJoinDate(client.signupDate),
    signupDate: client.signupDate || null,
    siblings: a.siblings || "—",
    primaryConcerns: primary,
    ongoingConcerns: ongoing,
    relationshipYou: relYou,
    relationshipMohsyn: mohsynScore ?? "—",
    mohsynUsageDetail: mohsynScore === 3 ? mohsynDetail || "—" : mohsynDetail,
    nps: a.nps != null ? String(a.nps) : "Not collected",
    csat: a.csat != null ? String(a.csat) : "Not collected",
    status: client.status,
    city: client.city,
    tickets,
    notes: a.notes || "",
  };
}

const CITY_ORDER = ["Islamabad", "Karachi", "Lahore"];
const CITY_COLORS = {
  Islamabad: { bg: "#1b5e20", label: "Islamabad" },
  Karachi: { bg: "#0d47a1", label: "Karachi" },
  Lahore: { bg: "#e65100", label: "Lahore" },
  Other: { bg: "#546e7a", label: "Other" },
};

function cityGroup(city) {
  return CITY_ORDER.includes(city) ? city : "Other";
}

const rows = registry.clients
  .map(buildRow)
  .sort((a, b) => {
    const ga = CITY_ORDER.indexOf(a.city);
    const gb = CITY_ORDER.indexOf(b.city);
    const orderA = ga === -1 ? CITY_ORDER.length : ga;
    const orderB = gb === -1 ? CITY_ORDER.length : gb;
    if (orderA !== orderB) return orderA - orderB;
    return a.benefactor.localeCompare(b.benefactor);
  });

const outDir = join(ROOT, "output");
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, "Client-Family-Relationship-Health-Assessment.pdf");
const jsonPath = join(outDir, "client-family-relationship-health.json");
writeFileSync(jsonPath, JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2));

const doc = new PDFDocument({
  size: "A3",
  layout: "landscape",
  margin: 28,
  bufferPages: true,
});
doc.pipe(createWriteStream(outPath));

const PAGE_W = doc.page.width - 56;
const guide = assessments.scoringGuide;

function drawTitlePage() {
  doc.fontSize(20).font("Helvetica-Bold").text("Mohsyn Client Family", { align: "center" });
  doc.fontSize(20).text("Relationship Health Assessment", { align: "center" });
  doc.moveDown(0.5);
  doc
    .fontSize(10)
    .font("Helvetica")
    .text(`Generated: ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`, {
      align: "center",
    });
  doc.text(`Families assessed: ${rows.length} | Source: Sacred registry + HubSpot + utilization (Mar–May 2026)`, {
    align: "center",
  });
  doc.moveDown(0.5);
  const cityCounts = {};
  for (const r of rows) {
    const g = cityGroup(r.city);
    cityCounts[g] = (cityCounts[g] || 0) + 1;
  }
  doc.text(
    `By city — Islamabad: ${cityCounts.Islamabad || 0} | Karachi: ${cityCounts.Karachi || 0} | Lahore: ${cityCounts.Lahore || 0}${cityCounts.Other ? ` | Other: ${cityCounts.Other}` : ""}`,
    { align: "center" }
  );
  doc.moveDown(1.5);

  doc.fontSize(11).font("Helvetica-Bold").text("Scoring guide");
  doc.moveDown(0.3);
  doc.fontSize(9).font("Helvetica-Bold").text("Relationship with you (1–5)");
  for (const [k, v] of Object.entries(guide.relationshipYou)) {
    doc.font("Helvetica").text(`  ${k} — ${v}`);
  }
  doc.moveDown(0.5);
  doc.font("Helvetica-Bold").text("Relationship with Mohsyn (1–5)");
  for (const [k, v] of Object.entries(guide.relationshipMohsyn)) {
    doc.font("Helvetica").text(`  ${k} — ${v}`);
  }
  doc.moveDown(0.5);
  doc.font("Helvetica").text(
    "NPS / CSAT: Not yet collected for most families — marked as 'Not collected' unless survey data exists."
  );
  doc.addPage();
}

drawTitlePage();

const cols = [
  { key: "city", label: "City", w: 38 },
  { key: "joiningDate", label: "Joined", w: 44 },
  { key: "benefactor", label: "Benefactor", w: 64 },
  { key: "beneficiary", label: "Beneficiary", w: 84 },
  { key: "siblings", label: "Siblings", w: 62 },
  { key: "primaryConcerns", label: "Primary concerns (signup)", w: 100 },
  { key: "ongoingConcerns", label: "Ongoing concerns", w: 88 },
  { key: "relationshipYou", label: "You", w: 22 },
  { key: "relationshipMohsyn", label: "Mohsyn", w: 28 },
  { key: "mohsynUsageDetail", label: "Mohsyn usage (if 3)", w: 72 },
  { key: "nps", label: "NPS", w: 36 },
  { key: "csat", label: "CSAT", w: 36 },
  { key: "status", label: "Status", w: 36 },
];

const totalW = cols.reduce((s, c) => s + c.w, 0);
const scale = PAGE_W / totalW;
for (const c of cols) c.w *= scale;

const ROW_H = 28;
const HDR_H = 34;
const FONT = 6.2;
const HDR_FONT = 6.5;

let y = doc.page.margins.top;
let x0 = doc.page.margins.left;

function drawHeader() {
  y = doc.page.margins.top;
  let x = x0;
  doc.fontSize(HDR_FONT).font("Helvetica-Bold");
  for (const col of cols) {
    doc
      .rect(x, y, col.w, HDR_H)
      .fillAndStroke("#1e3a5f", "#cccccc");
    doc.fillColor("#ffffff").text(col.label, x + 2, y + 4, {
      width: col.w - 4,
      height: HDR_H - 4,
      lineGap: -1,
    });
    x += col.w;
  }
  doc.fillColor("#000000");
  y += HDR_H;
}

function newPageIfNeeded(h = ROW_H) {
  const bottom = doc.page.height - doc.page.margins.bottom;
  if (y + h > bottom) {
    doc.addPage();
    drawHeader();
  }
}

const CITY_BANNER_H = 22;
let rowStripe = 0;
let lastCityGroup = null;

function drawCityBanner(group) {
  const cfg = CITY_COLORS[group] || CITY_COLORS.Other;
  const count = rows.filter((r) => cityGroup(r.city) === group).length;
  newPageIfNeeded(CITY_BANNER_H + HDR_H);
  doc
    .rect(x0, y, PAGE_W, CITY_BANNER_H)
    .fillAndStroke(cfg.bg, cfg.bg);
  doc
    .fontSize(9)
    .font("Helvetica-Bold")
    .fillColor("#ffffff")
    .text(`${cfg.label}  (${count} ${count === 1 ? "family" : "families"})`, x0 + 6, y + 6);
  doc.fillColor("#000000");
  y += CITY_BANNER_H;
  rowStripe = 0;
}

drawHeader();

for (let i = 0; i < rows.length; i++) {
  const row = rows[i];
  const group = cityGroup(row.city);
  if (group !== lastCityGroup) {
    drawCityBanner(group);
    lastCityGroup = group;
  }

  newPageIfNeeded();

  let x = x0;
  const fill = rowStripe % 2 === 0 ? "#f7f9fc" : "#ffffff";
  doc.fontSize(FONT).font("Helvetica");

  const cellTexts = cols.map((col) => {
    const v = row[col.key];
    return v == null || v === "" ? "—" : String(v);
  });

  let maxLines = 1;
  for (let j = 0; j < cols.length; j++) {
    const lines = doc.heightOfString(cellTexts[j], { width: cols[j].w - 4 });
    maxLines = Math.max(maxLines, Math.ceil(lines / (FONT * 1.15)) || 1);
  }
  const rowH = Math.max(ROW_H, maxLines * (FONT * 1.2) + 6);

  newPageIfNeeded(rowH);

  for (let j = 0; j < cols.length; j++) {
    const col = cols[j];
    doc.rect(x, y, col.w, rowH).fillAndStroke(fill, "#dddddd");
    if (col.key === "city") {
      const cfg = CITY_COLORS[cityGroup(row.city)] || CITY_COLORS.Other;
      doc
        .font("Helvetica-Bold")
        .fillColor(cfg.bg)
        .text(cellTexts[j], x + 2, y + 3, { width: col.w - 4, lineGap: -0.5 });
      doc.font("Helvetica").fillColor("#000000");
    } else {
      doc.fillColor("#000000").text(cellTexts[j], x + 2, y + 3, {
        width: col.w - 4,
        lineGap: -0.5,
      });
    }
    x += col.w;
  }
  y += rowH;
  rowStripe++;
}

// Summary footer on last page
doc.addPage();
doc.fontSize(14).font("Helvetica-Bold").text("Summary snapshot", { underline: true });
doc.moveDown(0.5);
doc.fontSize(10).font("Helvetica");

const avg = (arr) =>
  arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1) : "—";
const youScores = rows.map((r) => Number(r.relationshipYou)).filter((n) => !isNaN(n));
const mohScores = rows.map((r) => Number(r.relationshipMohsyn)).filter((n) => !isNaN(n));

const byMohsyn = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
const byYou = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
for (const r of rows) {
  if (byMohsyn[r.relationshipMohsyn] != null) byMohsyn[r.relationshipMohsyn]++;
  if (byYou[r.relationshipYou] != null) byYou[r.relationshipYou]++;
}

doc.text(`Average relationship with you: ${avg(youScores)} / 5`);
doc.text(`Average relationship with Mohsyn: ${avg(mohScores)} / 5`);
doc.moveDown(0.5);
doc.font("Helvetica-Bold").text("Mohsyn relationship distribution:");
doc.font("Helvetica");
for (const [k, v] of Object.entries(byMohsyn)) {
  doc.text(`  Score ${k}: ${v} families`);
}
doc.moveDown(0.5);
doc.font("Helvetica-Bold").text("Personal relationship distribution:");
doc.font("Helvetica");
for (const [k, v] of Object.entries(byYou)) {
  doc.text(`  Score ${k}: ${v} families`);
}
doc.moveDown(0.5);
doc.text(
  `Active: ${rows.filter((r) => r.status === "active").length} | Paused: ${rows.filter((r) => r.status === "pause").length} | Gratis: ${rows.filter((r) => r.status === "gratis").length} | Cancelled: ${rows.filter((r) => r.status === "cancelled").length}`
);
doc.moveDown(0.5);
doc.font("Helvetica-Bold").text("By city:");
doc.font("Helvetica");
for (const city of [...CITY_ORDER, "Other"]) {
  const subset = rows.filter((r) => cityGroup(r.city) === city);
  if (!subset.length) continue;
  const you = subset.map((r) => Number(r.relationshipYou)).filter((n) => !isNaN(n));
  const moh = subset.map((r) => Number(r.relationshipMohsyn)).filter((n) => !isNaN(n));
  doc.text(
    `  ${city}: ${subset.length} families — avg. you ${avg(you)}, avg. Mohsyn ${avg(moh)}`
  );
}

doc.end();

await new Promise((resolve, reject) => {
  doc.on("end", resolve);
  doc.on("error", reject);
});

console.log(`PDF: ${outPath}`);
console.log(`JSON: ${jsonPath}`);
console.log(`Rows: ${rows.length}`);
