import type { Ticket } from "../types/ticket";
import {
  extractClinicalNarrative,
  stripEmptyHubSpotFormFields,
  isMostlyEmptyHubSpotForm,
} from "../hubspot-description";
import { getTicketInsightNotes } from "../ticket-insight-notes";
import { rankClinicalNotes } from "./clinical-note-ranking";

const MAX_SUMMARY = 72;
const MAX_CLINICAL_NOTE = 4000;

/** Strip HubSpot noise and keep a one-line service label for family reports */
export function summarizeTicketForReport(ticket: Ticket): string {
  const sub = rawField(ticket.subCategory);
  const name = rawField(ticket.name);
  const category = rawField(ticket.categoryFull);
  const desc = cleanFieldSingleLine(ticket.description);

  if (sub && !isGenericLabel(sub) && !isMostlyEmptyHubSpotForm(sub)) {
    return trimSummary(sub);
  }
  if (name && !isGenericLabel(name) && !isMostlyEmptyHubSpotForm(name)) {
    return trimSummary(stripEmptyHubSpotFormFields(name).replace(/\s+/g, " ").trim());
  }
  if (desc && !isGenericLabel(desc) && !isMostlyEmptyHubSpotForm(desc)) {
    return trimSummary(firstSentence(desc));
  }

  return trimSummary(category || "Concierge service");
}

/** Fuller clinical note from closed medical/physio/doctor tickets */
export function extractMedicalSessionNote(ticket: Ticket): string {
  return buildClinicalSessionNotesText(ticket);
}

/** Physio tickets often carry session detail in the subject line as well as the body */
export function extractPhysiotherapySessionNote(ticket: Ticket): string {
  return buildClinicalSessionNotesText(ticket, { preferTitle: true });
}

export function extractPractitionerFromTicket(ticket: Ticket): string | null {
  const blob = [ticket.description, ticket.name, ticket.subCategory].filter(Boolean).join("\n");
  return matchPractitioner(blob);
}

export function extractPatientFromTicketTitle(ticket: Ticket): string | null {
  const name = rawField(ticket.name);
  if (!name) return null;

  const afterDash = name.split(/\s*[-–—]\s*/);
  if (afterDash.length >= 2) {
    const tail = afterDash.slice(1).join(" - ").trim();
    if (tail && !/^is[bl]$/i.test(tail) && !/^lhr$|^khi$/i.test(tail)) {
      const patient = afterDash[1]?.trim();
      if (patient && patient.length > 2 && !/^dr\b/i.test(patient)) {
        return patient.replace(/\s*-\s*(ISB|ISL|LHR|KHI)$/i, "").trim() || null;
      }
    }
  }

  const msMatch = name.match(/\b(?:Ms\.?|Mr\.?|Mrs\.?)\s+([A-Za-z][\w\s.'-]{1,40})/i);
  if (msMatch?.[0]) return msMatch[0].trim();

  return null;
}

const LOW_VALUE_INSIGHT_PATTERN =
  /^(?:finance (?:has been |group has been )?updated\.?|shared (?:the )?details with (?:the )?finance(?: team)?\.?|session (?:was )?completed\.?|visit (?:was )?completed\.?|ticket has been dropped.*)$/i;

function prioritizeInsightNotes(notes: string[]): string[] {
  return rankClinicalNotes(notes).filter(
    (n) => !LOW_VALUE_INSIGHT_PATTERN.test(n.replace(/\s+/g, " ").trim())
  );
}

function buildClinicalSessionNotesText(
  ticket: Ticket,
  opts?: { preferTitle?: boolean }
): string {
  const rawDesc = ticket.description ?? "";
  const narrative = extractClinicalNarrative(rawDesc);
  const name = cleanFieldSingleLine(ticket.name);
  const sub = cleanFieldSingleLine(ticket.subCategory);
  const insightNotes = prioritizeInsightNotes(
    [
      ...(ticket.hubspotFieldNotes ?? []),
      ...(ticket.insightNotes ?? getTicketInsightNotes(ticket.id)),
    ].filter((n) => n.trim().length > 0)
  );

  const parts: string[] = [];

  for (const note of insightNotes) {
    const cleaned = note.trim();
    if (!cleaned) continue;
    if (parts.some((p) => p.toLowerCase() === cleaned.toLowerCase())) continue;
    parts.push(cleaned);
  }

  if (narrative) {
    const duped = parts.some(
      (p) =>
        p.toLowerCase().includes(narrative.toLowerCase()) ||
        narrative.toLowerCase().includes(p.toLowerCase())
    );
    if (!duped) parts.push(narrative);
  }

  if (opts?.preferTitle && name && !isGenericLabel(name) && !isMostlyEmptyHubSpotForm(name)) {
    const titleNote = extractClinicalNarrative(name) || stripEmptyHubSpotFormFields(name);
    if (
      titleNote &&
      !parts.some(
        (p) =>
          p.toLowerCase().includes(titleNote.toLowerCase()) ||
          titleNote.toLowerCase().includes(p.toLowerCase())
      )
    ) {
      parts.unshift(titleNote);
    }
  }

  const practitioner = matchPractitioner([rawDesc, ticket.name, ...insightNotes].join("\n"));
  if (practitioner && !parts.some((p) => p.toLowerCase().includes(practitioner.toLowerCase()))) {
    parts.push(`Clinician: ${practitioner}`);
  }

  if (!parts.length && name && !isGenericLabel(name)) {
    parts.push(extractClinicalNarrative(name) || name);
  }
  if (!parts.length && sub && !isGenericLabel(sub)) {
    parts.push(sub);
  }

  return trimTo(parts.join("\n\n").trim(), MAX_CLINICAL_NOTE);
}

const NOT_PRACTITIONER = new Set([
  "drop-off",
  "pickup",
  "location",
  "not required",
  "passenger",
  "vehicle",
  "transport",
  "urgency",
  "regular",
  "scheduled",
  "visit",
  "session",
]);

function matchPractitioner(text: string): string | null {
  if (!text?.trim()) return null;

  const patterns = [
    /(?:session\s+(?:by|with|conducted by)|visit with|conducted by|scheduled for)\s+(Dr\.?\s*[A-Za-z][\w.-]*(?:\s+[A-Za-z][\w.-]*)?)/i,
    /\b(Dr\.?\s*[A-Za-z][\w.-]*(?:\s+[A-Za-z][\w.-]*)?)\s*(?:'s)?\s+(?:visit|session)/i,
    /(?:physio\s+session\s+with|session\s+with)\s+(Dr\.?\s*[A-Za-z][\w.-]*(?:\s+[A-Za-z][\w.-]*){0,2})/i,
    /\b(Dr\.?\s*[A-Za-z][\w.-]+)\b/,
    /(?:session\s+with|visit with)\s+((?:Ms\.?|Mr\.?|Mrs\.?)\s+[A-Za-z][\w.-]+(?:\s+[A-Za-z][\w.-]*){0,2})/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const hit = match?.[1]?.trim();
    if (hit && hit.length > 2 && !/^dr$/i.test(hit) && !NOT_PRACTITIONER.has(hit.toLowerCase())) {
      return hit.replace(/\s+/g, " ");
    }
  }

  const namedPhysio = text.match(
    /\b(?:Dr\.?\s+)?([A-Z][a-z]+)\s+(?:is\s+)?scheduled for a session with\b/i
  );
  if (namedPhysio?.[1] && !NOT_PRACTITIONER.has(namedPhysio[1].toLowerCase())) {
    return `Dr ${namedPhysio[1]}`;
  }

  return null;
}

function rawField(value: string | null | undefined): string {
  if (!value) return "";
  return value.replace(/\s+/g, " ").trim();
}

function cleanFieldSingleLine(value: string | null | undefined): string {
  if (!value) return "";
  const stripped = stripEmptyHubSpotFormFields(
    value.replace(/https?:\/\/\S+/gi, "").replace(/\[.*?\]/g, "")
  );
  return stripped.replace(/\s+/g, " ").trim();
}

function cleanFieldMultiline(value: string | null | undefined): string {
  if (!value) return "";
  return stripEmptyHubSpotFormFields(
    value.replace(/https?:\/\/\S+/gi, "").replace(/\[.*?\]/g, "")
  ).trim();
}

function isGenericLabel(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower === "—" ||
    lower === "-" ||
    lower === "n/a" ||
    lower === "ticket" ||
    lower === "hubspot ticket" ||
    lower === "regular physio visit" ||
    lower === "regular scheduled visits"
  );
}

function firstSentence(text: string): string {
  if (!text) return "";
  const match = text.match(/^[^.!?\n]{1,120}/);
  return (match?.[0] ?? text).trim();
}

function trimSummary(text: string): string {
  return trimTo(text, MAX_SUMMARY);
}

function trimTo(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}
