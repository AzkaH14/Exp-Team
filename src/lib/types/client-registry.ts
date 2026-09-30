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
  /** "odoo" = built from Odoo res.partner (Benefactor tag); "sacred" = legacy Google Sheet. */
  source: "sacred" | "odoo";
  /** When set, client appears on engagement calendar for each listed city (e.g. dual-city families) */
  engagementCities?: ClientRegistryRecord["city"][];
  /** Odoo res.partner id of the benefactor contact. */
  odooPartnerId?: number;
  /** Business client code from Odoo x_benefactor_id (ISB-1001 / KHI-3001 / LHR-2001). */
  benefactorCode?: string | null;
}

/** One relative recorded on the benefactor's Odoo contact (prodo.partner.family.relation). */
export interface OdooFamilyMember {
  partnerId: number;
  name: string;
  /** The member's role relative to the benefactor ("Father", "Mother", …). */
  relationship: string;
  /** res.partner x_studio_date_of_birth (YYYY-MM-DD) — may carry a placeholder year. */
  birthday: string | null;
  isBeneficiary: boolean;
}

/** A heading + body block parsed from the Odoo "Family Overview" (res.partner.comment). */
export interface OdooOverviewSection {
  heading: string;
  body: string;
}

/** Staff note posted in the chatter of the benefactor's Odoo contact. */
export interface OdooChatterNote {
  id: number;
  body: string;
  createdAt: string | null;
  author: string | null;
}

/** Everything the portal shows about a family, read from Odoo. */
export interface OdooFamilyProfile {
  registryId: string;
  partnerId: number;
  benefactorCode: string | null;
  benefactor: string;
  benefactorBirthday: string | null;
  members: OdooFamilyMember[];
  overviewSections: OdooOverviewSection[];
  /** From the "Hobbies & Interests" section of the Family Overview, when present. */
  interests: string[];
  notes: OdooChatterNote[];
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
  /** Odoo family data (members, Family Overview, chatter). Null in legacy sheet mode. */
  odoo: OdooFamilyProfile | null;
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
    "hubspotNotes" | "resolvedEngagementNotes" | "enrichment" | "odoo"
  > {
  /** Slim Odoo summary — full overview/notes load via GET /api/client-registry/[id]. */
  odoo: {
    partnerId: number;
    benefactorCode: string | null;
    members: OdooFamilyMember[];
    noteCount: number;
    hasOverview: boolean;
  } | null;
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
