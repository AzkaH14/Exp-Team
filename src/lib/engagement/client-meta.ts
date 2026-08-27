import "server-only";
import type { ClientRegistryRecord } from "../types/client-registry";
import type { EngagementCity } from "../types/engagement";
import { matchRegistryRecord } from "../client-registry/name-match";
import { getSacredRegistryIncludingCancelled } from "../client-registry/store";
import { ENGAGEMENT_CITIES } from "./team";

export interface EngagementClientMeta {
  registryId: string | null;
  benefactor: string;
  /** Home / serving city from registry (may be Lodhran, Gujranwala, Other, etc.) */
  homeCity: ClientRegistryRecord["city"] | "Other";
  /**
   * Engagement-team city used for Lahore/Karachi/Islamabad filters.
   * Prefer engagementCities overlays (e.g. Lodhran family under Lahore team).
   */
  city: Exclude<EngagementCity, "all"> | "Other";
  engagementCities: Exclude<EngagementCity, "all">[];
  status: ClientRegistryRecord["status"] | "unknown";
  isPaused: boolean;
  isGratis: boolean;
  isCancelled: boolean;
}

export function registryCityToEngagement(
  city: ClientRegistryRecord["city"] | string
): Exclude<EngagementCity, "all"> | "Other" {
  if (city === "Islamabad" || city === "Karachi" || city === "Lahore") return city;
  return "Other";
}

export function normalizeEngagementCity(city: string): Exclude<EngagementCity, "all"> | "Other" {
  const c = (city ?? "").trim().toLowerCase();
  if (c.includes("islamabad") || c.includes("rawalpindi")) return "Islamabad";
  if (c.includes("karachi")) return "Karachi";
  if (c.includes("lahore")) return "Lahore";
  return "Other";
}

function engagementTeamCitiesFor(
  record: ClientRegistryRecord
): Exclude<EngagementCity, "all">[] {
  const raw = record.engagementCities?.length
    ? record.engagementCities
    : [record.city];
  const team = new Set<Exclude<EngagementCity, "all">>(ENGAGEMENT_CITIES);
  return raw
    .map((c) => registryCityToEngagement(c))
    .filter((c): c is Exclude<EngagementCity, "all"> => team.has(c as Exclude<EngagementCity, "all">));
}

/** Sacred registry is source of truth for city + pause/gratis/cancelled status */
export function resolveEngagementClientMeta(hubspotClientName: string): EngagementClientMeta {
  const registry = getSacredRegistryIncludingCancelled();
  const match = matchRegistryRecord(hubspotClientName, registry);

  if (match) {
    const engagementCities = engagementTeamCitiesFor(match);
    return {
      registryId: match.id,
      benefactor: match.benefactor,
      homeCity: match.city,
      city: engagementCities[0] ?? registryCityToEngagement(match.city),
      engagementCities,
      status: match.status,
      isPaused: match.status === "pause",
      isGratis: match.status === "gratis",
      isCancelled: match.status === "cancelled",
    };
  }

  return {
    registryId: null,
    benefactor: hubspotClientName,
    homeCity: "Other",
    city: "Other",
    engagementCities: [],
    status: "unknown",
    isPaused: false,
    isGratis: false,
    isCancelled: false,
  };
}

export function engagementCityMatches(
  filter: EngagementCity,
  meta: EngagementClientMeta,
  analyticsCity: string
): boolean {
  if (filter === "all") return true;
  if (meta.registryId && meta.engagementCities.length > 0) {
    return meta.engagementCities.includes(filter);
  }
  const city = meta.registryId ? meta.city : normalizeEngagementCity(analyticsCity);
  return city === filter;
}
