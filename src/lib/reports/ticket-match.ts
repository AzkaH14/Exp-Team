import type { ClientRegistryRecord } from "../types/client-registry";
import { matchRegistryRecord, normalizeRegistryName } from "../client-registry/name-match";
import type { Ticket } from "../types/ticket";

function beneficiaryTokens(record: ClientRegistryRecord): string[] {
  const names = [record.beneficiary, record.benefactor, ...record.aliases];
  const tokens = new Set<string>();
  for (const name of names) {
    if (!name || name === "TBC") continue;
    for (const part of name.split(/[/,]/)) {
      const cleaned = part.replace(/\([^)]*\)/g, " ").trim();
      if (cleaned.length < 3) continue;
      tokens.add(normalizeRegistryName(cleaned));
      for (const t of normalizeRegistryName(cleaned).split(" ")) {
        if (t.length >= 4) tokens.add(t);
      }
    }
  }
  return [...tokens];
}

/** Match HubSpot tickets to a sacred registry family (benefactor + beneficiaries) */
export function ticketBelongsToRegistryClient(
  ticket: Ticket,
  record: ClientRegistryRecord
): boolean {
  if (matchRegistryRecord(ticket.client, [record])) return true;

  const blob = normalizeRegistryName(
    `${ticket.client ?? ""} ${ticket.name ?? ""} ${ticket.description ?? ""}`
  );
  if (!blob) return false;

  for (const token of beneficiaryTokens(record)) {
    if (token.length >= 4 && blob.includes(token)) return true;
  }
  return false;
}

export function parseTicketDate(raw: string | null | undefined): Date | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;

  const dmy = s.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (dmy) {
    const d = new Date(`${dmy[2]} ${dmy[1]}, ${dmy[3]}`);
    if (!Number.isNaN(d.getTime())) return d;
  }

  const iso = new Date(s);
  if (!Number.isNaN(iso.getTime())) return iso;
  return null;
}

export function formatReportDate(d: Date): string {
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "Asia/Karachi",
  });
}

export function monthBounds(month: string): { start: Date; end: Date } {
  const [y, m] = month.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));
  return { start, end };
}

export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
  });
}

export function ticketsInMonth(tickets: Ticket[], month: string): Ticket[] {
  const { start, end } = monthBounds(month);
  return tickets.filter((t) => {
    const d = parseTicketDate(t.created) ?? parseTicketDate(t.closed);
    if (!d) return false;
    return d >= start && d <= end;
  });
}
