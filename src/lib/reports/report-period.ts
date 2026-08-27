import type { Ticket } from "../types/ticket";
import { formatReportDate, parseTicketDate } from "./ticket-match";

function monthKeyToLabel(monthKey: string): string {
  const [year, monthNum] = monthKey.split("-");
  const idx = parseInt(monthNum, 10) - 1;
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  if (idx < 0 || idx > 11 || !year) return monthKey;
  return `${months[idx]} ${year}`;
}

export type ReportPeriodMode = "month" | "week" | "range";

export interface ReportPeriod {
  mode: ReportPeriodMode;
  start: Date;
  end: Date;
  label: string;
  /** Stable key for caches and overrides */
  cacheKey: string;
  monthKey?: string;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function utcDayStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function utcDayEnd(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999)
  );
}

function parseIsoDate(iso: string): Date | null {
  if (!ISO_DATE_RE.test(iso)) return null;
  const d = new Date(`${iso}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatPeriodRange(start: Date, end: Date): string {
  const sameMonth =
    start.getUTCMonth() === end.getUTCMonth() &&
    start.getUTCFullYear() === end.getUTCFullYear();
  if (sameMonth) {
    return `${formatReportDate(start)} – ${formatReportDate(end)}`;
  }
  return `${formatReportDate(start)} – ${formatReportDate(end)}`;
}

export function parseReportPeriod(input: {
  month?: string | null;
  startDate?: string | null;
  endDate?: string | null;
}): ReportPeriod | null {
  const month = input.month?.trim();
  const startDate = input.startDate?.trim();
  const endDate = input.endDate?.trim();

  if (startDate && endDate) {
    const start = parseIsoDate(startDate);
    const end = parseIsoDate(endDate);
    if (!start || !end || start > end) return null;
    const startDay = utcDayStart(start);
    const endDay = utcDayEnd(end);
    const days =
      Math.round((endDay.getTime() - startDay.getTime()) / (24 * 60 * 60 * 1000)) + 1;
    const mode: ReportPeriodMode = days <= 7 ? "week" : "range";
    return {
      mode,
      start: startDay,
      end: endDay,
      label: formatPeriodRange(startDay, endDay),
      cacheKey: `${startDate}_${endDate}`,
    };
  }

  if (startDate && !endDate) {
    const start = parseIsoDate(startDate);
    if (!start) return null;
    const startDay = utcDayStart(start);
    const endDay = utcDayEnd(new Date(startDay.getTime() + 6 * 24 * 60 * 60 * 1000));
    const endIso = endDay.toISOString().slice(0, 10);
    return {
      mode: "week",
      start: startDay,
      end: endDay,
      label: `Week of ${formatReportDate(startDay)} (${formatPeriodRange(startDay, endDay)})`,
      cacheKey: `${startDate}_${endIso}`,
    };
  }

  if (month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    const [y, m] = month.split("-").map(Number);
    const start = utcDayStart(new Date(Date.UTC(y, m - 1, 1)));
    const end = utcDayEnd(new Date(Date.UTC(y, m, 0)));
    return {
      mode: "month",
      start,
      end,
      label: monthKeyToLabel(month),
      cacheKey: month,
      monthKey: month,
    };
  }

  return null;
}

export function defaultReportPeriod(): ReportPeriod {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const month = `${y}-${m}`;
  return parseReportPeriod({ month })!;
}

export function ticketInPeriod(ticket: Ticket, period: ReportPeriod): boolean {
  const d =
    parseTicketDate(ticket.closed) ??
    parseTicketDate(ticket.created) ??
    parseTicketDate(ticket.month.replace(/^(\w+)\s+(\d{4})$/, "1 $1 $2"));
  if (!d) return false;
  return d >= period.start && d <= period.end;
}

export function filterTicketsInPeriod(tickets: Ticket[], period: ReportPeriod): Ticket[] {
  return tickets.filter((t) => ticketInPeriod(t, period));
}

export interface ReportPeriodInput {
  mode: ReportPeriodMode;
  month?: string;
  startDate?: string;
  endDate?: string;
}

export function periodInputFromReportPeriod(period: ReportPeriod): ReportPeriodInput {
  return {
    mode: period.mode,
    month: period.monthKey,
    startDate: period.start.toISOString().slice(0, 10),
    endDate: period.end.toISOString().slice(0, 10),
  };
}

export function parsePeriodInput(input: ReportPeriodInput): ReportPeriod | null {
  if (input.mode === "month" && input.month) {
    return parseReportPeriod({ month: input.month });
  }
  if (input.startDate) {
    return parseReportPeriod({
      startDate: input.startDate,
      endDate: input.endDate,
    });
  }
  return null;
}

export function appendPeriodToSearchParams(
  params: URLSearchParams,
  input: ReportPeriodInput
): void {
  if (input.mode === "month" && input.month) {
    params.set("month", input.month);
    return;
  }
  if (input.startDate) params.set("startDate", input.startDate);
  if (input.endDate) params.set("endDate", input.endDate);
}

export function countTicketsInPeriod(
  ticketsByFamily: Map<string, Ticket[]>,
  period: ReportPeriod
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const [registryId, tickets] of ticketsByFamily) {
    const n = filterTicketsInPeriod(tickets, period).length;
    if (n > 0) counts.set(registryId, n);
  }
  return counts;
}
