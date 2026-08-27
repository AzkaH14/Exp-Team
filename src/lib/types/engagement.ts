export type EngagementSegment = "underutilising" | "top" | "mid";

export type EngagementCity = "Islamabad" | "Karachi" | "Lahore" | "all";

export interface EngagementSuggestion {
  id: string;
  title: string;
  rationale: string;
  channel: "call" | "whatsapp" | "visit" | "email";
  priority: "high" | "medium" | "low";
}

export interface EngagementClient {
  client: string;
  slug: string;
  city: string;
  email: string | null;
  tickets: number;
  segment: EngagementSegment;
  cityLead: string;
  suggestions: EngagementSuggestion[];
  topServices: string;
  qolOverall: number;
  status: "active" | "pause" | "gratis" | "cancelled" | "unknown";
  isPaused: boolean;
  /** Days since the family's last HubSpot ticket (underutilising segment) */
  daysSinceLastTicket: number | null;
  /** Cross-check with ops underutilising Google Sheet — null when sheet not configured */
  onOpsSheet: boolean | null;
}

export interface UnderutilisingCrossCheck {
  configured: boolean;
  sheetCount: number;
  matched: number;
  hubspotOnly: number;
  sheetOnly: number;
  lastFetchedAt: string | null;
  error: string | null;
}

export interface EngagementPageResult {
  clients: EngagementClient[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  segment: EngagementSegment;
  city: EngagementCity;
  underutilisingCrossCheck?: UnderutilisingCrossCheck;
}

export interface LearnedAction {
  client: string;
  action: string;
  outcome: string;
  recordedAt: string;
}
