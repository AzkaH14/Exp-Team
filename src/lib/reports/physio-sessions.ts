import "server-only";
import { getSacredRegistry } from "../client-registry/store";
import { getReportTicketIndex } from "./ticket-index";
import { buildPhysiotherapySessionNotes, isPhysiotherapyTicket } from "./medical-tickets";
import { parseBeneficiaryNames, ticketMentionsPerson } from "./tickets-for-client";
import type { PhysioSessionLogEntry } from "./types";

/** All physiotherapy sessions for a calendar month — for weekly trend reviews */
export function listPhysioSessionsForMonth(monthKey: string): PhysioSessionLogEntry[] {
  const registry = getSacredRegistry();
  const byId = new Map(registry.map((r) => [r.id, r]));
  const index = getReportTicketIndex();
  const entries: PhysioSessionLogEntry[] = [];

  for (const [registryId, perMonth] of index.byRegistryMonth) {
    const record = byId.get(registryId);
    if (!record) continue;

    const monthTickets = perMonth.get(monthKey) ?? [];
    const physioTickets = monthTickets.filter(isPhysiotherapyTicket);
    if (!physioTickets.length) continue;

    const beneficiaries = parseBeneficiaryNames(record.beneficiary);
    const sessions = buildPhysiotherapySessionNotes(
      physioTickets,
      beneficiaries,
      ticketMentionsPerson
    );

    for (const session of sessions) {
      entries.push({
        registryId,
        benefactor: record.benefactor,
        beneficiary: record.beneficiary,
        city: record.city,
        weekKey: weekKeyFromDateLabel(session.date, monthKey),
        ...session,
      });
    }
  }

  return entries.sort((a, b) => b.date.localeCompare(a.date));
}

function weekKeyFromDateLabel(dateLabel: string, monthKey: string): string {
  const parsed = Date.parse(dateLabel);
  if (Number.isNaN(parsed)) {
    return `${monthKey}-W1`;
  }
  const day = new Date(parsed).getUTCDate();
  const week = Math.min(5, Math.ceil(day / 7));
  return `${monthKey}-W${week}`;
}

export function groupPhysioSessionsByWeek(
  entries: PhysioSessionLogEntry[]
): Map<string, PhysioSessionLogEntry[]> {
  const map = new Map<string, PhysioSessionLogEntry[]>();
  for (const entry of entries) {
    const list = map.get(entry.weekKey) ?? [];
    list.push(entry);
    map.set(entry.weekKey, list);
  }
  return map;
}

export function physioCountForFamily(registryId: string, monthKey: string): number {
  const perMonth = getReportTicketIndex().byRegistryMonth.get(registryId);
  if (!perMonth) return 0;
  return (perMonth.get(monthKey) ?? []).filter(isPhysiotherapyTicket).length;
}
