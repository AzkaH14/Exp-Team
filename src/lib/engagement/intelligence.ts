import type { EngagementSuggestion } from "../types/engagement";
import type { EngagementSegment } from "../types/engagement";
import {
  getHobbySuggestions,
  getPersonalDateSuggestions,
  getUpcomingUniversalSuggestions,
} from "../client-registry/calendar-suggestions";
import { hubspotClientToRegistryId } from "../client-registry/reconcile";
import { getMergedProfileById } from "../client-registry/merge";
import { buildLastTicketByRegistryId, daysSinceLastTicket } from "./last-activity";

export function generateIntelligenceSuggestions(
  client: string,
  segment: EngagementSegment,
  tickets: number,
  city: string,
  _topServices: string
): EngagementSuggestion[] {
  const suggestions: EngagementSuggestion[] = [];
  const registryId = hubspotClientToRegistryId(client);
  const profile = registryId ? getMergedProfileById(registryId) : undefined;

  suggestions.push(...getUpcomingUniversalSuggestions().slice(0, 2));

  if (profile) {
    suggestions.push(
      ...getPersonalDateSuggestions({
        benefactor: profile.benefactor,
        beneficiary: profile.beneficiary,
        beneficiaryBirthday: profile.resolvedBeneficiaryBirthday,
      })
    );

    suggestions.push(
      ...getHobbySuggestions({
        hobbies: profile.overrides.hobbies ?? profile.enrichment?.hobbies ?? [],
        interests: profile.odoo?.interests ?? profile.enrichment?.interests ?? [],
        indoorOnly: profile.enrichment?.indoorOnly,
        city,
      })
    );

    if (profile.missingFields.length > 0) {
      suggestions.push({
        id: "complete-profile",
        title: "Complete client profile",
        rationale: profile.odoo
          ? `Missing: ${profile.missingFields.slice(0, 3).join(", ")}. Update the family in Odoo or via Client Profiles → Edit.`
          : `Missing: ${profile.missingFields.slice(0, 3).join(", ")}. Update in Client Profiles (Laiba / Labeba / Seemab).`,
        channel: "email",
        priority: "low",
      });
    }

    if (profile.enrichment?.prefersLowTouch) {
      suggestions.push({
        id: "low-touch",
        title: "Low-touch check-in only",
        rationale:
          profile.resolvedEngagementNotes[0] ??
          profile.enrichment?.engagementNotes?.[0] ??
          "Internal profile notes low-touch preference.",
        channel: "whatsapp",
        priority: "low",
      });
    }
  }

  if (segment === "underutilising") {
    const days = daysSinceLastTicket(client, buildLastTicketByRegistryId());
    const inactiveLabel =
      days === null ? "no tickets on record" : `${days} days since last ticket`;
    suggestions.push({
      id: "onboard-wellness",
      title: "Re-engagement outreach",
      rationale: `${client} — ${inactiveLabel}. Check in and offer a wellness call or FSO visit.`,
      channel: "call",
      priority: "high",
    });
  } else if (segment === "top") {
    suggestions.push({
      id: "capacity-review",
      title: "Quarterly capacity & SLA review",
      rationale: `Top account (${tickets} tickets) — align FSO capacity.`,
      channel: "call",
      priority: "high",
    });
  } else {
    suggestions.push({
      id: "engagement-call",
      title: "Monthly engagement check-in",
      rationale: `Mid-tier client (${tickets} tickets) — maintain cadence.`,
      channel: "call",
      priority: "medium",
    });
  }

  const seen = new Set<string>();
  return suggestions
    .filter((s) => {
      if (seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    })
    .slice(0, 6);
}
