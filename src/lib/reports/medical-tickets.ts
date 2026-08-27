import type { Ticket } from "../types/ticket";
import type { MedicalSessionNote, ReportMilestone, ReportSectionKey } from "./types";
import { formatReportDate, parseTicketDate } from "./ticket-match";
import {
  extractMedicalSessionNote,
  extractPatientFromTicketTitle,
  extractPhysiotherapySessionNote,
  extractPractitionerFromTicket,
  summarizeTicketForReport,
} from "./summarize-ticket";

const MEDICAL_CATEGORIES = new Set([
  "Healthcare Services",
  "Medical Errands (non-emergency)",
  "Emergency Services",
  "Psychologist Call",
]);

export function isPhysiotherapyTicket(ticket: Ticket): boolean {
  const blob = `${ticket.subCategory} ${ticket.categoryFull} ${ticket.name} ${ticket.description ?? ""}`.toLowerCase();
  return /physio|physiotherap/.test(blob);
}

export function isMedicalTicket(ticket: Ticket): boolean {
  return MEDICAL_CATEGORIES.has(ticket.categoryFull);
}

export function isConciergeTicket(ticket: Ticket): boolean {
  return !isMedicalTicket(ticket);
}

export function medicalSectionKey(ticket: Ticket): ReportSectionKey {
  if (ticket.categoryFull === "Psychologist Call") return "wellbeing";
  return "healthcare";
}

function mapTicketToSessionNote(
  ticket: Ticket,
  beneficiaries: string[],
  ticketMentionsPerson: (t: Ticket, name: string) => boolean,
  noteExtractor: (t: Ticket) => string
): MedicalSessionNote {
  const d = parseTicketDate(ticket.closed) ?? parseTicketDate(ticket.created);
  const beneficiaryHint =
    beneficiaries.find((b) => ticketMentionsPerson(ticket, b)) ??
    extractPatientFromTicketTitle(ticket);

  const notes = noteExtractor(ticket);
  const practitioner = extractPractitionerFromTicket(ticket);

  return {
    date: ticket.closed || ticket.created,
    dateLabel: d ? formatReportDate(d) : ticket.closed || ticket.created,
    service: summarizeTicketForReport(ticket),
    category: ticket.categoryFull,
    subCategory: ticket.subCategory,
    sessionTitle: ticket.name?.trim() || summarizeTicketForReport(ticket),
    practitioner,
    notes: notes || summarizeTicketForReport(ticket),
    ticketNumber: ticket.ticketNumber,
    beneficiaryHint,
  };
}

function sortMedicalTickets(tickets: Ticket[]): Ticket[] {
  return [...tickets].sort((a, b) => {
    const da = parseTicketDate(a.closed) ?? parseTicketDate(a.created);
    const db = parseTicketDate(b.closed) ?? parseTicketDate(b.created);
    return (da?.getTime() ?? 0) - (db?.getTime() ?? 0);
  });
}

export function buildMedicalSessionNotes(
  tickets: Ticket[],
  beneficiaries: string[],
  ticketMentionsPerson: (t: Ticket, name: string) => boolean
): MedicalSessionNote[] {
  const medical = sortMedicalTickets(tickets.filter(isMedicalTicket));

  return medical.map((ticket) =>
    mapTicketToSessionNote(
      ticket,
      beneficiaries,
      ticketMentionsPerson,
      isPhysiotherapyTicket(ticket) ? extractPhysiotherapySessionNote : extractMedicalSessionNote
    )
  );
}

export function buildPhysiotherapySessionNotes(
  tickets: Ticket[],
  beneficiaries: string[],
  ticketMentionsPerson: (t: Ticket, name: string) => boolean
): MedicalSessionNote[] {
  const physio = sortMedicalTickets(tickets.filter(isPhysiotherapyTicket));

  return physio.map((ticket) =>
    mapTicketToSessionNote(
      ticket,
      beneficiaries,
      ticketMentionsPerson,
      extractPhysiotherapySessionNote
    )
  );
}

export function medicalTicketsToMilestones(sessions: MedicalSessionNote[]): ReportMilestone[] {
  const seen = new Set<string>();

  return sessions
    .filter((s) => s.notes.trim().length > 0)
    .filter((s) => {
      if (seen.has(s.ticketNumber)) return false;
      seen.add(s.ticketNumber);
      return true;
    })
    .map((s) => ({
      date: s.date,
      dateLabel: s.dateLabel,
      title: s.sessionTitle || s.service,
      body: s.notes,
      source: "ticket" as const,
      ticketId: s.ticketNumber,
    }));
}
