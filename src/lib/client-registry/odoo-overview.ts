import type { OdooOverviewSection } from "../types/client-registry";

/**
 * Odoo's Notes field (res.partner.comment), shown as "Family Overview" on the
 * contact form. Staff write it freehand, so structure varies: <h2>/<h3>
 * headings, bold-only paragraphs used as headings, or literal "## " lines.
 * Some entries embed base64 screenshots — never ship those to the browser.
 */

const HEADING_TAG = /<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/gi;
const BOLD_PARAGRAPH = /<p[^>]*>\s*<(strong|b)>([^<]{2,80})<\/\1>\s*:?\s*<\/p>/gi;
/** Staff sometimes type markdown: <p>## General Overview</p>. */
const HASH_PARAGRAPH = /<p[^>]*>\s*#{1,4}\s*([^<]{2,80})<\/p>/gi;

export const INTERESTS_HEADING = "Hobbies & Interests";
const INTERESTS_RE = /hobb|interest/i;

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cleanHeading(raw: string): string {
  return decodeEntities(raw.replace(/<[^>]+>/g, ""))
    .replace(/^#+\s*/, "")
    .replace(/[:\s]+$/, "")
    .trim();
}

/** HTML → plain text with "## Heading" markers. Images are dropped. */
export function overviewHtmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<img[^>]*>/gi, "")
      .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
      .replace(HEADING_TAG, (_m, h: string) => `\n## ${cleanHeading(h)}\n`)
      .replace(BOLD_PARAGRAPH, (_m, _t, h: string) => `\n## ${cleanHeading(h)}\n`)
      .replace(/<li[^>]*>/gi, "\n- ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|ul|ol|tr)>/gi, "\n")
      .replace(/<[^>]+>/g, "")
  )
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function parseOverviewSections(html: string | null | undefined): OdooOverviewSection[] {
  if (!html) return [];
  const text = overviewHtmlToText(html);
  if (!text) return [];

  const sections: OdooOverviewSection[] = [];
  let heading = "Overview";
  let buf: string[] = [];
  const flush = () => {
    const body = buf.join("\n").trim();
    if (body) sections.push({ heading, body });
    buf = [];
  };
  for (const line of text.split("\n")) {
    const m = /^##\s+(.+)$/.exec(line);
    if (m) {
      flush();
      heading = m[1].trim();
    } else {
      buf.push(line);
    }
  }
  flush();
  return sections;
}

export function interestsFromSections(sections: OdooOverviewSection[]): string[] {
  const section = sections.find((s) => INTERESTS_RE.test(s.heading));
  if (!section) return [];
  return [
    ...new Set(
      section.body
        .split(/\n|,|;/)
        .map((s) => s.replace(/^[-•*]\s*/, "").trim())
        .filter((s) => s.length > 0 && s.length <= 80)
    ),
  ];
}

function interestsHtml(interests: string[]): string {
  return `<h2>${escapeHtml(INTERESTS_HEADING)}</h2><ul>${interests
    .map((i) => `<li>${escapeHtml(i)}</li>`)
    .join("")}</ul>`;
}

/**
 * Replace (or append) only the Hobbies & Interests block, leaving every other
 * part of the staff-written Family Overview byte-for-byte untouched.
 */
export function upsertInterestsSection(html: string | null | undefined, interests: string[]): string {
  const source = html ?? "";
  const headings: Array<{ start: number; end: number; text: string }> = [];
  for (const re of [HEADING_TAG, BOLD_PARAGRAPH, HASH_PARAGRAPH]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source))) {
      const text = cleanHeading(m[m.length - 1]);
      headings.push({ start: m.index, end: m.index + m[0].length, text });
    }
  }
  headings.sort((a, b) => a.start - b.start);

  const idx = headings.findIndex((h) => INTERESTS_RE.test(h.text));
  const block = interests.length ? interestsHtml(interests) : "";

  if (idx === -1) {
    return block ? `${source}${block}` : source;
  }
  const blockStart = headings[idx].start;
  const blockEnd = idx + 1 < headings.length ? headings[idx + 1].start : source.length;
  return source.slice(0, blockStart) + block + source.slice(blockEnd);
}
