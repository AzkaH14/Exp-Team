import { getSacredRegistry } from "./client-registry/store";
import { resolveRegistryIdForClient } from "./reports/registry-client-index";
import type { Ticket } from "./types/ticket";
import { parseTicketDate } from "./reports/ticket-match";

export type TicketAttentionLevel = "critical" | "high" | "medium" | "low";
export type TicketQualitySignal = "complaint" | "urgent_open" | "stale" | "on_track" | "closed";

export interface TicketQueueRow extends Ticket {
  isOpen: boolean;
  daysOpen: number;
  daysOpenLabel: string;
  attention: TicketAttentionLevel;
  attentionReasons: string[];
  qualitySignal: TicketQualitySignal;
  qualityLabel: string;
  registryId: string | null;
  familyLabel: string | null;
}

export interface TicketQueueSummary {
  total: number;
  open: number;
  urgentOpen: number;
  complaintsOpen: number;
  staleOpen: number;
  avgDaysOpen: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Odoo's `date_end` isn't reliable for "open" — Approval-stage tasks lack it
 * too, which would wrongly count them as open. The business definition is
 * the workflow column itself: New/Planned/In Progress/Hold = open.
 */
const ODOO_OPEN_STAGES = new Set(["New", "Planned", "In Progress", "Hold"]);

export function isTicketOpen(ticket: Ticket): boolean {
  if (ticket.stage) return ODOO_OPEN_STAGES.has(ticket.stage);
  const closed = ticket.closed;
  if (closed == null) return true;
  return String(closed).trim() === "";
}

export function ticketDaysOpen(ticket: Ticket, now = new Date()): number {
  if (!isTicketOpen(ticket)) {
    const created = parseTicketDate(ticket.created);
    const closed = parseTicketDate(ticket.closed ?? "");
    if (created && closed) {
      return Math.max(0, Math.round((closed.getTime() - created.getTime()) / MS_PER_DAY));
    }
    return 0;
  }
  const created = parseTicketDate(ticket.created);
  if (!created) return 0;
  return Math.max(0, Math.round((now.getTime() - created.getTime()) / MS_PER_DAY));
}

function isComplaintTicket(ticket: Ticket): boolean {
  const blob = `${ticket.categoryFull} ${ticket.subCategory} ${ticket.name}`.toLowerCase();
  return /complaint|dissatisf|escalat/.test(blob);
}

function qualityForTicket(ticket: Ticket, isOpen: boolean, daysOpen: number): {
  signal: TicketQualitySignal;
  label: string;
} {
  if (!isOpen) {
    return { signal: "closed", label: "Resolved" };
  }
  if (isComplaintTicket(ticket)) {
    return { signal: "complaint", label: "Complaint — needs care review" };
  }
  if (ticket.priority === "urgent") {
    return { signal: "urgent_open", label: "Urgent & open" };
  }
  if (daysOpen >= 7) {
    return { signal: "stale", label: `Open ${daysOpen}d — follow up` };
  }
  return { signal: "on_track", label: "On track" };
}

function attentionForTicket(
  ticket: Ticket,
  isOpen: boolean,
  daysOpen: number
): { level: TicketAttentionLevel; reasons: string[] } {
  const reasons: string[] = [];
  if (!isOpen) return { level: "low", reasons };

  if (isComplaintTicket(ticket)) {
    reasons.push("Customer complaint ticket still open");
  }
  if (ticket.priority === "urgent") {
    reasons.push("Marked urgent in HubSpot");
  }
  if (daysOpen >= 14) {
    reasons.push(`Open for ${daysOpen} days — SLA risk`);
  } else if (daysOpen >= 7) {
    reasons.push(`Open for ${daysOpen} days`);
  }
  if (/doctor|physio|emergency|healthcare/i.test(ticket.categoryFull) && daysOpen >= 3) {
    reasons.push("Clinical ticket awaiting closure");
  }

  if (reasons.some((r) => r.includes("complaint") || r.includes("urgent"))) {
    return { level: "critical", reasons };
  }
  if (daysOpen >= 7 || reasons.length >= 2) {
    return { level: "high", reasons };
  }
  if (reasons.length === 1) {
    return { level: "medium", reasons };
  }
  return { level: "low", reasons };
}

function familyLabelForRegistry(registryId: string | null): string | null {
  if (!registryId) return null;
  const record = getSacredRegistry().find((r) => r.id === registryId);
  return record?.benefactor ?? null;
}

export function enrichTicketForQueue(ticket: Ticket, now = new Date()): TicketQueueRow {
  const isOpen = isTicketOpen(ticket);
  const daysOpen = ticketDaysOpen(ticket, now);
  const registryId = resolveRegistryIdForClient(ticket.client);
  const { level, reasons } = attentionForTicket(ticket, isOpen, daysOpen);
  const { signal, label } = qualityForTicket(ticket, isOpen, daysOpen);

  return {
    ...ticket,
    closed: ticket.closed ?? "",
    isOpen,
    daysOpen,
    daysOpenLabel: isOpen ? `${daysOpen}d open` : `${daysOpen}d to close`,
    attention: level,
    attentionReasons: reasons,
    qualitySignal: signal,
    qualityLabel: label,
    registryId,
    familyLabel: familyLabelForRegistry(registryId),
  };
}

export function summarizeTicketQueue(rows: TicketQueueRow[]): TicketQueueSummary {
  const openRows = rows.filter((r) => r.isOpen);
  const urgentOpen = openRows.filter((r) => r.priority === "urgent").length;
  const complaintsOpen = openRows.filter((r) => r.qualitySignal === "complaint").length;
  const staleOpen = openRows.filter((r) => r.daysOpen >= 7).length;
  const avgDaysOpen =
    openRows.length > 0
      ? Math.round(openRows.reduce((s, r) => s + r.daysOpen, 0) / openRows.length)
      : 0;

  return {
    total: rows.length,
    open: openRows.length,
    urgentOpen,
    complaintsOpen,
    staleOpen,
    avgDaysOpen,
  };
}

export function listFamiliesForTicketFilter(): Array<{
  registryId: string;
  label: string;
  city: string;
}> {
  return getSacredRegistry()
    .filter((r) => r.status === "active")
    .map((r) => ({
      registryId: r.id,
      label: r.benefactor,
      city: r.city,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
