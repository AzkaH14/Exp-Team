import "server-only";
import type { EngagementEvent } from "../types/engagement-calendar";

/** HubSpot owner IDs — set via env (run: npm run discover:hubspot-owners) */
function envOwner(key: string): string | undefined {
  const v = process.env[key]?.trim();
  return v || undefined;
}

export function hubSpotOwnerLaiba(): string | undefined {
  return envOwner("HUBSPOT_OWNER_LAIBA");
}

export function hubSpotOwnerWajeeha(): string | undefined {
  return envOwner("HUBSPOT_OWNER_WAJEEHA");
}

export function hubSpotOwnerFarwa(): string | undefined {
  return envOwner("HUBSPOT_OWNER_FARWA");
}

/**
 * Ticket owner by engagement type:
 * - psychologist_call → Dr Farwa
 * - doctor_call → Dr Wajeeha
 * - everything else → Laiba (stays in her bucket until completed)
 */
export function resolveHubSpotTicketOwnerId(
  event: EngagementEvent
): string | undefined {
  switch (event.type) {
    case "psychologist_call":
      return hubSpotOwnerFarwa() ?? hubSpotOwnerLaiba();
    case "doctor_call":
      return hubSpotOwnerWajeeha() ?? hubSpotOwnerLaiba();
    default:
      return hubSpotOwnerLaiba() ?? hubSpotOwnerWajeeha();
  }
}

/** @deprecated use resolveHubSpotTicketOwnerId — kept for create-path clarity */
export function resolveHubSpotEngagementCreateOwnerId(
  event?: EngagementEvent
): string | undefined {
  if (event) return resolveHubSpotTicketOwnerId(event);
  return hubSpotOwnerLaiba() ?? hubSpotOwnerWajeeha();
}

/** Clinical assignee for doctor/psychologist calls only */
export function resolveHubSpotClinicalOwnerId(
  event: EngagementEvent
): string | undefined {
  if (event.type === "psychologist_call") {
    return hubSpotOwnerFarwa() ?? hubSpotOwnerLaiba();
  }
  if (event.type === "doctor_call") {
    return hubSpotOwnerWajeeha() ?? hubSpotOwnerLaiba();
  }
  return hubSpotOwnerLaiba();
}

export function clinicalOwnerDisplayName(event: EngagementEvent): string {
  if (event.type === "psychologist_call") return "Dr Farwa Batool";
  if (event.type === "doctor_call") return "Dr Wajeeha Hassan";
  return "Laiba Malik";
}

/** Whether this event type should leave Laiba's bucket for a clinician */
export function isClinicalEngagementEvent(event: EngagementEvent): boolean {
  return event.type === "doctor_call" || event.type === "psychologist_call";
}

/** Coordinator who scheduled — named in ticket body/notes (Laiba, Seemab, or Labeba). */
export function engagementCoordinatorLabel(event: EngagementEvent): string {
  const who = event.createdBy?.trim() || event.lead?.trim() || "Engagement team";
  const city = event.city?.trim();
  return city ? `${who} (${city})` : who;
}
