import { matchRegistryRecord, namesMatch, normalizeRegistryName } from "../client-registry/name-match";
import type { ClientRegistryRecord } from "../types/client-registry";
import type { Ticket } from "../types/ticket";
import { isPhysiotherapyTicket } from "./medical-tickets";

const BENEFICIARY_SKIP = new Set(["tbc", "—", "-", "n/a", "na", "unknown", ""]);

/** Split registry beneficiary field into individual names */
export function parseBeneficiaryNames(beneficiary: string): string[] {
  const raw = beneficiary.trim();
  if (!raw || BENEFICIARY_SKIP.has(raw.toLowerCase())) return [];

  const parts = raw
    .split(/\s*(?:\/|&|,|;|\band\b)\s*/i)
    .map((p) => p.trim())
    .filter(Boolean);

  return [...new Set(parts)];
}

export function getTicketsForRegistryRecord(
  record: ClientRegistryRecord,
  tickets: Ticket[],
  registry?: ClientRegistryRecord[]
): Ticket[] {
  const pool = registry ?? [record];
  return tickets.filter((t) => matchRegistryRecord(t.client, pool)?.id === record.id);
}

/** Whether ticket text references a specific family member */
export function ticketMentionsPerson(ticket: Ticket, personName: string): boolean {
  const person = personName.trim();
  if (!person) return false;

  const haystack = [ticket.name, ticket.description, ticket.subCategory, ticket.client]
    .filter(Boolean)
    .join(" ");

  if (namesMatch(haystack, person)) return true;

  const personNorm = normalizeRegistryName(person)
    .replace(/\bshahnaz\b/g, "shehnaz")
    .replace(/\bshehnaz\b/g, "shehnaz");
  const tokens = personNorm.split(" ").filter((t) => t.length > 2);
  if (!tokens.length) return false;

  const hayNorm = normalizeRegistryName(haystack)
    .replace(/\bshahnaz\b/g, "shehnaz")
    .replace(/\bshehnaz\b/g, "shehnaz");
  let hits = 0;
  for (const token of tokens) {
    if (hayNorm.includes(token)) hits++;
  }
  return hits >= Math.min(2, tokens.length);
}

/** Beneficiary filter for family reports — physio is billed to benefactor but is for the parent */
export function ticketMatchesBeneficiaryFocus(
  ticket: Ticket,
  focus: string,
  beneficiaries: string[],
  record: ClientRegistryRecord
): boolean {
  const trimmed = focus.trim();
  if (!trimmed) return true;

  if (ticketMentionsPerson(ticket, trimmed)) return true;

  const focusIsFamilyMember = beneficiaries.some((b) => namesMatch(b, trimmed));
  if (!focusIsFamilyMember) return ticketMentionsPerson(ticket, trimmed);

  // Cognitive / physio sessions (Dr Isha) are created on the benefactor ticket without the patient name
  if (isPhysiotherapyTicket(ticket)) return true;

  return beneficiaries.some(
    (b) => namesMatch(b, trimmed) && ticketMentionsPerson(ticket, b)
  );
}
