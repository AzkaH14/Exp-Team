import "server-only";
import { getSacredRegistry } from "../client-registry/store";
import { canonicalRegistryId } from "../client-registry/registry-id-aliases";
import type { ClientRegistryRecord } from "../types/client-registry";
import type { Ticket } from "../types/ticket";
import { parseBeneficiaryNames, ticketMatchesBeneficiaryFocus, ticketMentionsPerson } from "./tickets-for-client";
import { getReportTicketIndex } from "./ticket-index";
import type {
  FamilyMonthlyReport,
  FamilyReportListItem,
  ReportSection,
  ReportSectionKey,
  ReportSubcategoryGroup,
  ReportTicketRow,
} from "./types";
import {
  REPORT_SECTION_LABELS,
  REPORT_SECTION_ORDER,
} from "./types";
import { enrichFamilyReportWithHealth } from "./health-enrichment";
import { buildFamilyProfileContext } from "./family-profile-context";
import {
  buildMedicalSessionNotes,
  buildPhysiotherapySessionNotes,
  isConciergeTicket,
  isMedicalTicket,
  medicalSectionKey,
} from "./medical-tickets";
import { summarizeTicketForReport } from "./summarize-ticket";
import { analyzeClinicalProgress } from "./clinical-intelligence";
import {
  filterTicketsInPeriod,
  parseReportPeriod,
  type ReportPeriod,
} from "./report-period";

export {
  defaultReportPeriod,
  parseReportPeriod,
  periodInputFromReportPeriod,
  parsePeriodInput,
  appendPeriodToSearchParams,
  type ReportPeriod,
  type ReportPeriodInput,
} from "./report-period";

const MONTH_ABBREV: Record<string, string> = {
  Jan: "01",
  Feb: "02",
  Mar: "03",
  Apr: "04",
  May: "05",
  Jun: "06",
  Jul: "07",
  Aug: "08",
  Sep: "09",
  Oct: "10",
  Nov: "11",
  Dec: "12",
};

const ERRAND_CATEGORIES = new Set([
  "Errand Services/Non-emergency services",
  "Domestic Services",
]);

const EXPERIENCE_CATEGORIES = new Set(["Experience"]);
const TRAVEL_CATEGORIES = new Set(["Travel Services"]);

const COVERAGE_NOTE =
  "Mohsyn concierge services below are from HubSpot tickets. Physiotherapy, doctor visits, and wellness " +
  "sessions will be shared via Instacare (EMR) when connected — contact your care coordinator for clinical detail.";

const MAX_TICKETS_PER_SECTION = 20;
const MAX_DISPLAY_TICKETS = 30;

export function defaultMonthKey(): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function monthKeyToLabel(monthKey: string): string {
  const [year, monthNum] = monthKey.split("-");
  const idx = parseInt(monthNum, 10) - 1;
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  if (idx < 0 || idx > 11 || !year) return monthKey;
  return `${months[idx]} ${year}`;
}

export function ticketMonthKey(ticket: Ticket): string | null {
  const parts = ticket.month.trim().split(/\s+/);
  if (parts.length !== 2) return null;
  const [abbrev, year] = parts;
  const monthNum = MONTH_ABBREV[abbrev];
  if (!monthNum || !/^\d{4}$/.test(year)) return null;
  return `${year}-${monthNum}`;
}

function categorizeTicket(ticket: Ticket): ReportSectionKey {
  if (isMedicalTicket(ticket)) return medicalSectionKey(ticket);
  const cat = ticket.categoryFull;
  if (ERRAND_CATEGORIES.has(cat)) return "errands";
  if (EXPERIENCE_CATEGORIES.has(cat)) return "experience";
  if (TRAVEL_CATEGORIES.has(cat)) return "travel";
  return "other";
}

function ticketToRow(ticket: Ticket, beneficiaries: string[]): ReportTicketRow {
  const hint =
    beneficiaries.find((b) => ticketMentionsPerson(ticket, b)) ?? null;

  return {
    ticketNumber: ticket.ticketNumber,
    date: ticket.closed || ticket.created,
    category: ticket.categoryFull,
    subCategory: ticket.subCategory || "—",
    summary: summarizeTicketForReport(ticket),
    beneficiaryHint: hint,
  };
}

function groupBySubcategory(rows: ReportTicketRow[]): ReportSubcategoryGroup[] {
  const map = new Map<string, ReportTicketRow[]>();
  for (const row of rows) {
    const key = row.subCategory?.trim() && row.subCategory !== "—" ? row.subCategory : "General";
    const list = map.get(key) ?? [];
    list.push(row);
    map.set(key, list);
  }
  return [...map.entries()]
    .map(([subCategory, tickets]) => ({ subCategory, tickets, count: tickets.length }))
    .filter((g) => g.count > 0)
    .sort((a, b) => b.count - a.count);
}

function buildSections(tickets: Ticket[], beneficiaries: string[]): ReportSection[] {
  const grouped = new Map<ReportSectionKey, ReportTicketRow[]>();
  for (const key of REPORT_SECTION_ORDER) {
    grouped.set(key, []);
  }

  for (const ticket of tickets) {
    const key = categorizeTicket(ticket);
    grouped.get(key)!.push(ticketToRow(ticket, beneficiaries));
  }

  return REPORT_SECTION_ORDER.map((key) => {
    const allRows = grouped.get(key) ?? [];
    const truncated =
      allRows.length > MAX_TICKETS_PER_SECTION
        ? allRows.length - MAX_TICKETS_PER_SECTION
        : undefined;
    const rows = truncated ? allRows.slice(0, MAX_TICKETS_PER_SECTION) : allRows;
    return {
      key,
      label: REPORT_SECTION_LABELS[key],
      tickets: rows,
      subcategories: groupBySubcategory(rows),
      count: allRows.length,
      truncated,
    };
  }).filter((section) => section.count > 0);
}

function emptySectionCounts(): Record<ReportSectionKey, number> {
  return {
    healthcare: 0,
    wellbeing: 0,
    errands: 0,
    experience: 0,
    travel: 0,
    other: 0,
  };
}

export function buildFamilyReport(
  registryId: string,
  period: ReportPeriod,
  beneficiaryFocus?: string | null
): FamilyMonthlyReport | null {
  const registry = getSacredRegistry();
  const canonicalId = canonicalRegistryId(registryId);
  const record = registry.find((r) => r.id === canonicalId);
  if (!record) return null;

  const allFamilyTickets =
    getReportTicketIndex().byRegistryId.get(canonicalId) ?? [];
  const familyTickets = filterTicketsInPeriod(allFamilyTickets, period);

  const beneficiaries = parseBeneficiaryNames(record.beneficiary);
  const focus = beneficiaryFocus?.trim() || null;

  const tickets =
    focus
      ? familyTickets.filter((t) => ticketMatchesBeneficiaryFocus(t, focus, beneficiaries, record))
      : familyTickets;

  let displayTickets = tickets;
  let coverageNote = COVERAGE_NOTE;
  if (tickets.length > MAX_DISPLAY_TICKETS) {
    displayTickets = [...tickets]
      .sort((a, b) => {
        const dateA = a.closed || a.created;
        const dateB = b.closed || b.created;
        return dateB.localeCompare(dateA);
      })
      .slice(0, MAX_DISPLAY_TICKETS);
    coverageNote = `${COVERAGE_NOTE} Showing 30 of ${tickets.length} concierge entries.`;
  }

  const sections = buildSections(displayTickets, beneficiaries);
  const medicalSections = sections.filter((s) => s.key === "healthcare" || s.key === "wellbeing");
  const conciergeSections = sections.filter(
    (s) => s.key === "errands" || s.key === "experience" || s.key === "travel" || s.key === "other"
  );

  const medicalSessions = buildMedicalSessionNotes(
    tickets,
    beneficiaries,
    ticketMentionsPerson
  );

  const physioSessions = buildPhysiotherapySessionNotes(
    tickets,
    beneficiaries,
    ticketMentionsPerson
  );

  const clinicalAnalysis = analyzeClinicalProgress(physioSessions, medicalSessions);

  const medicalCount = tickets.filter(isMedicalTicket).length;
  const conciergeCount = tickets.filter(isConciergeTicket).length;

  const bySection = emptySectionCounts();
  for (const section of sections) {
    bySection[section.key] = section.count;
  }

  const profile = buildFamilyProfileContext(record.id);

  return {
    registryId: record.id,
    benefactor: record.benefactor,
    beneficiary: record.beneficiary,
    city: record.city,
    monthKey: period.monthKey ?? period.cacheKey,
    monthLabel: period.label,
    periodMode: period.mode,
    periodStart: period.start.toISOString().slice(0, 10),
    periodEnd: period.end.toISOString().slice(0, 10),
    beneficiaryFocus: focus,
    generatedAt: new Date().toISOString(),
    profile,
    summary: {
      totalTickets: tickets.length,
      medicalCount,
      conciergeCount,
      bySection,
      urgentCount: tickets.filter((t) => t.priority === "urgent").length,
    },
    sections,
    medicalSections,
    conciergeSections,
    medicalSessions,
    physioSessions,
    beneficiaries,
    coverageNote,
    health: enrichFamilyReportWithHealth(
      record,
      period.cacheKey,
      focus,
      tickets,
      beneficiaries,
      clinicalAnalysis
    ),
    clinicalAnalysis,
  };
}

export function buildFamilyMonthlyReport(
  registryId: string,
  monthKey: string,
  beneficiaryFocus?: string | null
): FamilyMonthlyReport | null {
  const period = parseReportPeriod({ month: monthKey });
  if (!period) return null;
  return buildFamilyReport(registryId, period, beneficiaryFocus);
}

export function listFamiliesForReports(period: ReportPeriod): FamilyReportListItem[] {
  const registry = getSacredRegistry();
  const index = getReportTicketIndex();
  const countMap = new Map<string, number>();
  for (const [registryId, tickets] of index.byRegistryId) {
    const n = filterTicketsInPeriod(tickets, period).length;
    if (n > 0) countMap.set(registryId, n);
  }

  return registry
    .map((record: ClientRegistryRecord) => ({
      registryId: record.id,
      benefactor: record.benefactor,
      beneficiary: record.beneficiary,
      city: record.city,
      ticketCount: countMap.get(record.id) ?? 0,
      status: record.status,
    }))
    .filter((f) => f.status === "active" || f.ticketCount > 0)
    .sort((a, b) => {
      if (b.ticketCount !== a.ticketCount) return b.ticketCount - a.ticketCount;
      return a.benefactor.localeCompare(b.benefactor);
    });
}
