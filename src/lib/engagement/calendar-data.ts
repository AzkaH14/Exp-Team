import "server-only";
import { getSacredRegistry } from "../client-registry/store";
import { parseTicketDate } from "../reports/ticket-match";
import { isTicketOpen } from "../ticket-queue-intelligence";
import { getReportTicketIndex } from "../reports/ticket-index";
import { getAllEvents, getCalendarStorageMode } from "./calendar-store";
import { isHubSpotTicketCreateEnabled } from "../integrations/hubspot-ticket-create";
import { CITY_LEADS, ENGAGEMENT_CITIES, getCityLead } from "./team";
import {
  calendarRowCity,
  engagementCitiesFor,
  isCalendarEligibleClient,
} from "./calendar-clients";
import {
  calendarPromptForClient,
  calendarWeekObservanceBanner,
  isUnderutilisingByDays,
} from "./calendar-prompts";
import { resolveSheetEntryToRegistry } from "./underutilising-candidates";
import {
  getUnderutilisingSheetEntries,
  refreshUnderutilisingSheetCache,
} from "./underutilising-sheet";
import { isUnderutilisingSheetConfigured } from "../integrations/google-sheets";
import { getAnalyticsData } from "../analytics-data";
import type {
  CalendarCitySummary,
  CalendarClientRow,
  EngagementCalendarData,
  EngagementEvent,
} from "../types/engagement-calendar";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const CALENDAR_CITIES = ENGAGEMENT_CITIES as string[];

function toDateKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Monday-anchored week bounds for the week containing `ref`. */
export function getWeekBounds(ref: Date): { start: string; end: string } {
  const d = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate()));
  const dow = d.getUTCDay(); // 0 = Sun
  const diffToMonday = (dow + 6) % 7;
  const start = new Date(d.getTime() - diffToMonday * MS_PER_DAY);
  const end = new Date(start.getTime() + 6 * MS_PER_DAY);
  return { start: toDateKey(start), end: toDateKey(end) };
}

export function parseWeekParam(raw: string | null | undefined): Date {
  if (raw) {
    const parsed = new Date(`${raw}T00:00:00Z`);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

function monthKeyOf(dateKey: string): string {
  return dateKey.slice(0, 7);
}

function monthLabelOf(now: Date): string {
  return now.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

interface TicketAggregates {
  openByRegistry: Map<string, number>;
  ticketThisMonthByRegistry: Set<string>;
  ticketsYesterday: number;
}

function aggregateTickets(now: Date): TicketAggregates {
  const openByRegistry = new Map<string, number>();
  const ticketThisMonthByRegistry = new Set<string>();
  const thisMonth = toDateKey(now).slice(0, 7);
  const yesterdayKey = toDateKey(new Date(now.getTime() - MS_PER_DAY));
  let ticketsYesterday = 0;

  const index = getReportTicketIndex();
  for (const [registryId, tickets] of index.byRegistryId) {
    for (const ticket of tickets) {
      if (isTicketOpen(ticket)) {
        openByRegistry.set(registryId, (openByRegistry.get(registryId) ?? 0) + 1);
      }

      const created = parseTicketDate(ticket.created);
      const closed = parseTicketDate(ticket.closed);
      const activityDate =
        closed && created && closed > created ? closed : created ?? closed;

      if (activityDate && toDateKey(activityDate).slice(0, 7) === thisMonth) {
        ticketThisMonthByRegistry.add(registryId);
      }
      if (created && toDateKey(created) === yesterdayKey) {
        ticketsYesterday++;
      }
    }
  }

  return { openByRegistry, ticketThisMonthByRegistry, ticketsYesterday };
}

/** Latest HubSpot ticket date per family (uses pre-built ticket index). */
function buildLastTicketByRegistryId(): Map<string, Date> {
  const map = new Map<string, Date>();
  const index = getReportTicketIndex();
  for (const [registryId, tickets] of index.byRegistryId) {
    for (const ticket of tickets) {
      const d = parseTicketDate(ticket.closed) ?? parseTicketDate(ticket.created);
      if (!d) continue;
      const prev = map.get(registryId);
      if (!prev || d > prev) map.set(registryId, d);
    }
  }
  return map;
}

/** Latest engagement event date per registry (excluding cancelled). */
function buildLastEventByRegistry(events: EngagementEvent[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const e of events) {
    if (e.status === "cancelled") continue;
    const prev = map.get(e.registryId);
    if (!prev || e.date > prev) map.set(e.registryId, e.date);
  }
  return map;
}

export async function getEngagementCalendarData(
  city: string,
  weekRef: Date = new Date()
): Promise<EngagementCalendarData> {
  const now = new Date();
  const registry = getSacredRegistry();
  const events = await getAllEvents();
  const { start: weekStart, end: weekEnd } = getWeekBounds(weekRef);

  if (isUnderutilisingSheetConfigured()) {
    try {
      await refreshUnderutilisingSheetCache();
    } catch (e) {
      console.warn("Underutilising sheet refresh failed:", e);
    }
  }

  const sheetEntries = getUnderutilisingSheetEntries();
  const opsSheetRegistryIds = new Set<string>();
  if (sheetEntries?.length) {
    const analyticsClients = getAnalyticsData().clients;
    for (const entry of sheetEntries) {
      const record = resolveSheetEntryToRegistry(entry, analyticsClients);
      if (record) opsSheetRegistryIds.add(record.id);
    }
  }

  const lastTicketByRegistry = buildLastTicketByRegistryId();
  const lastEventByRegistry = buildLastEventByRegistry(events);
  const { openByRegistry, ticketThisMonthByRegistry, ticketsYesterday } =
    aggregateTickets(now);

  const thisMonthKey = toDateKey(now).slice(0, 7);
  const yesterdayKey = toDateKey(new Date(now.getTime() - MS_PER_DAY));

  // Which registries have a (non-cancelled) engagement event this month
  const eventThisMonthByRegistry = new Set<string>();
  let eventsYesterday = 0;
  for (const e of events) {
    if (e.status !== "cancelled" && monthKeyOf(e.date) === thisMonthKey) {
      eventThisMonthByRegistry.add(e.registryId);
    }
    if (e.status !== "cancelled" && e.date === yesterdayKey) {
      eventsYesterday++;
    }
  }

  const calendarClients = registry.filter(isCalendarEligibleClient);

  const eventsByRegistry = new Map<string, EngagementEvent[]>();
  for (const e of events) {
    const list = eventsByRegistry.get(e.registryId) ?? [];
    list.push(e);
    eventsByRegistry.set(e.registryId, list);
  }

  const clients: CalendarClientRow[] = calendarClients
    .filter(
      (r) =>
        city === "all" || engagementCitiesFor(r).includes(city)
    )
    .map((r) => {
      const lastTicket = lastTicketByRegistry.get(r.id) ?? null;
      const lastEvent = lastEventByRegistry.get(r.id) ?? null;
      const lastTicketKey = lastTicket ? toDateKey(lastTicket) : null;

      let lastTouch: string | null = null;
      let lastTouchSource: "ticket" | "engagement" | null = null;
      if (lastTicketKey && lastEvent) {
        if (lastEvent >= lastTicketKey) {
          lastTouch = lastEvent;
          lastTouchSource = "engagement";
        } else {
          lastTouch = lastTicketKey;
          lastTouchSource = "ticket";
        }
      } else if (lastEvent) {
        lastTouch = lastEvent;
        lastTouchSource = "engagement";
      } else if (lastTicketKey) {
        lastTouch = lastTicketKey;
        lastTouchSource = "ticket";
      }

      const daysSinceTouch = lastTouch
        ? Math.max(
            0,
            Math.floor(
              (now.getTime() - new Date(`${lastTouch}T00:00:00Z`).getTime()) /
                MS_PER_DAY
            )
          )
        : null;

      const touchedThisMonth =
        eventThisMonthByRegistry.has(r.id) ||
        ticketThisMonthByRegistry.has(r.id);

      const onOpsSheet = opsSheetRegistryIds.has(r.id);
      // Ops sheet is a hint only — recent HubSpot/calendar activity clears underutilising
      const underutilising = isUnderutilisingByDays(daysSinceTouch);

      const weekEvents = (eventsByRegistry.get(r.id) ?? [])
        .filter((e) => e.date >= weekStart && e.date <= weekEnd)
        .sort(
          (a, b) =>
            a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? "")
        );

      const rowCity = calendarRowCity(r, city);
      const cityLabel =
        city === "all" && engagementCitiesFor(r).length > 1
          ? engagementCitiesFor(r).join(" / ")
          : rowCity;

      return {
        registryId: r.id,
        label: r.benefactor,
        beneficiary: r.beneficiary,
        city: cityLabel,
        scheduleCity: rowCity,
        lead: getCityLead(rowCity),
        status: r.status,
        lastTouch,
        lastTouchSource,
        daysSinceTouch,
        touchedThisMonth,
        underutilising,
        onOpsSheet,
        prompt: calendarPromptForClient({
          registryId: r.id,
          underutilising,
          daysSinceTouch,
        }),
        openTicketCount: openByRegistry.get(r.id) ?? 0,
        weekEvents,
      };
    })
    .sort((a, b) => {
      // Underutilising first, then untouched-this-month, then longest since last touch
      if (a.underutilising !== b.underutilising) {
        return a.underutilising ? -1 : 1;
      }
      if (a.touchedThisMonth !== b.touchedThisMonth) {
        return a.touchedThisMonth ? 1 : -1;
      }
      const da = a.daysSinceTouch ?? Number.MAX_SAFE_INTEGER;
      const db = b.daysSinceTouch ?? Number.MAX_SAFE_INTEGER;
      if (da !== db) return db - da;
      return a.label.localeCompare(b.label);
    });

  const cities: CalendarCitySummary[] = CALENDAR_CITIES.map((c) => {
    const cityClients = calendarClients.filter((r) =>
      engagementCitiesFor(r).includes(c)
    );
    const touched = cityClients.filter(
      (r) =>
        eventThisMonthByRegistry.has(r.id) || ticketThisMonthByRegistry.has(r.id)
    ).length;
    const withOpen = cityClients.filter(
      (r) => (openByRegistry.get(r.id) ?? 0) > 0
    ).length;
    return {
      city: c,
      lead: CITY_LEADS[c as keyof typeof CITY_LEADS] ?? "Team Lead",
      totalClients: cityClients.length,
      touchedThisMonth: touched,
      untouchedThisMonth: cityClients.length - touched,
      clientsWithOpenTickets: withOpen,
    };
  });

  const weekEvents = events
    .filter((e) => e.date >= weekStart && e.date <= weekEnd)
    .filter((e) => city === "all" || e.city === city)
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? "")
    );

  const scopedClients =
    city === "all"
      ? calendarClients
      : calendarClients.filter((r) => engagementCitiesFor(r).includes(city));
  const totalOpenTickets = scopedClients.reduce(
    (sum, r) => sum + (openByRegistry.get(r.id) ?? 0),
    0
  );

  return {
    city,
    weekStart,
    weekEnd,
    monthLabel: monthLabelOf(now),
    cities,
    clients,
    weekEvents,
    observanceBanner: calendarWeekObservanceBanner(now),
    storageMode: getCalendarStorageMode(),
    hubspotAutoCreate: isHubSpotTicketCreateEnabled(),
    hubSpotPortalId: process.env.HUBSPOT_PORTAL_ID?.trim() || null,
    summary: {
      interactionsYesterday: eventsYesterday + ticketsYesterday,
      eventsYesterday,
      ticketsYesterday,
      totalOpenTickets,
      totalClients: scopedClients.length,
      underutilisingCount: clients.filter((c) => c.underutilising).length,
    },
  };
}
