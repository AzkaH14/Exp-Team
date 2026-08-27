export type QoLDimension =
  | "healthcare"
  | "engagement"
  | "errands"
  | "experience"
  | "responsiveness";

export interface QoLDimensionScore {
  dimension: QoLDimension;
  label: string;
  score: number;
  weight: number;
  tickets: number;
  trend: "up" | "down" | "stable";
}

export interface QoLScore {
  overall: number;
  band: "critical" | "at-risk" | "stable" | "thriving";
  dimensions: QoLDimensionScore[];
  ticketCount: number;
  urgentFlags: string[];
  prediction: {
    nextMonthTickets: number;
    riskLevel: "low" | "medium" | "high";
    narrative: string;
  };
}

export interface ClientQoLProfile {
  client: string;
  slug: string;
  city: string;
  email: string | null;
  tickets: number;
  qol: QoLScore;
  topServices: string;
}

export interface QoLUrgentClient {
  client: string;
  slug: string;
  city: string;
  overall: number;
  band: QoLScore["band"];
  ticketCount: number;
  urgentFlags: string[];
}

export interface QoLDistributionBucket {
  band: QoLScore["band"];
  label: string;
  count: number;
  pct: number;
}
