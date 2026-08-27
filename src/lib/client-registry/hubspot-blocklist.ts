import { compactRegistryName, normalizeRegistryName } from "./name-match";
import excludedContactsJson from "@/data/hubspot-excluded-contacts.json";
import type { AnalyticsData } from "../analytics-data";
import type { Ticket } from "../types/ticket";

/** Bump when blocklist changes — invalidates HubSpot session cache */
export const REGISTRY_BLOCKLIST_VERSION = 9;

const EXCLUDED_EXACT_LABELS = new Set(
  (excludedContactsJson.exactLabels ?? []).map((label) => label.trim().toLowerCase())
);

/** HubSpot benefactor labels that must never count as clients (staff, corrupt) */
const BLOCKED_EXACT = new Set(
  [
    "Mohammad",
    "Misha",
    "Syed",
    "Laiba",
    "Labeba",
    "Wasfa",
    "Huzaifa",
    "Aliza",
    "Mahlaqa",
    "Fawwad",
    "testben",
    "Unknown",
  ].map((n) => normalizeRegistryName(n))
);

/** Departed / non-client benefactors — matched on normalized name and HubSpot keys */
const REMOVED_CLIENT_PHRASES = [
  "amna salim",
  "rumina iftikhar",
  "haris siddiqui",
  "fareeha ahmed",
  "shahma zahid",
  "shahma",
  "ashar ahmed",
  "babar khan javed",
  "saira asad",
  "karim ali",
  "wasfa fatima",
  "ifra asad",
  "afrah saleem",
  "saqib mustafa",
  "fizza irshad",
  "fawwad hashmey",
  "misbah javed sheikh",
  "misbah sheikh",
  "misbah javed",
  "mahlaqa kamran",
  "mohsyn ops qa",
  // Staff / internal / non-client HubSpot contacts
  "laiba malik",
  "laila karim",
  "fahd khan",
  "labeba saya",
  "mohsyn official",
  "city owner",
  // aleyasalam removed — blocks legitimate client Aleya Salam (emails still excluded below)
].map((n) => normalizeRegistryName(n));

const REMOVED_HUBSPOT_KEYS = new Set(
  [
    "AsharAhmed",
    "BabarKhanJaved",
    "FareehaAhmed",
    "HarisSiddiqui",
    "RuminaIftikhar",
    "SairaAsad",
    "ShahmaZahid",
    "AmnaSalim",
    "IfraAsad",
    "AfrahSaleem",
    "SaqibMustafa",
    "FizzaIrshad",
    "FIZZAIRSHAD",
    "LaibaMalik",
    "LailaKarim",
    "FahdKhan",
    "LabebaSaya",
    "aleyasalam41@gmail.com",
    "aleyasalam41@msn.com",
  ].map((k) => compactRegistryName(k))
);

function matchesRemovedPhrase(norm: string): boolean {
  for (const phrase of REMOVED_CLIENT_PHRASES) {
    if (norm === phrase || norm.includes(phrase)) return true;
  }
  return false;
}

export function isExcludedHubSpotContact(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return true;

  if (EXCLUDED_EXACT_LABELS.has(trimmed.toLowerCase())) return true;

  // HubSpot rows keyed by email instead of benefactor name
  if (trimmed.includes("@")) return true;

  const rawLower = trimmed.toLowerCase();
  for (const phrase of REMOVED_CLIENT_PHRASES) {
    if (rawLower.includes(phrase)) return true;
  }

  const norm = normalizeRegistryName(trimmed);
  if (!norm) return true;
  if (BLOCKED_EXACT.has(norm)) return true;

  if (matchesRemovedPhrase(norm)) return true;

  const compact = compactRegistryName(trimmed);
  if (REMOVED_HUBSPOT_KEYS.has(compact)) return true;
  for (const phrase of REMOVED_CLIENT_PHRASES) {
    const cp = phrase.replace(/\s+/g, "");
    if (compact.includes(cp)) return true;
  }

  // Single-token truncated benefactor names from HubSpot data entry errors
  const tokens = norm.split(" ").filter(Boolean);
  if (tokens.length === 1 && ["mohammad", "syed", "misha"].includes(tokens[0])) {
    return true;
  }

  return false;
}

/** Remove non-client HubSpot contacts from analytics aggregates */
export function filterAnalyticsData(data: AnalyticsData): AnalyticsData {
  const clients = data.clients.filter((c) => !isExcludedHubSpotContact(c.client));
  const topClients = data.topClients.filter((c) => !isExcludedHubSpotContact(c.client));
  const excludedTicketEstimate = data.clients
    .filter((c) => isExcludedHubSpotContact(c.client))
    .reduce((sum, c) => sum + c.tickets, 0);

  return {
    ...data,
    clients,
    topClients,
    kpis: {
      ...data.kpis,
      uniqueClients: clients.length,
      totalTickets: Math.max(0, data.kpis.totalTickets - excludedTicketEstimate),
    },
  };
}

/** Drop tickets tied to staff / departed / non-client HubSpot labels */
export function filterExcludedTickets(tickets: Ticket[]): Ticket[] {
  return tickets.filter((t) => !isExcludedHubSpotContact(t.client));
}

/** Drop departed clients from sacred registry records (sheet + HubSpot merge) */
export function filterSacredRegistryClients<
  T extends { benefactor: string; aliases?: string[] },
>(clients: T[]): T[] {
  return clients.filter(
    (c) =>
      !isExcludedHubSpotContact(c.benefactor) &&
      !(c.aliases ?? []).some((a) => isExcludedHubSpotContact(a))
  );
}
