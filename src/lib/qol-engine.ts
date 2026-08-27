import "server-only";
import { getAnalyticsData } from "./analytics-data";
import { getSessionDerived } from "./session-metrics";
import { getClientTicketStats } from "./tickets-data";
import type {
  QoLScore,
  QoLDimensionScore,
  QoLDistributionBucket,
  QoLUrgentClient,
} from "./types/qol";
import { slugify } from "./utils";

const DIMENSION_WEIGHTS = {
  healthcare: 0.3,
  engagement: 0.25,
  errands: 0.2,
  experience: 0.15,
  responsiveness: 0.1,
} as const;

const HEALTHCARE_KEYS = [
  "Healthcare Services",
  "Medical Errands (non-emergency)",
  "Psychologist Call",
];
const ENGAGEMENT_KEYS = ["Psychologist Call"];
const EXPERIENCE_KEYS = ["Experience", "Travel Services"];
const ERRAND_KEYS = [
  "Errand Services/Non-emergency services",
  "Domestic Services",
];

function bandFromScore(score: number): QoLScore["band"] {
  if (score < 40) return "critical";
  if (score < 55) return "at-risk";
  if (score < 75) return "stable";
  return "thriving";
}

function dimensionScore(tickets: number, total: number, benchmark: number): number {
  if (total === 0) return 30;
  const ratio = tickets / total;
  const utilization = Math.min(tickets / benchmark, 1.5);
  const breadth = Math.min(Object.keys({}).length, 1);
  void breadth;
  const base = 40 + ratio * 40 + utilization * 20;
  return Math.round(Math.min(100, Math.max(0, base)));
}

function computeDimensions(
  categories: Record<string, number>,
  total: number,
  urgentCount: number
): QoLDimensionScore[] {
  const sum = (keys: string[]) =>
    keys.reduce((acc, k) => acc + (categories[k] ?? 0), 0);

  const healthcareTickets = sum(HEALTHCARE_KEYS);
  const engagementTickets = sum(ENGAGEMENT_KEYS);
  const errandTickets = sum(ERRAND_KEYS);
  const experienceTickets = sum(EXPERIENCE_KEYS);

  const responsivenessScore = Math.round(
    Math.max(20, 100 - urgentCount * 8 - (total > 0 ? 0 : 30))
  );

  const dims: QoLDimensionScore[] = [
    {
      dimension: "healthcare",
      label: "Healthcare Access",
      score: dimensionScore(healthcareTickets, total, 15),
      weight: DIMENSION_WEIGHTS.healthcare,
      tickets: healthcareTickets,
      trend: healthcareTickets > total * 0.3 ? "up" : "stable",
    },
    {
      dimension: "engagement",
      label: "Engagement & Wellness",
      score: dimensionScore(engagementTickets, total, 8),
      weight: DIMENSION_WEIGHTS.engagement,
      tickets: engagementTickets,
      trend: engagementTickets > 5 ? "up" : "down",
    },
    {
      dimension: "errands",
      label: "Daily Living Support",
      score: dimensionScore(errandTickets, total, 20),
      weight: DIMENSION_WEIGHTS.errands,
      tickets: errandTickets,
      trend: "stable",
    },
    {
      dimension: "experience",
      label: "Experience & Lifestyle",
      score: dimensionScore(experienceTickets, total, 5),
      weight: DIMENSION_WEIGHTS.experience,
      tickets: experienceTickets,
      trend: experienceTickets > 2 ? "up" : "stable",
    },
    {
      dimension: "responsiveness",
      label: "Service Responsiveness",
      score: responsivenessScore,
      weight: DIMENSION_WEIGHTS.responsiveness,
      tickets: urgentCount,
      trend: urgentCount > 3 ? "down" : "stable",
    },
  ];

  return dims;
}

function buildUrgentFlags(
  overall: number,
  ticketCount: number,
  urgentCount: number,
  dimensions: QoLDimensionScore[]
): string[] {
  const flags: string[] = [];
  if (overall < 45) flags.push("Low overall QoL score");
  if (ticketCount < 5) flags.push("Severely underutilising services");
  if (urgentCount >= 4) flags.push("High urgent ticket volume");
  const lowDim = dimensions.find((d) => d.score < 40);
  if (lowDim) flags.push(`Weak ${lowDim.label.toLowerCase()}`);
  if (dimensions.find((d) => d.dimension === "engagement" && d.tickets === 0))
    flags.push("No engagement/wellness touchpoints");
  return flags;
}

export function computeQoLFromTicketStats(
  ticketCount: number,
  categories: Record<string, number>,
  urgentCount: number
): QoLScore {
  const total = ticketCount;
  const dimensions = computeDimensions(categories, total, urgentCount);

  const overall = Math.round(
    dimensions.reduce((acc, d) => acc + d.score * d.weight, 0)
  );

  const band = bandFromScore(overall);
  const urgentFlags = buildUrgentFlags(overall, ticketCount, urgentCount, dimensions);

  const avgPerMonth = total / 3;
  const nextMonthTickets = Math.round(avgPerMonth * (overall < 50 ? 0.85 : 1.05));
  const riskLevel: QoLScore["prediction"]["riskLevel"] =
    overall < 45 || urgentCount >= 5
      ? "high"
      : overall < 60
        ? "medium"
        : "low";

  const narrative =
    riskLevel === "high"
      ? `Proactive outreach recommended — QoL at ${overall}/100 with ${urgentFlags.length} risk flags.`
      : riskLevel === "medium"
        ? `Monitor closely — mixed dimension scores suggest targeted service bundling.`
        : `Stable trajectory — maintain current engagement cadence (~${nextMonthTickets} tickets/mo forecast).`;

  return {
    overall,
    band,
    dimensions,
    ticketCount: total,
    urgentFlags,
    prediction: { nextMonthTickets, riskLevel, narrative },
  };
}

export function computeQoLForClient(client: string, ticketCount: number): QoLScore {
  const cached = getSessionDerived()?.qolByClient.get(client);
  if (cached) return cached;

  const { categories, urgentCount } = getClientTicketStats(client);
  return computeQoLFromTicketStats(ticketCount, categories, urgentCount);
}

export function getQoLDistribution(): QoLDistributionBucket[] {
  const cached = getSessionDerived()?.qolDistribution;
  if (cached) return cached;

  const analytics = getAnalyticsData();
  const buckets: Record<QoLScore["band"], number> = {
    critical: 0,
    "at-risk": 0,
    stable: 0,
    thriving: 0,
  };

  for (const c of analytics.clients) {
    const qol = computeQoLForClient(c.client, c.tickets);
    buckets[qol.band]++;
  }

  const total = analytics.clients.length;
  const labels: Record<QoLScore["band"], string> = {
    critical: "Critical",
    "at-risk": "At Risk",
    stable: "Stable",
    thriving: "Thriving",
  };

  return (Object.keys(buckets) as QoLScore["band"][]).map((band) => ({
    band,
    label: labels[band],
    count: buckets[band],
    pct: total > 0 ? (buckets[band] / total) * 100 : 0,
  }));
}

export function getUrgentAttentionClients(limit = 8): QoLUrgentClient[] {
  const cached = getSessionDerived()?.urgentClients;
  if (cached) return cached.slice(0, limit);

  const analytics = getAnalyticsData();

  return analytics.clients
    .map((c) => {
      const qol = computeQoLForClient(c.client, c.tickets);
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
    .filter((c) => c.band === "critical" || c.band === "at-risk" || c.urgentFlags.length > 0)
    .sort((a, b) => a.overall - b.overall)
    .slice(0, limit)
    .map(({ priority: _, ...rest }) => rest);
}
