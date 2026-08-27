export type ClientServiceTier = "premium" | "premium_gratis" | "pause" | "potential_pause";
export type ClientRegistryStatus = "active" | "pause" | "potential_pause" | "gratis" | "cancelled";

export interface ClientRegistryRecord {
  id: string;
  benefactor: string;
  beneficiary: string;
  city: "Islamabad" | "Karachi" | "Lahore" | "Lodhran" | "Gujranwala" | "Faisalabad" | "Other";
  signupDate: string | null;
  serviceTier: ClientServiceTier;
  status: ClientRegistryStatus;
  country: string | null;
  linkedin: string | null;
  biraUrl: string | null;
  aliases: string[];
  /** Optional static benefactor emails to improve HubSpot contact matching. */
  contactEmails?: string[];
  source: "sacred";
  /** When set, client appears on engagement calendar for each listed city (e.g. dual-city families) */
  engagementCities?: ClientRegistryRecord["city"][];
}

export interface ClientEnrichment {
  benefactorId: string;
  hobbies: string[];
  interests: string[];
  engagementNotes: string[];
  medicalHighlights?: string[];
  generalOverview?: string;
  beneficiaryBirthday: string | null;
  benefactorBirthday: string | null;
  anniversary: string | null;
  prefersLowTouch: boolean;
  indoorOnly: boolean;
  citySource?: string;
  sourceDoc?: string;
  source: "internal_doc";
}

export interface HubSpotBirthdayRecord {
  id: string;
  benefactor: string;
  beneficiary: string;
  hubspotKey?: string;
  benefactorBirthday: string | null;
  beneficiaryBirthday: string | null;
  beneficiaries: Array<{
    name: string;
    birthday: string | null;
    relationship?: string | null;
  }>;
}

export interface HubSpotNoteEntry {
  id: string;
  body: string;
  createdAt: string | null;
  /** CRM note vs meeting follow-up captured in HubSpot after a visit/call */
  source?: "note" | "meeting";
  title?: string | null;
}

export interface HubSpotNotesRecord {
  id: string;
  benefactor: string;
  hubspotKey: string;
  /** Beneficiary names attached to this family for profile display */
  beneficiaryNames?: string[];
  notes: HubSpotNoteEntry[];
}

export interface ClientProfileOverrides {
  benefactorBirthday?: string | null;
  beneficiaryBirthday?: string | null;
  anniversary?: string | null;
  hobbies?: string[];
  interests?: string[];
  engagementNotes?: string;
  beneficiaryName?: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface MergedClientProfile extends ClientRegistryRecord {
  slug: string;
  enrichment: ClientEnrichment | null;
  riskAssessment: HubSpotBirthdayRecord | null;
  hubspot: HubSpotBirthdayRecord | null;
  hubspotNotes: HubSpotNotesRecord | null;
  overrides: ClientProfileOverrides;
  hubspotTicketCount: number;
  hubspotMatchedAs: string | null;
  profileCompleteness: number;
  missingFields: string[];
  /** Resolved birthdays (override → internal doc → HubSpot) */
  resolvedBenefactorBirthday: string | null;
  resolvedBeneficiaryBirthday: string | null;
  /** Internal doc + HubSpot profile notes (deduped) */
  resolvedEngagementNotes: string[];
}

/** Slim row for Client Profiles table — avoids shipping full note bodies */
export interface ClientProfileListItem
  extends Omit<
    MergedClientProfile,
    "hubspotNotes" | "resolvedEngagementNotes" | "enrichment"
  > {
  hubspotNotes: {
    beneficiaryNames?: string[];
    noteCount: number;
    meetingCount: number;
  } | null;
  enrichmentNoteCount: number;
  enrichment: Omit<
    ClientEnrichment,
    "engagementNotes" | "medicalHighlights" | "generalOverview"
  > | null;
  resolvedEngagementNotes: [];
}

export type HubSpotReconcileStatus =
  | "matched"
  | "hubspot_only"
  | "registry_only"
  | "name_mismatch";

export interface ClientReconcileRow {
  registryId: string | null;
  benefactor: string;
  beneficiary: string | null;
  city: string | null;
  hubspotName: string | null;
  hubspotTickets: number;
  status: HubSpotReconcileStatus;
  isTestSuspect: boolean;
  notes: string;
}

export interface ClientRegistrySummary {
  sacredTotal: number;
  sacredActive: number;
  sacredPause: number;
  sacredGratis: number;
  sacredCancelled: number;
  hubspotUniqueClients: number;
  matched: number;
  hubspotOnly: number;
  registryOnly: number;
  testSuspects: number;
}

export interface HubSpotDiscoveryRow {
  hubspotName: string;
  city: string;
  email: string | null;
  tickets: number;
  suggestedBenefactor: string;
}
