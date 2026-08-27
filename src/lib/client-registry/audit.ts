import "server-only";
import { fetchAllHubSpotTickets } from "../integrations/hubspot-sync";
import type { ClientRegistryRecord } from "../types/client-registry";
import { isExcludedHubSpotContact } from "./hubspot-blocklist";
import { matchRegistryRecord } from "./name-match";
import { getSacredRegistry } from "./store";

export interface HubSpotOnlyClient {
  hubspotName: string;
  tickets: number;
  city: string;
  email: string | null;
}

export interface RegistryOnlyClient {
  id: string;
  benefactor: string;
  city: string;
  status: ClientRegistryRecord["status"];
}

export interface RegistryAuditResult {
  hubspotOnly: HubSpotOnlyClient[];
  registryOnly: RegistryOnlyClient[];
  paused: Array<{
    id: string;
    benefactor: string;
    city: string;
    hubspotTickets: number;
  }>;
}

/** Compare raw HubSpot benefactor names (pre-registry filter) to sacred registry */
export async function auditHubSpotVsRegistry(
  hubspotTickets = fetchAllHubSpotTickets()
): Promise<RegistryAuditResult> {
  const registry = getSacredRegistry();
  const tickets = await hubspotTickets;

  const hubspotCounts = new Map<
    string,
    { raw: string; tickets: number; city: string; email: string | null }
  >();

  for (const t of tickets) {
    const display = t.client.trim();
    if (!display) continue;
    if (!hubspotCounts.has(display)) {
      hubspotCounts.set(display, {
        raw: display,
        tickets: 0,
        city: t.city,
        email: t.email,
      });
    }
    const row = hubspotCounts.get(display)!;
    row.tickets += 1;
    if (t.email) row.email = t.email;
    if (t.city && t.city !== "Other") row.city = t.city;
  }

  const hubspotOnly: HubSpotOnlyClient[] = [];
  const matchedRegistryIds = new Set<string>();

  for (const [, info] of hubspotCounts) {
    if (isExcludedHubSpotContact(info.raw)) continue;
    const match = matchRegistryRecord(info.raw, registry);
    if (match) {
      matchedRegistryIds.add(match.id);
      continue;
    }
    hubspotOnly.push({
      hubspotName: info.raw,
      tickets: info.tickets,
      city: info.city,
      email: info.email,
    });
  }

  hubspotOnly.sort((a, b) => b.tickets - a.tickets);

  const registryOnly: RegistryOnlyClient[] = [];
  const paused: RegistryAuditResult["paused"] = [];

  for (const r of registry) {
    if (r.status === "pause") {
      paused.push({
        id: r.id,
        benefactor: r.benefactor,
        city: r.city,
        hubspotTickets: 0,
      });
    }
    if (matchedRegistryIds.has(r.id)) continue;
    if (r.status !== "active") continue;
    registryOnly.push({
      id: r.id,
      benefactor: r.benefactor,
      city: r.city,
      status: r.status,
    });
  }

  for (const p of paused) {
    let tickets = 0;
    for (const [, info] of hubspotCounts) {
      if (matchRegistryRecord(info.raw, registry)?.id === p.id) {
        tickets += info.tickets;
      }
    }
    p.hubspotTickets = tickets;
  }

  registryOnly.sort((a, b) => a.benefactor.localeCompare(b.benefactor));

  return { hubspotOnly, registryOnly, paused };
}
