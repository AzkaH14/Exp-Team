import "server-only";
import type {
  HealthReportEnrichment,
  ReportDomainScore,
  ReportMilestone,
} from "./types";
import { getHealthReportOverride } from "./report-overrides";
import {
  careTeamForCity,
  SENIOR_CONSULTANTS,
  WELLNESS_COUNSELLOR,
} from "./care-team";
import {
  buildMedicalSessionNotes,
  isMedicalTicket,
  medicalTicketsToMilestones,
} from "./medical-tickets";
import type { ClientRegistryRecord } from "../types/client-registry";
import type { Ticket } from "../types/ticket";
import type { ClinicalProgressAnalysis } from "./clinical-intelligence";
import { ticketMentionsPerson } from "./tickets-for-client";

function primaryBeneficiary(beneficiary: string, benefactor: string): string {
  const first = beneficiary.split("/")[0]?.trim();
  if (!first || first === "TBC") return benefactor;
  return first;
}

function displaySubjectName(name: string): string {
  const n = name.trim();
  if (/^(mr|mrs|ms|miss|dr)\b/i.test(n)) return n;
  return n;
}

function inferMedicalTrend(sessionCount: number, domains: ReportDomainScore[]): string {
  const needsFocus = domains.filter((d) => d.status === "needs_focus").length;
  const improving = domains.filter((d) => d.status === "improving").length;
  const good = domains.filter((d) => d.status === "good").length;

  if (sessionCount === 0 && domains.length === 0) {
    return "No recorded clinical sessions this period";
  }
  if (needsFocus > good && needsFocus >= 2) {
    return "Mixed progress — several domains need focused work";
  }
  if (improving >= 2 || (good >= 2 && needsFocus <= 1)) {
    return "Positive trajectory";
  }
  if (sessionCount >= 4) return "Steady progress";
  return "Light touch month — continue current plan";
}

function inferFocusFromDomains(domains: ReportDomainScore[]): string[] {
  return domains
    .filter((d) => d.status === "needs_focus" || d.status === "improving")
    .map((d) => {
      if (d.note?.trim()) return d.note.trim();
      if (d.status === "needs_focus") {
        return `${d.label} — structured exercises and monitoring recommended.`;
      }
      return `${d.label} — maintain momentum with continued practice.`;
    });
}

function buildManualMilestones(
  overrideMilestones: ReportMilestone[] | undefined
): ReportMilestone[] {
  return (overrideMilestones ?? []).map((m) => ({
    ...m,
    body: m.body.length > 2000 ? `${m.body.slice(0, 1997)}…` : m.body,
  }));
}

export function enrichFamilyReportWithHealth(
  record: ClientRegistryRecord,
  periodKey: string,
  beneficiaryFocus: string | null,
  monthTickets: Ticket[],
  beneficiaries: string[],
  clinicalAnalysis?: ClinicalProgressAnalysis
): HealthReportEnrichment {
  const override = getHealthReportOverride(record.id, periodKey);
  const team = careTeamForCity(record.city);
  const subject =
    override?.subjectName ??
    (beneficiaryFocus
      ? displaySubjectName(beneficiaryFocus)
      : displaySubjectName(primaryBeneficiary(record.beneficiary, record.benefactor)));

  const medicalTickets = monthTickets.filter(isMedicalTicket);
  const sessions = buildMedicalSessionNotes(
    medicalTickets,
    beneficiaries,
    ticketMentionsPerson
  );
  const ticketMilestones = medicalTicketsToMilestones(
    sessions.filter(
      (s) => !/physio|physiotherap/i.test(`${s.subCategory} ${s.category} ${s.sessionTitle}`)
    )
  );
  const manualMilestones = buildManualMilestones(override?.customMilestones);
  const milestones = [...ticketMilestones, ...manualMilestones].sort((a, b) =>
    a.date.localeCompare(b.date)
  );

  const domainScores = override?.domainScores ?? [];
  const inferredFocus = inferFocusFromDomains(domainScores);
  const analysisFocus = clinicalAnalysis?.recommendedActions ?? [];
  const recommendedFocus =
    override?.recommendedFocus?.length
      ? override.recommendedFocus
      : analysisFocus.length
        ? analysisFocus
        : inferredFocus;

  const trendFromAnalysis = clinicalAnalysis?.trajectoryLabel;

  return {
    subjectName: subject,
    physiotherapist: override?.physiotherapist ?? team.physiotherapist,
    fieldDoctor: override?.fieldDoctor ?? team.fieldDoctor,
    seniorConsultant: override?.seniorConsultant ?? SENIOR_CONSULTANTS,
    wellnessCounsellor: override?.wellnessCounsellor ?? WELLNESS_COUNSELLOR,
    overallTrend:
      override?.overallTrend ??
      trendFromAnalysis ??
      inferMedicalTrend(sessions.length, domainScores),
    domainScores,
    recommendedFocus,
    careSchedule: override?.careSchedule ?? "",
    milestones,
    footerNote:
      override?.footerNote ??
      "Medical progress is compiled from closed physiotherapy, doctor, and wellness tickets. " +
        "Instacare (EMR) will enrich this report when connected.",
  };
}
