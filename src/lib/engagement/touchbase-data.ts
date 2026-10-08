import "server-only";
import { getSacredRegistry } from "../client-registry/store";
import { isOdooConfigured } from "../integrations/odoo";
import {
  fetchExperienceTasks,
  fetchPartnerCities,
  type OdooExperienceTask,
} from "../integrations/odoo-touchbase";
import { getAllEvents } from "./calendar-store";
import { mapSatelliteToEngagementCity, UTILIZATION_STATUSES } from "./calendar-clients";
import { CITY_LEADS } from "./team";
import {
  getTouchbaseEntries,
  getTouchbaseStorageMode,
  saveLocalTouchbaseEntry,
} from "./touchbase-store";
import { syncSheetMonth } from "../integrations/touchbase-sheet";
import { isSheetMonth, pktMonthKey } from "./touchbase-shared";
import { engagementEventTypeLabel } from "../types/engagement-calendar";
import {
  TOUCHBASE_CITIES,
  type TouchbaseActivity,
  type TouchbaseCity,
  type TouchbaseCitySummary,
  type TouchbaseData,
  type TouchbaseEntry,
  type TouchbaseRow,
} from "../types/touchbase";
import type { ClientRegistryRecord } from "../types/client-registry";

export function currentMonthKey(now: Date = new Date()): string {
  // Pakistan time — the team's month turns over at PKT midnight.
  return pktMonthKey(now);
}

export function parseMonthParam(raw: string | null | undefined): string {
  return raw && /^\d{4}-(0[1-9]|1[0-2])$/.test(raw) ? raw : currentMonthKey();
}

function monthLabel(month: string): string {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Odoo / registry city → one of the six tracker cities (null if none fits). */
function toTouchbaseCity(raw: string): TouchbaseCity | null {
  const c = raw.trim().toLowerCase();
  if (!c) return null;
  if (c.includes("rawalpindi") || c.includes("pindi")) return "Rawalpindi";
  if (c.includes("islamabad") || c === "isb") return "Islamabad";
  if (c.includes("karachi") || c === "khi") return "Karachi";
  if (c.includes("lahore") || c === "lhr") return "Lahore";
  // Odoo spells it "Faislabad".
  if (c.includes("faisalabad") || c.includes("faislabad") || c.includes("lyallpur")) return "Faisalabad";
  if (c.includes("gujranwala") || c.includes("gujran")) return "Gujranwala";
  return null;
}

function resolveCity(record: ClientRegistryRecord, odooCity: string | undefined): TouchbaseCity | null {
  return (
    toTouchbaseCity(odooCity ?? "") ??
    toTouchbaseCity(record.city) ??
    // Other satellites (Lodhran, Multan…) stay with their team's city.
    (mapSatelliteToEngagementCity(record.city) as TouchbaseCity | null)
  );
}

/**
 * Only conversations count as a touchbase. Gift deliveries, event support and
 * other Experience work still show as activity but never auto-mark Done.
 */
function isTouchType(label: string): boolean {
  return /engag|city owner visit/i.test(label);
}

function odooActivity(t: OdooExperienceTask): TouchbaseActivity {
  return {
    source: "odoo",
    id: `odoo-${t.id}`,
    title: t.subcategory || t.name,
    date: t.date,
    stage: t.stage,
    done: t.done,
    touch: isTouchType(t.subcategory),
    people: t.people,
    odooTaskId: t.id,
  };
}

export async function getTouchbaseData(
  month: string,
  opts: { freshEntries?: boolean; syncSheet?: boolean } = {}
): Promise<TouchbaseData> {
  const roster = getSacredRegistry().filter((r) => UTILIZATION_STATUSES.has(r.status));
  const partnerIds = roster
    .map((r) => r.odooPartnerId)
    .filter((id): id is number => typeof id === "number");

  let odooLive = false;
  let cities = new Map<number, string>();
  let tasks: OdooExperienceTask[] = [];
  if (isOdooConfigured()) {
    try {
      [cities, tasks] = await Promise.all([
        fetchPartnerCities(partnerIds),
        fetchExperienceTasks(month, partnerIds),
      ]);
      odooLive = true;
    } catch (e) {
      console.warn("Touchbase: Odoo unavailable, using registry cities only:", e);
    }
  }

  const [entries, events] = await Promise.all([
    getTouchbaseEntries(month, opts.freshEntries),
    // Calendar entries are a bonus signal — an unreadable calendar sheet must not take the tracker down.
    getAllEvents().catch((e) => {
      console.warn("Touchbase: calendar entries unavailable:", e);
      return [];
    }),
  ]);
  const entryByRegistry = new Map(entries.map((e) => [e.registryId, e]));

  const tasksByPartner = new Map<number, OdooExperienceTask[]>();
  for (const t of tasks) {
    const list = tasksByPartner.get(t.partnerId) ?? [];
    list.push(t);
    tasksByPartner.set(t.partnerId, list);
  }
  const odooTaskIds = new Set(tasks.map((t) => t.id));

  const eventsByRegistry = new Map<string, TouchbaseActivity[]>();
  for (const e of events) {
    if (!e.date.startsWith(month) || e.status === "cancelled") continue;
    // Already shown via its Odoo task.
    if (e.odooTaskId && odooTaskIds.has(e.odooTaskId)) continue;
    const list = eventsByRegistry.get(e.registryId) ?? [];
    list.push({
      source: "calendar",
      id: e.id,
      title: e.title || engagementEventTypeLabel(e),
      date: e.date,
      stage: e.status === "completed" ? "Completed" : e.status === "rescheduled" ? "Rescheduled" : "Planned",
      done: e.status === "completed",
      touch: isTouchType(engagementEventTypeLabel(e)),
      people: [e.createdBy || e.lead].filter(Boolean),
      odooTaskId: e.odooTaskId ?? null,
    });
    eventsByRegistry.set(e.registryId, list);
  }

  const rows: TouchbaseRow[] = [];
  for (const r of roster) {
    const city = resolveCity(r, r.odooPartnerId ? cities.get(r.odooPartnerId) : undefined);
    if (!city) continue;
    const entry = entryByRegistry.get(r.id) ?? null;
    const activities = [
      ...(r.odooPartnerId ? tasksByPartner.get(r.odooPartnerId) ?? [] : [])
        .filter((t) => !/cancel/i.test(t.stage))
        .map(odooActivity),
      ...(eventsByRegistry.get(r.id) ?? []),
    ].sort((a, b) => b.date.localeCompare(a.date));
    const autoDone = activities.some((a) => a.done && a.touch);
    rows.push({
      registryId: r.id,
      benefactor: r.benefactor,
      benefactorCode: r.benefactorCode ?? null,
      city,
      odooPartnerId: r.odooPartnerId ?? null,
      entry,
      status: entry ? entry.status : autoDone ? "done" : "pending",
      statusSource: entry ? "logged" : autoDone ? "auto" : "none",
      activities,
    });
  }
  rows.sort(
    (a, b) =>
      TOUCHBASE_CITIES.indexOf(a.city) - TOUCHBASE_CITIES.indexOf(b.city) ||
      a.benefactor.localeCompare(b.benefactor)
  );

  const summaries: TouchbaseCitySummary[] = TOUCHBASE_CITIES.map((city) => {
    const inCity = rows.filter((r) => r.city === city);
    const count = (s: TouchbaseRow["status"]) => inCity.filter((r) => r.status === s).length;
    return {
      city,
      total: inCity.length,
      done: count("done"),
      rescheduled: count("rescheduled"),
      notReached: count("not_reached"),
      pending: count("pending"),
    };
  });

  const attendees = [
    ...new Set([
      ...Object.values(CITY_LEADS),
      ...entries.map((e) => e.attendee).filter(Boolean),
    ]),
  ];

  const storageMode = getTouchbaseStorageMode();
  let sheetError: string | null = null;
  // Viewing a future month, or one before the tracker began, never writes a block.
  if (storageMode === "sheet" && opts.syncSheet !== false && isSheetMonth(month)) {
    // Keep the "Benefactor Tracker" tab a full mirror of this month (no-op when unchanged).
    try {
      await syncSheetMonth(month, rows);
    } catch (e) {
      sheetError = e instanceof Error ? e.message : "Sheet sync failed";
      console.warn("Touchbase sheet sync failed:", e);
    }
  }

  return {
    month,
    monthLabel: monthLabel(month),
    rows,
    cities: summaries,
    storageMode,
    sheetError,
    odooLive,
    odooUrl: process.env.ODOO_URL?.trim().replace(/\/+$/, "") || null,
    attendees,
  };
}

/** Save one benefactor's month entry — to the sheet (rewriting the month mirror) or locally. */
export async function saveTouchbaseEntry(entry: TouchbaseEntry): Promise<TouchbaseEntry> {
  if (getTouchbaseStorageMode() !== "sheet") return saveLocalTouchbaseEntry(entry);
  const data = await getTouchbaseData(entry.month, { freshEntries: true, syncSheet: false });
  const rows = data.rows.map((r) =>
    r.registryId === entry.registryId
      ? { ...r, entry, status: entry.status, statusSource: "logged" as const }
      : r
  );
  await syncSheetMonth(entry.month, rows, entry.registryId);
  return entry;
}
