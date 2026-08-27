/**
 * Additive accumulators behind AnalyticsData.
 *
 * Splitting accumulate() from finalize() is what makes the cutover cheap:
 * the 7,626 pre-cutover tickets are immutable, so their aggregate is computed
 * once at build time and frozen. At request time we accumulate only the small
 * Odoo delta (~200 rows and growing) and merge two count maps.
 *
 * Every field here is a plain count, so merging is addition. The derived
 * layers (pareto, forecast, monteCarlo, percentages) are recomputed in
 * finalize() from the merged totals — cheap once the counts exist.
 *
 * See odoo_instruct.md §12.3.
 */
import type { AnalyticsData } from "./analytics-data";
import { UNDERUTILISING_INACTIVE_DAYS } from "./engagement/constants";
import type { Ticket } from "./types/ticket";

export interface ClientAggregate {
  city: string;
  email: string | null;
  tickets: number;
  cats: Record<string, number>;
  subs: Record<string, number>;
}

export interface TicketAggregate {
  total: number;
  months: Record<string, number>;
  cities: Record<string, number>;
  /** categoryFull -> { tickets, clients: distinct client labels } */
  categories: Record<string, { tickets: number; clients: string[] }>;
  subCategories: Record<string, number>;
  clients: Record<string, ClientAggregate>;
  cityMonth: Record<string, Record<string, number>>;
}

export function emptyAggregate(): TicketAggregate {
  return {
    total: 0,
    months: {},
    cities: {},
    categories: {},
    subCategories: {},
    clients: {},
    cityMonth: {},
  };
}

/** Fold tickets into an additive aggregate. */
export function accumulate(
  tickets: Ticket[],
  into: TicketAggregate = emptyAggregate()
): TicketAggregate {
  // Sets are only needed while accumulating; the aggregate stores arrays.
  const catClients = new Map<string, Set<string>>();
  for (const [cat, entry] of Object.entries(into.categories)) {
    catClients.set(cat, new Set(entry.clients));
  }

  for (const t of tickets) {
    into.total += 1;

    if (t.month) into.months[t.month] = (into.months[t.month] ?? 0) + 1;

    const city = t.city || "Other";
    into.cities[city] = (into.cities[city] ?? 0) + 1;

    const cat = t.categoryFull || "Unspecified";
    if (!into.categories[cat]) into.categories[cat] = { tickets: 0, clients: [] };
    into.categories[cat].tickets += 1;
    if (!catClients.has(cat)) catClients.set(cat, new Set());
    catClients.get(cat)!.add(t.client);

    if (t.subCategory) {
      into.subCategories[t.subCategory] =
        (into.subCategories[t.subCategory] ?? 0) + 1;
    }

    const key = t.client || "Unknown";
    if (!into.clients[key]) {
      into.clients[key] = { city, email: t.email, tickets: 0, cats: {}, subs: {} };
    }
    const c = into.clients[key];
    c.tickets += 1;
    if (t.email) c.email = t.email;
    if (city && city !== "Other") c.city = city;
    c.cats[cat] = (c.cats[cat] ?? 0) + 1;
    if (t.subCategory) c.subs[t.subCategory] = (c.subs[t.subCategory] ?? 0) + 1;

    if (t.month) {
      if (!into.cityMonth[t.month]) into.cityMonth[t.month] = {};
      into.cityMonth[t.month][city] = (into.cityMonth[t.month][city] ?? 0) + 1;
    }
  }

  for (const [cat, set] of catClients) {
    into.categories[cat].clients = [...set];
  }
  return into;
}

function addCounts(
  target: Record<string, number>,
  source: Record<string, number>
): void {
  for (const [k, v] of Object.entries(source)) target[k] = (target[k] ?? 0) + v;
}

/** Merge a live aggregate onto a frozen historical one. Never mutates inputs. */
export function mergeAggregates(
  base: TicketAggregate,
  delta: TicketAggregate
): TicketAggregate {
  const out = emptyAggregate();
  out.total = base.total + delta.total;

  addCounts(out.months, base.months);
  addCounts(out.months, delta.months);
  addCounts(out.cities, base.cities);
  addCounts(out.cities, delta.cities);
  addCounts(out.subCategories, base.subCategories);
  addCounts(out.subCategories, delta.subCategories);

  for (const src of [base.categories, delta.categories]) {
    for (const [cat, entry] of Object.entries(src)) {
      if (!out.categories[cat]) out.categories[cat] = { tickets: 0, clients: [] };
      out.categories[cat].tickets += entry.tickets;
      out.categories[cat].clients.push(...entry.clients);
    }
  }
  for (const entry of Object.values(out.categories)) {
    entry.clients = [...new Set(entry.clients)];
  }

  for (const src of [base.clients, delta.clients]) {
    for (const [name, c] of Object.entries(src)) {
      if (!out.clients[name]) {
        out.clients[name] = { city: c.city, email: c.email, tickets: 0, cats: {}, subs: {} };
      }
      const acc = out.clients[name];
      acc.tickets += c.tickets;
      // Delta wins on identity fields — it is the more recent observation.
      if (c.email) acc.email = c.email;
      if (c.city && c.city !== "Other") acc.city = c.city;
      addCounts(acc.cats, c.cats);
      addCounts(acc.subs, c.subs);
    }
  }

  for (const src of [base.cityMonth, delta.cityMonth]) {
    for (const [month, byCity] of Object.entries(src)) {
      if (!out.cityMonth[month]) out.cityMonth[month] = {};
      addCounts(out.cityMonth[month], byCity);
    }
  }

  return out;
}

/**
 * Deterministic PRNG (mulberry32). The Monte Carlo was previously seeded by
 * Math.random(), which made the numbers flicker between ISR revalidations for
 * identical input. Seeding from the ticket total keeps output stable while
 * preserving the distribution.
 */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function topServicesString(subs: Record<string, number>, limit = 3): string {
  return Object.entries(subs)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => `${name} (${count})`)
    .join("; ");
}

/** "Aug 2026" + 1 -> "Sep 2026". Falls back to the input on unparseable labels. */
function shiftMonthLabel(label: string, deltaMonths: number): string {
  const d = new Date(`1 ${label}`);
  if (Number.isNaN(d.getTime())) return label;
  d.setMonth(d.getMonth() + deltaMonths);
  return d.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}

function periodFromMonths(months: string[], fallback: string): string {
  const sorted = [...months].sort(
    (a, b) => new Date(`1 ${a}`).getTime() - new Date(`1 ${b}`).getTime()
  );
  if (!sorted.length) return fallback;
  if (sorted.length === 1) return sorted[0]!;
  return `${sorted[0]} – ${sorted[sorted.length - 1]}`;
}

export interface FinalizeOptions {
  /** Shown in the `source` field and the first insight line. */
  source?: string;
  /** Period label when the aggregate has no months. */
  periodFallback?: string;
  /** Prefix on the first insight line, e.g. "Live sync: ". */
  insightPrefix?: string;
}

/** Derive the full AnalyticsData shape from an aggregate. */
export function finalizeAggregate(
  agg: TicketAggregate,
  options: FinalizeOptions = {}
): AnalyticsData {
  const total = agg.total;
  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 10000) / 100 : 0);

  const monthly = Object.entries(agg.months)
    .sort((a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime())
    .map(([month, tickets]) => ({ month, tickets }));

  const cities = Object.entries(agg.cities)
    .sort((a, b) => b[1] - a[1])
    .map(([city, tickets]) => ({ city, tickets, pct: pct(tickets) }));

  const categories = Object.entries(agg.categories)
    .sort((a, b) => b[1].tickets - a[1].tickets)
    .map(([category, v]) => ({
      category,
      tickets: v.tickets,
      pct: pct(v.tickets),
      clients: v.clients.length,
    }));

  const clients = Object.entries(agg.clients)
    .map(([client, v]) => ({
      client,
      city: v.city,
      tickets: v.tickets,
      email: v.email,
    }))
    .sort((a, b) => b.tickets - a.tickets);

  const topClients = clients.slice(0, 20).map((c) => ({
    ...c,
    topServices: topServicesString(agg.clients[c.client].subs) || "—",
  }));

  const topSubServices = Object.entries(agg.subCategories)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([subService, tickets]) => ({ subService, tickets }));

  const totals = clients.map((c) => c.tickets).sort((a, b) => b - a);
  const sum = totals.reduce((a, b) => a + b, 0) || 1;
  let run = 0;
  const pareto = totals.map((tickets, i) => {
    run += tickets;
    return { rank: i + 1, cumulativePct: Math.round((run / sum) * 10000) / 100, tickets };
  });

  const vals = monthly.map((m) => m.tickets);
  const meanV = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  const stdV =
    vals.length > 1
      ? Math.sqrt(vals.reduce((a, v) => a + (v - meanV) ** 2, 0) / vals.length)
      : 0;

  const rand = seededRandom(total * 2654435761 + vals.length);
  const sims: number[] = [];
  for (let i = 0; i < 500; i++) {
    const draws = vals.map((v) => v + (rand() - 0.5) * stdV * 2);
    sims.push(Math.round(draws.reduce((a, b) => a + b, 0) / (draws.length || 1)));
  }
  sims.sort((a, b) => a - b);
  const n = sims.length || 1;

  let slope = 0;
  if (vals.length >= 2) {
    const xMean = (vals.length - 1) / 2;
    let num = 0;
    let den = 0;
    vals.forEach((y, x) => {
      num += (x - xMean) * (y - meanV);
      den += (x - xMean) ** 2;
    });
    slope = den ? num / den : 0;
  }
  const intercept = meanV - slope * ((vals.length - 1) / 2);
  const nextMonthForecast = Math.max(0, Math.round(intercept + slope * vals.length));
  const forecastMonth = monthly.length
    ? shiftMonthLabel(monthly[monthly.length - 1]!.month, 1)
    : "Next month";

  const periodLabel = periodFromMonths(
    Object.keys(agg.months),
    options.periodFallback ?? "—"
  );
  const errandPct = categories.find((c) => c.category.includes("Errand"))?.pct ?? 0;
  const top10Share =
    totals.length >= 10
      ? Math.round((totals.slice(0, 10).reduce((a, b) => a + b, 0) / sum) * 1000) / 10
      : 0;

  return {
    period: periodLabel,
    source: options.source ?? "Odoo + HubSpot history",
    kpis: {
      totalTickets: total,
      uniqueClients: clients.length,
      serviceCategories: Object.keys(agg.categories).length,
      distinctSubServices: Object.keys(agg.subCategories).length,
    },
    monthly,
    cities,
    categories,
    topClients,
    topSubServices,
    pareto,
    forecast: {
      nextMonthForecast,
      forecastMonth,
      slopePerMonth: Math.round(slope * 10) / 10,
      historical: monthly,
    },
    cityMonth: agg.cityMonth,
    monteCarlo: {
      simulations: 500,
      mean: Math.round(meanV * 10) / 10,
      std: Math.round(stdV * 10) / 10,
      p10: sims[Math.floor(0.1 * n)] ?? 0,
      p50: sims[Math.floor(0.5 * n)] ?? 0,
      p90: sims[Math.floor(0.9 * n)] ?? 0,
    },
    insights: [
      `${options.insightPrefix ?? ""}${total.toLocaleString()} tickets across ${clients.length} clients (${periodLabel}).`,
      `Errand / non-emergency services: ${errandPct}% of volume.`,
      cities[0]
        ? `Top city: ${cities[0].city} (${cities[0].pct}% of tickets).`
        : "No city breakdown available.",
      topClients[0]
        ? `Top client: ${topClients[0].client} (${topClients[0].tickets} tickets).`
        : "",
      `Top 10 clients: ${top10Share}% of total volume.`,
      monthly.length >= 2
        ? `Latest month ${monthly[monthly.length - 1].month}: ${monthly[monthly.length - 1].tickets} tickets.`
        : "",
    ].filter(Boolean),
    recommendations: [
      `Staff to P90 forecast (~${sims[Math.floor(0.9 * n)]} tickets/month) while targeting median (~${sims[Math.floor(0.5 * n)]}).`,
      `Proactive engagement for top 10 clients (${top10Share}% concentration).`,
      `Review underutilising clients (no ticket in ${UNDERUTILISING_INACTIVE_DAYS}+ days) on Engagement Calendar.`,
      `Enforce ticket_category on create — reduces Unspecified/QA volume.`,
    ],
    clients,
  };
}
