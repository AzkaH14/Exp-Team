import "server-only";
import { getLiveTickets } from "../data-source";
import { mapHubSpotTicketToDashboard } from "../integrations/hubspot-sync";
import type { HubSpotDiscoveryRow } from "../types/client-registry";
import { matchRegistryRecord } from "./name-match";
import { getSacredRegistry } from "./store";
import { isExcludedHubSpotContact } from "./hubspot-blocklist";

/** HubSpot benefactor labels on tickets that are not yet in the sacred registry */
export function discoverHubSpotBenefactors(): HubSpotDiscoveryRow[] {
  const registry = getSacredRegistry();
  const counts = new Map<string, { city: string; email: string | null; tickets: number }>();

  for (const t of getLiveTickets()) {
    const key = t.client.trim();
    if (!key) continue;
    if (!counts.has(key)) {
      counts.set(key, { city: t.city, email: t.email, tickets: 0 });
    }
    const row = counts.get(key)!;
    row.tickets += 1;
    if (t.email) row.email = t.email;
    if (t.city && t.city !== "Other") row.city = t.city;
  }

  const discoveries: HubSpotDiscoveryRow[] = [];
  for (const [hubspotName, info] of counts) {
    if (isExcludedHubSpotContact(hubspotName)) continue;
    if (matchRegistryRecord(hubspotName, registry)) continue;
    discoveries.push({
      hubspotName,
      city: info.city,
      email: info.email,
      tickets: info.tickets,
      suggestedBenefactor: hubspotName,
    });
  }

  return discoveries.sort((a, b) => b.tickets - a.tickets);
}

/** Normalize a raw HubSpot ticket row benefactor for discovery previews */
export function previewBenefactorFromHubSpotRow(
  properties: Record<string, string | null>
): string {
  const row = mapHubSpotTicketToDashboard({
    id: "0",
    properties,
  });
  return row.client;
}
