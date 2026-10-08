import type { TouchbaseRow } from "../types/touchbase";

/** 2026-10-07 → 2026-11-07 (clamped to month end: Jan 31 → Feb 28). */
export function addOneMonth(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d, last))).toISOString().slice(0, 10);
}

export interface RowCall {
  date: string;
  attendee: string;
  /** Typed next due, else one month after a Done call. */
  nextDue: string;
  auto: boolean;
  title: string;
  odooTaskId: number | null;
}

/** The call shown for a row: the logged one, else the latest completed Engagement Call / Visit from Odoo or the calendar. */
export function callFor(row: TouchbaseRow): RowCall | null {
  if (row.entry) {
    const e = row.entry;
    return {
      date: e.callDate,
      attendee: e.attendee,
      nextDue: e.nextDue || (e.status === "done" && e.callDate ? addOneMonth(e.callDate) : ""),
      auto: false,
      title: "",
      odooTaskId: null,
    };
  }
  const touch = row.activities.find((a) => a.done && a.touch);
  if (!touch) return null;
  // "Experience Team" is the default assignee, not a person.
  const people = touch.people.filter((p) => p.toLowerCase() !== "experience team");
  return {
    date: touch.date,
    attendee: people.join(", "),
    nextDue: touch.date ? addOneMonth(touch.date) : "",
    auto: true,
    title: touch.title,
    odooTaskId: touch.odooTaskId,
  };
}

/** First month the tracker ran. Earlier months are never written to the sheet. */
export const TRACKER_START_MONTH = "2026-10";

/** Current month in Pakistan time (YYYY-MM). */
export function pktMonthKey(now: Date = new Date()): string {
  return new Date(now.getTime() + 5 * 60 * 60 * 1000).toISOString().slice(0, 7);
}

/** Months the sheet keeps: from the tracker's start up to this month — never the future. */
export function isSheetMonth(month: string): boolean {
  return month >= TRACKER_START_MONTH && month <= pktMonthKey();
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
}

/** 2026-10-07 → "7th October 2026" (the ops sheet's style, with the year so it reads back unambiguously). */
export function formatSheetDate(dateKey: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!m) return dateKey;
  return `${ordinal(Number(m[3]))} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

/** "7th October 2026" / "7 Oct" / "2026-10-07" → 2026-10-07. A missing year takes `fallbackYear`. */
export function parseSheetDate(raw: string, fallbackYear: number): string {
  const s = raw.trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = /^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\.?,?\s*(\d{4})?$/.exec(s);
  if (!m) return "";
  const month = MONTHS.findIndex((name) => name.toLowerCase().startsWith(m[2].toLowerCase().slice(0, 3)));
  if (month < 0) return "";
  const year = m[3] ? Number(m[3]) : fallbackYear;
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(Number(m[1])).padStart(2, "0")}`;
}

/** 2026-10 → "October 2026" */
export function monthLabelOf(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

/** "October 2026" → 2026-10 ("" if not a month label). */
export function parseMonthLabel(raw: string): string {
  const m = /^([A-Za-z]+)\s+(\d{4})$/.exec(raw.trim());
  if (!m) return /^\d{4}-\d{2}$/.test(raw.trim()) ? raw.trim() : "";
  const idx = MONTHS.findIndex((name) => name.toLowerCase() === m[1].toLowerCase());
  return idx < 0 ? "" : `${m[2]}-${String(idx + 1).padStart(2, "0")}`;
}
