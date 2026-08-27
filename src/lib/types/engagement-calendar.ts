export type EngagementEventType =
  | "doctor_call"
  | "psychologist_call"
  | "checkin_call"
  | "visit"
  | "outing"
  | "other";

export type EngagementEventStatus =
  | "planned"
  | "completed"
  | "rescheduled"
  | "cancelled";

export const ENGAGEMENT_EVENT_TYPE_LABELS: Record<EngagementEventType, string> = {
  doctor_call: "Doctor call check-in",
  psychologist_call: "Psychologist call",
  checkin_call: "Regular call check-in",
  visit: "Visit check-in",
  outing: "Outing",
  other: "Other",
};

export const ENGAGEMENT_EVENT_STATUS_LABELS: Record<EngagementEventStatus, string> = {
  planned: "Planned",
  completed: "Completed",
  rescheduled: "Rescheduled",
  cancelled: "Cancelled",
};

/** A scheduled or logged coordinator touchpoint with a client */
export interface EngagementEvent {
  id: string;
  registryId: string;
  clientLabel: string;
  city: string;
  /** Team lead responsible (Laiba / Seemab / Labeba) */
  lead: string;
  type: EngagementEventType;
  /** Optional free-text detail of the visit/call */
  title: string;
  notes: string;
  /** Scheduled date, YYYY-MM-DD */
  date: string;
  /** Optional time of day, HH:MM (24h) */
  time: string | null;
  status: EngagementEventStatus;
  /** Original date if this event has been rescheduled */
  rescheduledFrom: string | null;
  /** Assigned clinician for doctor_call events */
  assignedDoctor: string | null;
  /** Linked HubSpot ticket id when auto-created */
  hubspotTicketId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface EngagementEventInput {
  registryId: string;
  type: EngagementEventType;
  title?: string;
  notes?: string;
  date: string;
  time?: string | null;
  status?: EngagementEventStatus;
  createdBy?: string;
  assignedDoctor?: string | null;
}

/** A client row in the calendar's coverage view */
export interface CalendarClientRow {
  registryId: string;
  label: string;
  beneficiary: string;
  city: string;
  /** City used when scheduling (single city; for dual-city families) */
  scheduleCity: string;
  lead: string;
  status: string;
  /** ISO date of most recent touch (HubSpot ticket or logged event), or null */
  lastTouch: string | null;
  lastTouchSource: "ticket" | "engagement" | null;
  daysSinceTouch: number | null;
  touchedThisMonth: boolean;
  /** 28+ days since last touch, or listed on ops non-utilizer sheet */
  underutilising: boolean;
  /** Present on the ops "28 day non utilizer" sheet */
  onOpsSheet: boolean;
  /** One short scheduling hint (birthday / re-engage) — null when nothing useful */
  prompt: string | null;
  openTicketCount: number;
  /** Events for the currently selected week */
  weekEvents: EngagementEvent[];
}

export interface CalendarCitySummary {
  city: string;
  lead: string;
  totalClients: number;
  touchedThisMonth: number;
  untouchedThisMonth: number;
  clientsWithOpenTickets: number;
}

export interface EngagementCalendarData {
  city: string;
  weekStart: string;
  weekEnd: string;
  monthLabel: string;
  /** "sheet" = durable Google Sheet; "memory" = ephemeral local/in-memory store */
  storageMode: "sheet" | "memory";
  /** Whether new calendar entries auto-create HubSpot tickets */
  hubspotAutoCreate: boolean;
  /** HubSpot portal id for ticket links (when configured) */
  hubSpotPortalId: string | null;
  cities: CalendarCitySummary[];
  clients: CalendarClientRow[];
  weekEvents: EngagementEvent[];
  /** Optional portfolio observance within ~7 days (e.g. Mother's Day) */
  observanceBanner: string | null;
  summary: {
    interactionsYesterday: number;
    eventsYesterday: number;
    ticketsYesterday: number;
    totalOpenTickets: number;
    totalClients: number;
    underutilisingCount: number;
  };
}
