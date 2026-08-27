export type CelebrationSource = "manual" | "profile" | "holiday";
export type CelebrationKind =
  | "birthday"
  | "anniversary"
  | "important_date"
  | "holiday"
  | "custom";
export type CelebrationRecurrence = "none" | "annual";
export type CelebrationStatus = "planned" | "completed" | "cancelled";
export type CelebrationCity = "Islamabad" | "Karachi" | "Lahore";
/** Legacy coordinator names kept for existing sheet rows; new events use "Team". */
export type CelebrationUser = "Team" | "Laiba" | "Seemab" | "Labeba";

export interface CelebrationCategory {
  id: string;
  label: string;
}

export const DEFAULT_CELEBRATION_CATEGORIES: CelebrationCategory[] = [
  { id: "birthday", label: "Birthday" },
  { id: "anniversary", label: "Anniversary" },
  { id: "important-day", label: "Important Day" },
  { id: "public-holiday", label: "Public Holiday" },
  { id: "eid-religious-holiday", label: "Eid / Religious Holiday" },
  { id: "spa-day", label: "Spa Day" },
  { id: "concert", label: "Concert" },
  { id: "movie", label: "Movie" },
  { id: "play", label: "Play" },
  { id: "outing", label: "Outing" },
  { id: "custom", label: "Custom" },
];

export interface CelebrationTicketLink {
  ticketId: string;
  url: string | null;
}

export interface CelebrationEvent {
  id: string;
  source: CelebrationSource;
  kind: CelebrationKind;
  categoryId: string;
  categoryLabel: string;
  title: string;
  date: string;
  time: string | null;
  allDay: boolean;
  recurrence: CelebrationRecurrence;
  registryIds: string[];
  clientLabels: string[];
  cities: CelebrationCity[];
  notes: string;
  status: CelebrationStatus;
  createdBy: CelebrationUser | "system";
  createdAt: string;
  updatedAt: string;
  ticketLinks: Record<string, CelebrationTicketLink>;
  /** Persisted note/ticket overlay for a deterministic generated profile event. */
  linkedGeneratedId?: string | null;
}

export interface CelebrationEventInput {
  kind: CelebrationKind;
  categoryId: string;
  categoryLabel?: string;
  title: string;
  date: string;
  time?: string | null;
  allDay?: boolean;
  recurrence?: CelebrationRecurrence;
  registryIds?: string[];
  notes?: string;
  status?: CelebrationStatus;
  createdBy: CelebrationUser;
}

export interface CelebrationClientOption {
  id: string;
  label: string;
  beneficiary: string;
  cities: CelebrationCity[];
}

export interface CelebrationsMonthPayload {
  month: string;
  events: CelebrationEvent[];
  clients: CelebrationClientOption[];
  categories: CelebrationCategory[];
  storageMode: "sheet" | "local";
  hubspotEnabled: boolean;
  generatedAt: string;
}

export interface CelebrationMutationResult {
  event: CelebrationEvent;
  warnings: Array<{ registryId: string; message: string }>;
}
