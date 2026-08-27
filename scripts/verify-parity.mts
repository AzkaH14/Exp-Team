/**
 * Golden-snapshot parity harness.
 *
 * Captures every derived surface the dashboard produces, hashes each one, and
 * writes the result to parity/<label>.json. Optimization work is only allowed to
 * change WHEN work runs, never WHAT it produces — so:
 *
 *   1. before touching anything:  npm run parity:baseline
 *   2. after each change:         npm run parity:check
 *
 * A non-empty diff means business logic moved. That blocks the change.
 *
 * Determinism: HubSpot and Google Sheets credentials are cleared before the app
 * modules load, so every run resolves against the bundled static snapshot and
 * performs no network I/O. Periods, weeks and months are pinned to constants.
 * `generatedAt` (literally `new Date()` at call time) is stripped before hashing.
 *
 * Run with:  node --conditions=react-server --import tsx scripts/verify-parity.mts
 * The react-server condition is required so `server-only` resolves to its no-op
 * server build instead of the client stub that throws on import.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// ── deterministic environment (must be set before the app modules load) ──────

for (const key of [
  "HUBSPOT_ACCESS_TOKEN",
  "HUBSPOT_PORTAL_ID",
  "GOOGLE_SERVICE_ACCOUNT_JSON",
  "GOOGLE_SERVICE_ACCOUNT_PATH",
  "GOOGLE_SHEETS_API_KEY",
  "GOOGLE_SHEETS_PUBLISH_CSV_URL",
  "UNDERUTILISING_SHEET_PUBLISH_CSV_URL",
  "ENGAGEMENT_CALENDAR_SHEET_ID",
  "CELEBRATIONS_CALENDAR_SHEET_ID",
]) {
  delete process.env[key];
}
process.env.VERCEL = "";

// ── pinned inputs ────────────────────────────────────────────────────────────

const PERIOD_MONTHS = ["2026-07", "2026-06"] as const;
const CALENDAR_WEEK = "2026-07-13";
const CELEBRATION_MONTHS = ["2026-07", "2026-08"] as const;
const CALENDAR_CITIES = ["all", "Islamabad", "Karachi", "Lahore"] as const;

/** (page, search, city, priority, registryId, status, attention, quality) */
const TICKET_QUERIES: Array<[number, string, string, string, string, string, string, string]> = [
  [1, "", "", "", "", "", "", ""],
  [2, "", "", "", "", "", "", ""],
  [7, "", "", "", "", "", "", ""],
  [1, "ali", "", "", "", "", "", ""],
  [1, "", "Islamabad", "", "", "", "", ""],
  [1, "", "Karachi", "", "", "", "", ""],
  [1, "", "Lahore", "", "", "", "", ""],
  [1, "", "", "urgent", "", "", "", ""],
  [1, "", "", "", "", "open", "", ""],
  [1, "", "", "", "", "closed", "", ""],
  [1, "", "", "", "", "", "critical", ""],
  [1, "call", "Islamabad", "", "", "open", "", ""],
];

// ── stable serialisation ─────────────────────────────────────────────────────

const VOLATILE_KEYS = new Set(["generatedAt"]);

function normalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return typeof value === "number" && !Number.isFinite(value) ? String(value) : value;
  }
  if (Array.isArray(value)) return value.map(normalize);
  if (value instanceof Map) {
    return {
      __map: [...value.entries()]
        .map(([k, v]) => [String(k), normalize(v)] as const)
        .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
    };
  }
  if (value instanceof Set) {
    return { __set: [...value].map(String).sort() };
  }
  if (value instanceof Date) return value.toISOString();

  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    if (VOLATILE_KEYS.has(key)) continue;
    out[key] = normalize((value as Record<string, unknown>)[key]);
  }
  return out;
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(normalize(value))).digest("hex").slice(0, 16);
}

// ── capture ──────────────────────────────────────────────────────────────────

interface Surface {
  hash: string;
  items?: Record<string, string>;
  count?: number;
  note?: string;
}

const surfaces: Record<string, Surface> = {};

function record(name: string, value: unknown, note?: string): void {
  surfaces[name] = { hash: hash(value), note };
  if (Array.isArray(value)) surfaces[name].count = value.length;
}

/** Per-item hashes so a diff points at the exact family / query that moved. */
function recordEach(name: string, items: Record<string, unknown>): void {
  const perItem: Record<string, string> = {};
  for (const key of Object.keys(items).sort()) perItem[key] = hash(items[key]);
  surfaces[name] = {
    hash: hash(perItem),
    items: perItem,
    count: Object.keys(perItem).length,
  };
}

async function capture(): Promise<void> {
  const { ensureCachedSession } = await import("@/lib/data-source");
  const { getAnalyticsData } = await import("@/lib/analytics-data");
  const { getDashboardLiveSnapshot } = await import("@/lib/data-provider");
  const { getSessionDerived } = await import("@/lib/session-metrics");
  const { getQoLDistribution, getUrgentAttentionClients } = await import("@/lib/qol-engine");
  const { getClientListSlim } = await import("@/lib/clients-query");
  const { getAllClientProfiles } = await import("@/lib/client-profiles");
  const { getSacredRegistry, getRegistrySummary, getRegistryVersion } = await import(
    "@/lib/client-registry/store"
  );
  const { getReportTicketIndex } = await import("@/lib/reports/ticket-index");
  const { buildFamilyReport, listFamiliesForReports, parseReportPeriod } = await import(
    "@/lib/reports/family-monthly-report"
  );
  const { renderFamilyReportHtml } = await import("@/lib/reports/family-report-html");
  const { getTicketsPage } = await import("@/lib/tickets-query");
  const { getEngagementCalendarData } = await import("@/lib/engagement/calendar-data");
  const { getCelebrationsMonth } = await import("@/lib/celebrations/calendar-store");
  const { getMergedClientProfiles } = await import("@/lib/client-registry/merge");
  const { getTicketsData } = await import("@/lib/tickets-data");

  ensureCachedSession();

  // ── registry & analytics ──
  record("registry", getSacredRegistry());
  record("registry-summary", getRegistrySummary());
  record("registry-version", getRegistryVersion());
  record("analytics", getAnalyticsData());
  record("dashboard-snapshot", getDashboardLiveSnapshot());

  // ── ticket pipeline ──
  const tickets = getTicketsData();
  record(
    "tickets-normalized",
    tickets.map((t) => [t.ticketNumber, t.client, t.city, t.categoryFull, t.priority]),
    "canonicalised client names — the output of the fuzzy matcher"
  );

  // ── QoL / session derived ──
  const derived = getSessionDerived();
  record("session-derived", derived);
  record("qol-distribution", getQoLDistribution());
  record("urgent-clients", getUrgentAttentionClients(500));
  record("client-list-slim", getClientListSlim());
  record("client-profiles", getAllClientProfiles());
  record("merged-client-profiles", getMergedClientProfiles());

  // ── report ticket index ──
  const index = getReportTicketIndex();
  const indexByFamily: Record<string, unknown> = {};
  for (const [registryId, list] of index.byRegistryId) {
    indexByFamily[registryId] = list.map((t) => t.ticketNumber).sort();
  }
  recordEach("report-ticket-index", indexByFamily);

  // ── family reports, every family, every pinned period ──
  for (const month of PERIOD_MONTHS) {
    const period = parseReportPeriod({ month });
    if (!period) throw new Error(`bad pinned period: ${month}`);

    record(`families-for-reports:${month}`, listFamiliesForReports(period));

    const reports: Record<string, unknown> = {};
    const htmls: Record<string, unknown> = {};
    for (const record_ of getSacredRegistry()) {
      const report = buildFamilyReport(record_.id, period);
      if (!report) continue;
      reports[record_.id] = report;
      htmls[record_.id] = renderFamilyReportHtml(report);
    }
    recordEach(`family-reports:${month}`, reports);
    recordEach(`family-report-html:${month}`, htmls);
  }

  // ── ticket queue ──
  const pages: Record<string, unknown> = {};
  for (const q of TICKET_QUERIES) {
    pages[JSON.stringify(q)] = getTicketsPage(...q);
  }
  recordEach("tickets-pages", pages);

  // ── calendars ──
  const calendars: Record<string, unknown> = {};
  for (const city of CALENDAR_CITIES) {
    try {
      calendars[city] = await getEngagementCalendarData(city, new Date(`${CALENDAR_WEEK}T00:00:00Z`));
    } catch (e) {
      calendars[city] = { __error: e instanceof Error ? e.message : String(e) };
    }
  }
  recordEach("engagement-calendar", calendars);

  const celebrations: Record<string, unknown> = {};
  for (const month of CELEBRATION_MONTHS) {
    try {
      celebrations[month] = await getCelebrationsMonth(month);
    } catch (e) {
      celebrations[month] = { __error: e instanceof Error ? e.message : String(e) };
    }
  }
  recordEach("celebrations-calendar", celebrations);
}

// ── report / compare ─────────────────────────────────────────────────────────

const OUT_DIR = join(process.cwd(), "parity");

interface Snapshot {
  capturedAt: string;
  runDateUTC: string;
  surfaces: Record<string, Surface>;
}

function diff(base: Snapshot, next: Snapshot): string[] {
  const problems: string[] = [];
  const names = [...new Set([...Object.keys(base.surfaces), ...Object.keys(next.surfaces)])].sort();

  for (const name of names) {
    const a = base.surfaces[name];
    const b = next.surfaces[name];
    if (!a) { problems.push(`+ ${name} — new surface (not in baseline)`); continue; }
    if (!b) { problems.push(`- ${name} — surface disappeared`); continue; }
    if (a.hash === b.hash) continue;

    if (a.items && b.items) {
      const keys = [...new Set([...Object.keys(a.items), ...Object.keys(b.items)])].sort();
      const changed = keys.filter((k) => a.items![k] !== b.items![k]);
      problems.push(
        `~ ${name} — ${changed.length}/${keys.length} items differ: ${changed.slice(0, 8).join(", ")}` +
          (changed.length > 8 ? ` … +${changed.length - 8} more` : "")
      );
    } else {
      problems.push(`~ ${name} — hash ${a.hash} → ${b.hash}`);
    }
  }
  return problems;
}

const label = process.argv.includes("--baseline") ? "baseline" : "current";

const t0 = Date.now();
await capture();
const elapsed = Date.now() - t0;

const snapshot: Snapshot = {
  capturedAt: new Date().toISOString(),
  runDateUTC: new Date().toISOString().slice(0, 10),
  surfaces,
};

mkdirSync(OUT_DIR, { recursive: true });
const outPath = join(OUT_DIR, `${label}.json`);
writeFileSync(outPath, JSON.stringify(snapshot, null, 2));

const names = Object.keys(surfaces).sort();
console.log(`\ncaptured ${names.length} surfaces in ${(elapsed / 1000).toFixed(1)}s → parity/${label}.json\n`);
for (const name of names) {
  const s = surfaces[name];
  const count = s.count != null ? String(s.count).padStart(5) : "    ·";
  console.log(`  ${s.hash}  ${count}  ${name}`);
}

if (label === "baseline") {
  console.log("\nBaseline captured. Re-run with no flag after each change to compare.\n");
  process.exit(0);
}

const basePath = join(OUT_DIR, "baseline.json");
if (!existsSync(basePath)) {
  console.error("\nNo parity/baseline.json — run with --baseline first.\n");
  process.exit(2);
}

const base = JSON.parse(readFileSync(basePath, "utf8")) as Snapshot;
if (base.runDateUTC !== snapshot.runDateUTC) {
  console.warn(
    `\n  ! baseline captured on ${base.runDateUTC}, this run is ${snapshot.runDateUTC}.` +
      `\n    Ticket "days open" and attention levels are derived from the current date,` +
      `\n    so ticket-queue surfaces may differ for that reason alone. Re-baseline today.\n`
  );
}

const problems = diff(base, snapshot);
if (problems.length === 0) {
  console.log(`\n  PARITY OK — all ${names.length} surfaces byte-identical to baseline.\n`);
  process.exit(0);
}

console.error(`\n  PARITY FAILED — ${problems.length} surface(s) changed:\n`);
for (const p of problems) console.error(`    ${p}`);
console.error("");
process.exit(1);
