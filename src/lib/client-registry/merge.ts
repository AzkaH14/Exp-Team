import "server-only";
import type { AnalyticsClient } from "../analytics-data";
import { getAnalyticsData } from "../analytics-data";
import type {
  ClientProfileListItem,
  MergedClientProfile,
} from "../types/client-registry";
import { getHubSpotBirthdayForClient, getHubSpotBirthdaysVersion } from "./hubspot-birthdays";
import { getHubSpotNotesForClient, getHubSpotNotesVersion } from "./hubspot-notes";
import { mergeEngagementNotes } from "../integrations/hubspot-notes-sync";
import { canonicalRegistryId, legacyRegistryId } from "./registry-id-aliases";
import { getRiskAssessmentForClient } from "./risk-assessment";
import { matchRegistryRecord, slugFromBenefactor } from "./name-match";
import { getEnrichmentMap, getOverrides, getRegistryVersion, getSacredRegistry } from "./store";

/** Profile completeness tracks beneficiary (parent) details only — not benefactor */
const REQUIRED_FIELDS = ["beneficiaryBirthday"] as const;

function resolveField(
  field: "beneficiaryBirthday" | "benefactorBirthday" | "anniversary",
  enrichment: MergedClientProfile["enrichment"],
  overrides: MergedClientProfile["overrides"],
  riskAssessment: MergedClientProfile["riskAssessment"],
  hubspot: MergedClientProfile["hubspot"]
): string | null {
  const ovr = overrides[field];
  if (ovr) return ovr;
  const enr = enrichment?.[field];
  if (enr) return enr;
  if (riskAssessment) {
    if (field === "benefactorBirthday" && riskAssessment.benefactorBirthday) {
      return riskAssessment.benefactorBirthday;
    }
    if (field === "beneficiaryBirthday" && riskAssessment.beneficiaryBirthday) {
      return riskAssessment.beneficiaryBirthday;
    }
  }
  if (!hubspot) return null;
  if (field === "benefactorBirthday") return hubspot.benefactorBirthday;
  if (field === "beneficiaryBirthday") return hubspot.beneficiaryBirthday;
  return null;
}

function computeCompleteness(
  enrichment: MergedClientProfile["enrichment"],
  overrides: MergedClientProfile["overrides"],
  riskAssessment: MergedClientProfile["riskAssessment"],
  hubspot: MergedClientProfile["hubspot"]
): { pct: number; missing: string[] } {
  const missing: string[] = [];
  for (const f of REQUIRED_FIELDS) {
    if (!resolveField(f, enrichment, overrides, riskAssessment, hubspot)) {
      missing.push("Beneficiary birthday");
    }
  }

  const pct = Math.round(
    ((REQUIRED_FIELDS.length - missing.length) / REQUIRED_FIELDS.length) * 100
  );
  return { pct, missing };
}

function buildHubspotTicketIndex(
  registry: ReturnType<typeof getSacredRegistry>,
  hubspotClients: AnalyticsClient[]
): Map<string, { count: number; matchedAs: string | null }> {
  const index = new Map<string, { count: number; matchedAs: string | null }>();
  for (const r of registry) {
    index.set(r.id, { count: 0, matchedAs: null });
  }
  for (const hs of hubspotClients) {
    const match = matchRegistryRecord(hs.client, registry);
    if (!match) continue;
    const row = index.get(match.id)!;
    row.count += hs.tickets;
    if (!row.matchedAs) row.matchedAs = hs.client;
  }
  return index;
}

let profilesCache: { version: string; profiles: MergedClientProfile[] } | null = null;
let listCache: { version: string; rows: ClientProfileListItem[] } | null = null;

function buildMergedClientProfiles(): MergedClientProfile[] {
  const registry = getSacredRegistry();
  const enrichmentMap = getEnrichmentMap();
  const overrides = getOverrides();
  const hubspotClients = getAnalyticsData().clients;
  const ticketIndex = buildHubspotTicketIndex(registry, hubspotClients);

  const profiles: MergedClientProfile[] = registry.map((r) => {
    const hs = ticketIndex.get(r.id) ?? { count: 0, matchedAs: null };

    const lookupId = legacyRegistryId(r.id);
    const enrichment = enrichmentMap.get(r.id) ?? enrichmentMap.get(lookupId) ?? null;
    const riskAssessment =
      getRiskAssessmentForClient(r.id) ?? getRiskAssessmentForClient(lookupId) ?? null;
    const hubspot = getHubSpotBirthdayForClient(r.id) ?? null;
    const hubspotNotes = getHubSpotNotesForClient(r.id) ?? null;
    const ovr = overrides[r.id] ?? {};
    const { pct, missing } = computeCompleteness(
      enrichment,
      ovr,
      riskAssessment,
      hubspot
    );

    return {
      ...r,
      beneficiary: ovr.beneficiaryName?.trim() || r.beneficiary,
      slug: slugFromBenefactor(r.benefactor),
      enrichment,
      riskAssessment,
      hubspot,
      hubspotNotes,
      overrides: ovr,
      hubspotTicketCount: hs.count,
      hubspotMatchedAs: hs.matchedAs,
      profileCompleteness: pct,
      missingFields: missing,
      resolvedBenefactorBirthday: resolveField(
        "benefactorBirthday",
        enrichment,
        ovr,
        riskAssessment,
        hubspot
      ),
      resolvedBeneficiaryBirthday: resolveField(
        "beneficiaryBirthday",
        enrichment,
        ovr,
        riskAssessment,
        hubspot
      ),
      resolvedEngagementNotes: mergeEngagementNotes(
        enrichment?.engagementNotes ?? [],
        hubspotNotes?.notes ?? [],
        ovr.engagementNotes
      ),
    };
  });

  return profiles.sort((a, b) => a.benefactor.localeCompare(b.benefactor));
}

function toProfileListItem(p: MergedClientProfile): ClientProfileListItem {
  const notes = p.hubspotNotes?.notes ?? [];
  return {
    ...p,
    hubspotNotes: p.hubspotNotes
      ? {
          beneficiaryNames: p.hubspotNotes.beneficiaryNames,
          noteCount: notes.length,
          meetingCount: notes.filter((n) => n.source === "meeting").length,
        }
      : null,
    enrichmentNoteCount: p.enrichment?.engagementNotes.length ?? 0,
    enrichment: p.enrichment
      ? {
          benefactorId: p.enrichment.benefactorId,
          hobbies: p.enrichment.hobbies,
          interests: p.enrichment.interests,
          beneficiaryBirthday: p.enrichment.beneficiaryBirthday,
          benefactorBirthday: p.enrichment.benefactorBirthday,
          anniversary: p.enrichment.anniversary,
          prefersLowTouch: p.enrichment.prefersLowTouch,
          indoorOnly: p.enrichment.indoorOnly,
          citySource: p.enrichment.citySource,
          sourceDoc: p.enrichment.sourceDoc,
          source: p.enrichment.source,
        }
      : null,
    resolvedEngagementNotes: [],
  };
}

export function getMergedClientProfiles(): MergedClientProfile[] {
  const version = `${getRegistryVersion()}:bd:${getHubSpotBirthdaysVersion()}:hn:${getHubSpotNotesVersion()}`;
  if (profilesCache?.version === version) {
    return profilesCache.profiles;
  }
  const profiles = buildMergedClientProfiles();
  profilesCache = { version, profiles };
  listCache = null;
  return profiles;
}

/** Profiles table payload — strips full HubSpot/doc note bodies */
export function getClientProfileListItems(): ClientProfileListItem[] {
  const version = `${getRegistryVersion()}:bd:${getHubSpotBirthdaysVersion()}:hn:${getHubSpotNotesVersion()}`;
  if (listCache?.version === version) return listCache.rows;
  const rows = getMergedClientProfiles().map(toProfileListItem);
  listCache = { version, rows };
  return rows;
}

export function invalidateMergedClientProfilesCache(): void {
  profilesCache = null;
  listCache = null;
}

export function getMergedProfileById(id: string): MergedClientProfile | undefined {
  const canonical = canonicalRegistryId(id);
  return getMergedClientProfiles().find((p) => p.id === canonical);
}
