import type { EngagementCity } from "../types/engagement";

export const CITY_LEADS: Record<Exclude<EngagementCity, "all">, string> = {
  Islamabad: "Laiba",
  Karachi: "Labeba",
  Lahore: "Seemab",
};

export function getCityLead(city: string): string {
  const key = city as Exclude<EngagementCity, "all">;
  return CITY_LEADS[key] ?? "Team Lead";
}

export const ENGAGEMENT_CITIES: Exclude<EngagementCity, "all">[] = [
  "Islamabad",
  "Karachi",
  "Lahore",
];
