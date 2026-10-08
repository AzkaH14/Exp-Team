/**
 * Benefactor Touchbase Tracker — one monthly check-in per benefactor.
 * Mirrors the ops "Benefactor Touchbase Tracker" sheet: Status, Date of call,
 * Attendee, Note and Next touchbase due, per city.
 */

export const TOUCHBASE_CITIES = [
  "Islamabad",
  "Rawalpindi",
  "Lahore",
  "Faisalabad",
  "Gujranwala",
  "Karachi",
] as const;
export type TouchbaseCity = (typeof TOUCHBASE_CITIES)[number];

export type TouchbaseStatus = "pending" | "done" | "rescheduled" | "not_reached";

export const TOUCHBASE_STATUS_LABELS: Record<TouchbaseStatus, string> = {
  pending: "Pending",
  done: "Done",
  rescheduled: "Rescheduled",
  not_reached: "Not reached",
};

/** What the team logged for one benefactor in one month (stored row). */
export interface TouchbaseEntry {
  /** `${month}|${registryId}` */
  key: string;
  /** YYYY-MM */
  month: string;
  registryId: string;
  benefactorCode: string;
  benefactor: string;
  city: string;
  status: TouchbaseStatus;
  /** YYYY-MM-DD */
  callDate: string;
  attendee: string;
  note: string;
  /** YYYY-MM-DD */
  nextDue: string;
  updatedBy: string;
  updatedAt: string;
}

/** An Odoo Experience task or calendar entry for the benefactor in the month. */
export interface TouchbaseActivity {
  source: "odoo" | "calendar";
  id: string;
  title: string;
  /** YYYY-MM-DD */
  date: string;
  /** Odoo stage name, or calendar status label. */
  stage: string;
  done: boolean;
  /** A conversation type (Engagement Call / Visit, City Owner Visit) — can auto-mark Done. */
  touch: boolean;
  people: string[];
  odooTaskId: number | null;
}

export interface TouchbaseRow {
  registryId: string;
  benefactor: string;
  benefactorCode: string | null;
  city: TouchbaseCity;
  odooPartnerId: number | null;
  /** Logged entry for the month, if any. */
  entry: TouchbaseEntry | null;
  /** Status shown: the logged one, else Done when Odoo/calendar shows a completed touch. */
  status: TouchbaseStatus;
  /** "auto" = no logged entry; status derived from Odoo / calendar activity. */
  statusSource: "logged" | "auto" | "none";
  activities: TouchbaseActivity[];
}

export interface TouchbaseCitySummary {
  city: TouchbaseCity;
  total: number;
  done: number;
  rescheduled: number;
  notReached: number;
  pending: number;
}

export interface TouchbaseData {
  month: string;
  monthLabel: string;
  rows: TouchbaseRow[];
  cities: TouchbaseCitySummary[];
  storageMode: "sheet" | "memory";
  /** Set when the Google Sheet mirror could not be read or written this load. */
  sheetError: string | null;
  /** Odoo reachable for cities + Experience tasks this load. */
  odooLive: boolean;
  odooUrl: string | null;
  attendees: string[];
}
