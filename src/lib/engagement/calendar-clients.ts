import type { ClientRegistryRecord } from "../types/client-registry";
import { ENGAGEMENT_CITIES } from "./team";

const CALENDAR_CITY_SET = new Set<string>(ENGAGEMENT_CITIES);

/**
 * Utilization rule, from the Odoo benefactor tags: only Active and Gratis
 * families count. Paused and Churned (registry "cancelled") are excluded.
 * Beneficiaries carry only the Beneficiary tag — their family's benefactor
 * status decides.
 */
export const UTILIZATION_STATUSES = new Set<ClientRegistryRecord["status"]>([
  "active",
  "gratis",
]);

/**
 * For engagement meta, where an unmatched client is "unknown" — those were
 * always counted, so only an explicit paused / churned status excludes.
 */
export function isExcludedFromUtilization(status: string): boolean {
  return status === "pause" || status === "potential_pause" || status === "cancelled";
}

/** Clients the engagement calendar tracks coverage for — the utilization set. */
export const CALENDAR_ELIGIBLE_STATUSES = UTILIZATION_STATUSES;

/**
 * Map home / satellite cities onto an engagement-team city.
 * Faisalabad (and nearby satellites) are served by the Lahore team.
 */
export function mapSatelliteToEngagementCity(city: string): string | null {
  const c = city.trim().toLowerCase();
  if (!c) return null;
  if (c.includes("islamabad") || c.includes("rawalpindi") || c === "isb") {
    return "Islamabad";
  }
  if (c.includes("karachi") || c === "khi") return "Karachi";
  if (
    c.includes("lahore") ||
    c === "lhr" ||
    c.includes("faisalabad") ||
    c.includes("lyallpur") ||
    c.includes("gujranwala") ||
    c.includes("lodhran") ||
    c.includes("bahawalpur") ||
    c.includes("multan")
  ) {
    return "Lahore";
  }
  return null;
}

function toEngagementCity(city: string): string | null {
  if (CALENDAR_CITY_SET.has(city)) return city;
  return mapSatelliteToEngagementCity(city);
}

export function engagementCitiesFor(record: ClientRegistryRecord): string[] {
  const cities = record.engagementCities?.length
    ? record.engagementCities
    : [record.city];
  const mapped = cities
    .map((c) => toEngagementCity(c))
    .filter((c): c is string => Boolean(c));
  return [...new Set(mapped)];
}

/** City used for calendar events, leads, doctors, and HubSpot serving_city */
export function resolveScheduleCity(
  record: ClientRegistryRecord,
  preferred?: string | null
): string {
  const pref = (preferred ?? "").trim();
  if (pref) {
    const mapped = toEngagementCity(pref);
    if (mapped) return mapped;
  }
  const engagement = engagementCitiesFor(record);
  if (engagement[0]) return engagement[0];
  return toEngagementCity(record.city) ?? "Other";
}

export function isCalendarEligibleClient(record: ClientRegistryRecord): boolean {
  return (
    CALENDAR_ELIGIBLE_STATUSES.has(record.status) &&
    engagementCitiesFor(record).length > 0
  );
}

/** City shown on a row and used for coordinator permissions when a city tab is selected */
export function calendarRowCity(
  record: ClientRegistryRecord,
  filterCity: string
): ClientRegistryRecord["city"] {
  if (filterCity !== "all") {
    const match = engagementCitiesFor(record).find((c) => c === filterCity);
    if (match) return match as ClientRegistryRecord["city"];
  }
  // Prefer schedule city so Faisalabad / satellites show under Lahore (Seemab)
  return resolveScheduleCity(record) as ClientRegistryRecord["city"];
}
