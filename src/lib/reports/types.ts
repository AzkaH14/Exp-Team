import type { ClinicalProgressAnalysis } from "./clinical-intelligence";

export type ReportSectionKey =
  | "healthcare"
  | "wellbeing"
  | "errands"
  | "experience"
  | "travel"
  | "other";

export const REPORT_SECTION_ORDER: ReportSectionKey[] = [
  "healthcare",
  "wellbeing",
  "errands",
  "experience",
  "travel",
  "other",
];

export const REPORT_SECTION_LABELS: Record<ReportSectionKey, string> = {
  healthcare: "Healthcare & medical",
  wellbeing: "Wellbeing & psychology",
  errands: "Errands & domestic support",
  experience: "Experiences & outings",
  travel: "Travel coordination",
  other: "Other services",
};

export interface ReportTicketRow {
  ticketNumber: string;
  date: string;
  category: string;
  subCategory: string;
  summary: string;
  beneficiaryHint: string | null;
}

export interface ReportSubcategoryGroup {
  subCategory: string;
  tickets: ReportTicketRow[];
  count: number;
}

export interface ReportSection {
  key: ReportSectionKey;
  label: string;
  tickets: ReportTicketRow[];
  count: number;
  /** Grouped by sub-service — only non-empty groups */
  subcategories: ReportSubcategoryGroup[];
  /** Tickets omitted from display when section exceeds cap */
  truncated?: number;
}

export interface FamilyMonthlyReport {
  registryId: string;
  benefactor: string;
  beneficiary: string;
  city: string;
  monthKey: string;
  monthLabel: string;
  periodMode: "month" | "week" | "range";
  periodStart: string;
  periodEnd: string;
  beneficiaryFocus: string | null;
  generatedAt: string;
  profile: FamilyProfileContext;
  summary: {
    totalTickets: number;
    medicalCount: number;
    conciergeCount: number;
    bySection: Record<ReportSectionKey, number>;
    urgentCount: number;
  };
  /** @deprecated use medicalSections + conciergeSections */
  sections: ReportSection[];
  medicalSections: ReportSection[];
  conciergeSections: ReportSection[];
  medicalSessions: MedicalSessionNote[];
  /** Closed physiotherapy tickets for this family only */
  physioSessions: MedicalSessionNote[];
  beneficiaries: string[];
  coverageNote: string;
  health?: HealthReportEnrichment;
  clinicalAnalysis?: ClinicalProgressAnalysis;
}

export interface FamilyProfileContext {
  registryId: string;
  benefactor: string;
  beneficiary: string;
  city: string;
  serviceTier: string;
  status: string;
  hobbies: string[];
  interests: string[];
  engagementNotes: string[];
  medicalHighlights: string[];
  generalOverview: string | null;
  prefersLowTouch: boolean;
  indoorOnly: boolean;
  biraBeneficiaries: Array<{
    name: string;
    birthday: string | null;
    birthdayLabel: string | null;
  }>;
  biraSourceFile: string | null;
  biraUrl: string | null;
  profileCompleteness: number;
  missingFields: string[];
  hasInternalProfile: boolean;
  hasBira: boolean;
}

export interface MedicalSessionNote {
  date: string;
  dateLabel: string;
  service: string;
  category: string;
  subCategory: string;
  sessionTitle: string;
  practitioner: string | null;
  notes: string;
  ticketNumber: string;
  beneficiaryHint: string | null;
}

export interface PhysioSessionLogEntry extends MedicalSessionNote {
  registryId: string;
  benefactor: string;
  beneficiary: string;
  city: string;
  weekKey: string;
}

export interface FamilyReportListItem {
  registryId: string;
  benefactor: string;
  beneficiary: string;
  city: string;
  ticketCount: number;
  status: string;
}

export type ReportDomainStatus = "good" | "improving" | "needs_focus";

export interface ReportDomainScore {
  label: string;
  status: ReportDomainStatus;
  note?: string;
}

export interface ReportMilestone {
  date: string;
  dateLabel: string;
  title: string;
  body: string;
  source: "ticket" | "manual";
  ticketId?: string;
}

export interface HealthReportEnrichment {
  subjectName: string;
  physiotherapist: string;
  fieldDoctor: string;
  seniorConsultant: string;
  wellnessCounsellor: string;
  overallTrend: string;
  domainScores: ReportDomainScore[];
  recommendedFocus: string[];
  careSchedule: string;
  milestones: ReportMilestone[];
  footerNote: string;
}

export interface HealthReportOverride {
  subjectName?: string;
  physiotherapist?: string;
  fieldDoctor?: string;
  seniorConsultant?: string;
  wellnessCounsellor?: string;
  overallTrend?: string;
  domainScores?: ReportDomainScore[];
  recommendedFocus?: string[];
  careSchedule?: string;
  customMilestones?: ReportMilestone[];
  footerNote?: string;
  updatedAt?: string;
  updatedBy?: string;
}

export const DOMAIN_STATUS_LABELS: Record<ReportDomainStatus, string> = {
  good: "Good (70%+)",
  improving: "Improving / Fair (40–69%)",
  needs_focus: "Needs focus (<40%)",
};
