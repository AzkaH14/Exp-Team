import "server-only";
import type { AnalyticsData } from "./analytics-data";
import { computeQoLFromTicketStats } from "./qol-engine";
import { buildTicketsByClientIndex, clientKey, ticketStatsFromList } from "./tickets-data";
import type { ClientQoLListItem } from "./types/client-list";
import type {
  ClientQoLProfile,
  QoLDistributionBucket,
  QoLScore,
  QoLUrgentClient,
} from "./types/qol";
import { slugify } from "./utils";
import type { Ticket } from "./types/ticket";

export interface SessionDerived {
  qolByClient: Map<string, QoLScore>;
  clientListSlim: ClientQoLListItem[];
  profilesBySlug: Map<string, ClientQoLProfile>;
  qolDistribution: QoLDistributionBucket[];
  urgentClients: QoLUrgentClient[];
}

const globalDerived = globalThis as typeof globalThis & {
  __mohsynDerived?: SessionDerived | null;
};

function getDerived(): SessionDerived | null {
  return globalDerived.__mohsynDerived ?? null;
}

function setDerived(value: SessionDerived | null): void {
  globalDerived.__mohsynDerived = value;
}

export function getSessionDerived(): SessionDerived | null {
  return getDerived();
}

export function clearSessionDerived(): void {
  setDerived(null);
}

export function rebuildSessionMetrics(
  analytics: AnalyticsData,
  tickets: Ticket[]
): SessionDerived {
  const byClient = buildTicketsByClientIndex(tickets);
  const topMap = new Map(
    analytics.topClients.map((c) => [c.client, c.topServices])
  );

  const qolByClient = new Map<string, QoLScore>();
  const clientListSlim: ClientQoLListItem[] = [];
  const profilesBySlug = new Map<string, ClientQoLProfile>();

  for (const c of analytics.clients) {
    const clientTickets = byClient.get(clientKey(c.client)) ?? [];
    const { categories, urgentCount } = ticketStatsFromList(clientTickets);
    const qol = computeQoLFromTicketStats(c.tickets, categories, urgentCount);
    qolByClient.set(c.client, qol);

    const slug = slugify(c.client);
    clientListSlim.push({
      client: c.client,
      slug,
      city: c.city,
      email: c.email,
      tickets: c.tickets,
      overall: qol.overall,
      band: qol.band,
      urgentFlags: qol.urgentFlags,
    });

    profilesBySlug.set(slug, {
      client: c.client,
      slug,
      city: c.city,
      email: c.email,
      tickets: c.tickets,
      qol,
      topServices: topMap.get(c.client) ?? "—",
    });
  }

  const buckets: Record<QoLScore["band"], number> = {
    critical: 0,
    "at-risk": 0,
    stable: 0,
    thriving: 0,
  };
  for (const qol of qolByClient.values()) {
    buckets[qol.band]++;
  }

  const total = analytics.clients.length;
  const labels: Record<QoLScore["band"], string> = {
    critical: "Critical",
    "at-risk": "At Risk",
    stable: "Stable",
    thriving: "Thriving",
  };

  const qolDistribution: QoLDistributionBucket[] = (
    Object.keys(buckets) as QoLScore["band"][]
  ).map((band) => ({
    band,
    label: labels[band],
    count: buckets[band],
    pct: total > 0 ? (buckets[band] / total) * 100 : 0,
  }));

  const urgentClients: QoLUrgentClient[] = analytics.clients
    .map((c) => {
      const qol = qolByClient.get(c.client)!;
      return {
        client: c.client,
        slug: slugify(c.client),
        city: c.city,
        overall: qol.overall,
        band: qol.band,
        ticketCount: c.tickets,
        urgentFlags: qol.urgentFlags,
        priority: qol.overall + (qol.urgentFlags.length > 0 ? 0 : 20),
      };
    })
    .filter(
      (c) =>
        c.band === "critical" ||
        c.band === "at-risk" ||
        c.urgentFlags.length > 0
    )
    .sort((a, b) => a.overall - b.overall)
    .map(({ priority: _, ...rest }) => rest);

  const next: SessionDerived = {
    qolByClient,
    clientListSlim,
    profilesBySlug,
    qolDistribution,
    urgentClients,
  };

  setDerived(next);
  return next;
}
