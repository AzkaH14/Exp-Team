/**
 * HubSpot ticket bodies append intake forms with many empty fields, e.g.
 *   counseling session conducted Type of Session: Session Frequency: Gender Preference:
 * Reports should only show the free-text note and fields that have a value.
 */

const HUBSPOT_FORM_LABELS = [
  "Any Other Requirement / Notes",
  "Special Requests/Notes",
  "Wheel Chair/Special Assistance",
  "Number of Checked Baggage",
  "Number of Hand Carry Items",
  "Relevant Department/Office",
  "Reporting Time at Airport",
  "Arrival Date and Time",
  "Preferred Date and Time",
  "Required Time/Date",
  "Vehicle Preferance",
  "Vehicle Preference",
  "Type of Resource to be Replaced",
  "Patient Condition/Requirements",
  "Hospital/Clinic Name",
  "Type of Appointment",
  "Purpose of Assistance",
  "Fso Accompaniment",
  "Passenger Name(s)",
  "Passenger Photo(s)",
  "Drop-Off Location",
  "Pickup Location",
  "Transport Required",
  "Type of Document",
  "Condition / Injury",
  "Weekly Work Schedule",
  "Level of Care Required",
  "Cuisine Requirements",
  "Level of Assistance",
  "Session Frequency",
  "Gender Preference",
  "Type of Residence",
  "Assistance Level",
  "FSO Required",
  "Ticket Photo",
  "Doctor Name",
  "Patient Name",
  "Patient name",
  "Budget Range",
  "Working Hours",
  "Type of Session",
  "Start Date",
  "Shift Type",
  "Care Type",
  "Duration",
  "Type of Work",
  "Car Availability",
  "Reason for Replacement",
  "MR Number",
  "Urgency",
  "Location",
  "Reason",
].sort((a, b) => b.length - a.length);

const NORMALIZED_LABELS = HUBSPOT_FORM_LABELS.map((l) => normalizeLabel(l));

const LABEL_PATTERN = new RegExp(
  `(?:^|[\\n\\r]|\\s)(${HUBSPOT_FORM_LABELS.map(escapeRegex).join("|")})\\s*:`,
  "gi"
);

/** Matches HubSpot field labels at the start of a line (avoids false hits on times like 12:00). */
const GENERIC_FORM_LABEL_LINE =
  /(?:^|\n)\s*([A-Z][A-Za-z0-9 /()&'\\-]{2,58}?):\s*/g;

const INLINE_KNOWN_LABEL = new RegExp(
  `\\s(${HUBSPOT_FORM_LABELS.map(escapeRegex).join("|")})\\s*:`,
  "gi"
);

function looksLikeTimeFragment(label: string): boolean {
  return /\d/.test(label) || /\bat\s+\d/i.test(label);
}

function countInlineKnownLabels(value: string): number {
  INLINE_KNOWN_LABEL.lastIndex = 0;
  let count = 0;
  let match: RegExpExecArray | null;
  while ((match = INLINE_KNOWN_LABEL.exec(value)) !== null) {
    count++;
  }
  return count;
}

const NON_SUBSTANTIVE_VALUES =
  /^(?:not required|n\/a|na|none|nil|no|yes|-|—|\.{1,3}|·+|•+|\s+)$/i;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeLabel(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function isKnownFormLabel(label: string): string | null {
  const norm = normalizeLabel(label);
  for (let i = 0; i < HUBSPOT_FORM_LABELS.length; i++) {
    const known = NORMALIZED_LABELS[i];
    if (norm === known || norm.startsWith(`${known} `) || known.startsWith(norm)) {
      return HUBSPOT_FORM_LABELS[i];
    }
  }
  return null;
}

function countInlineLabels(value: string): number {
  return countInlineKnownLabels(value);
}

function valueLooksLikeEmptyOrLabel(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (trimmed.length < 3) return true;
  if (NON_SUBSTANTIVE_VALUES.test(trimmed)) return true;
  if (/^[\s·•.,;:–—-]+$/.test(trimmed)) return true;
  if (isKnownFormLabel(trimmed.replace(/:$/, ""))) return true;

  const norm = normalizeLabel(trimmed);
  if (
    HUBSPOT_FORM_LABELS.some(
      (label) =>
        normalizeLabel(label).startsWith(norm) && normalizeLabel(label).length > norm.length + 2
    )
  ) {
    return true;
  }

  const inlineLabels = countInlineLabels(trimmed);
  if (inlineLabels >= 2) return true;
  if (inlineLabels === 1 && trimmed.length < 80) return true;

  return false;
}

/** True when text reads like a clinical/session note rather than form boilerplate. */
export function isSubstantiveClinicalValue(value: string): boolean {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed || valueLooksLikeEmptyOrLabel(trimmed)) return false;
  if (trimmed.length < 10) return false;

  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length < 2) return false;

  const hasLowercase = /[a-z]/.test(trimmed);
  const looksLikeSentence =
    /[.!?]/.test(trimmed) ||
    /\b(session|conducted|visit|patient|improv|exercise|mobility|pain|stable|progress|scheduled|held|physio|doctor|dr\.?)\b/i.test(
      trimmed
    );

  return hasLowercase && looksLikeSentence;
}

function isUsefulPreamble(text: string): boolean {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed || trimmed.length < 8) return false;
  if (valueLooksLikeEmptyOrLabel(trimmed)) return false;
  if (/^(?:regular physio visit|regular scheduled visits)$/i.test(trimmed)) return false;
  return true;
}

interface FormFieldMatch {
  canonical: string;
  valueStart: number;
  valueEnd: number;
}

interface GenericFieldSpan {
  label: string;
  labelStart: number;
  valueStart: number;
}

function findGenericFormFields(text: string): { preamble: string; fields: GenericFieldSpan[] } {
  const fields: GenericFieldSpan[] = [];

  GENERIC_FORM_LABEL_LINE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = GENERIC_FORM_LABEL_LINE.exec(text)) !== null) {
    const label = match[1].trim();
    if (!label || label.length < 3) continue;
    if (looksLikeTimeFragment(label)) continue;

    const labelStart = match.index + match[0].length - label.length - 1;
    const valueStart = match.index + match[0].length;
    fields.push({ label, labelStart, valueStart });
  }

  INLINE_KNOWN_LABEL.lastIndex = 0;
  while ((match = INLINE_KNOWN_LABEL.exec(text)) !== null) {
    const label = match[1].trim();
    const canonical = isKnownFormLabel(label);
    if (!canonical) continue;

    const labelStart = match.index + match[0].length - label.length - 1;
    const valueStart = match.index + match[0].length;
    fields.push({ label: canonical, labelStart, valueStart });
  }

  fields.sort((a, b) => a.labelStart - b.labelStart);

  const deduped: GenericFieldSpan[] = [];
  for (const field of fields) {
    if (deduped.some((d) => Math.abs(d.labelStart - field.labelStart) < 2)) continue;
    deduped.push(field);
  }

  const firstLabelAt = deduped.length
    ? Math.min(...deduped.map((field) => field.labelStart))
    : text.length;
  const preamble = (deduped.length ? text.slice(0, firstLabelAt) : text).trim();
  return { preamble, fields: deduped };
}

function findFormFields(text: string): { preamble: string; fields: FormFieldMatch[] } {
  const fields: FormFieldMatch[] = [];
  let firstLabelAt = text.length;

  LABEL_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  const spans: { canonical: string; labelStart: number; valueStart: number }[] = [];

  while ((match = LABEL_PATTERN.exec(text)) !== null) {
    const canonical = isKnownFormLabel(match[1]);
    if (!canonical) continue;
    const labelStart = match.index + match[0].length - match[1].length - 1;
    const valueStart = match.index + match[0].length;
    spans.push({ canonical, labelStart, valueStart });
    if (labelStart < firstLabelAt) firstLabelAt = labelStart;
  }

  for (let i = 0; i < spans.length; i++) {
    const valueEnd = i + 1 < spans.length ? spans[i + 1].labelStart : text.length;
    fields.push({
      canonical: spans[i].canonical,
      valueStart: spans[i].valueStart,
      valueEnd,
    });
  }

  const preamble = (spans.length ? text.slice(0, firstLabelAt) : text).trim();
  return { preamble, fields };
}

function stripInlineLabelChains(text: string): string {
  let result = text;
  for (const label of HUBSPOT_FORM_LABELS) {
    result = result.replace(
      new RegExp(`(?:^|[\\n\\r]|\\s)${escapeRegex(label)}:\\s*`, "gi"),
      (match) => (match.startsWith("\n") ? "\n" : " ")
    );
  }
  return result
    .replace(/(?:^|\n)\s*(?:[A-Za-z][A-Za-z0-9 /()'-]{2,50}:\s*)+\s*(?=\n|$)/g, "\n")
    .replace(/[·•]{1,}/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Keep preamble and any filled form values; drop empty HubSpot intake labels. */
export function stripEmptyHubSpotFormFields(text: string): string {
  if (!text?.trim()) return "";

  const normalized = text.replace(/\r\n/g, "\n");
  const { preamble, fields } = findGenericFormFields(normalized);

  const filled: string[] = [];
  for (let i = 0; i < fields.length; i++) {
    const valueEnd = i + 1 < fields.length ? fields[i + 1].labelStart : normalized.length;
    const raw = normalized.slice(fields[i].valueStart, valueEnd).trim();
    const value = raw.replace(/\n+/g, " ").replace(/\s+/g, " ").trim();
    if (!valueLooksLikeEmptyOrLabel(value) && isSubstantiveClinicalValue(value)) {
      const canonical = isKnownFormLabel(fields[i].label) ?? fields[i].label;
      filled.push(`${canonical}: ${value}`);
    }
  }

  const parts: string[] = [];
  if (preamble && isUsefulPreamble(preamble)) parts.push(preamble);
  if (filled.length) parts.push(filled.join(" · "));

  return stripInlineLabelChains(parts.join("\n").trim());
}

/**
 * Extract the free-text clinical narrative from a HubSpot ticket body.
 * Physio and doctor tickets usually lead with session notes; the rest is intake form noise.
 */
export function extractClinicalNarrative(text: string): string {
  if (!text?.trim()) return "";

  const normalized = text.replace(/\r\n/g, "\n").trim();
  const { preamble, fields } = findGenericFormFields(normalized);

  const narrativeParts: string[] = [];

  if (preamble && isUsefulPreamble(preamble)) {
    narrativeParts.push(preamble);
  }

  for (let i = 0; i < fields.length; i++) {
    const valueEnd = i + 1 < fields.length ? fields[i + 1].labelStart : normalized.length;
    const raw = normalized.slice(fields[i].valueStart, valueEnd).trim();
    const value = raw.replace(/\n+/g, " ").replace(/\s+/g, " ").trim();
    if (isSubstantiveClinicalValue(value)) {
      narrativeParts.push(value);
    }
  }

  const joined = narrativeParts.join("\n\n").trim();
  if (joined) return joined.trim();

  const fallback = stripEmptyHubSpotFormFields(normalized);
  return fallback && !isMostlyEmptyHubSpotForm(normalized) ? fallback : "";
}

/** True when text is mostly an empty HubSpot intake form */
export function isMostlyEmptyHubSpotForm(text: string): boolean {
  if (!text?.trim()) return true;
  const narrative = extractClinicalNarrative(text);
  if (narrative.length >= 12) return false;

  const { preamble, fields } = findFormFields(text);
  if (!fields.length) return false;
  const filled = fields.filter((f) => {
    const value = text.slice(f.valueStart, f.valueEnd).trim();
    return !valueLooksLikeEmptyOrLabel(value);
  });
  return filled.length === 0 && preamble.length < 40;
}
