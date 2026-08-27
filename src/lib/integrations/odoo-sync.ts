/**
 * Source B — live Odoo. The only fetch that runs after the cutover.
 *
 * Scope is project.task in project_id=2 (Field Service) created on or after
 * CUTOVER_ODOO_UTC. That date filter alone excludes the 4,995-task bulk import
 * (all stamped 2026-07-08 08:22:13), the 95-task pilot, and the Aug 8-14
 * double-entry window — so no stage filtering is needed to separate imported
 * history from live work. See odoo_instruct.md §3.4 and §5.
 */
import "server-only";
import { CUTOVER_ODOO_UTC } from "../cutover";
import { formatDisplayDate, formatMonth, parseOdooDatetime } from "../ticket-dates";
import { normalizeCity } from "./historical-sheet";
import type { Ticket } from "../types/ticket";
import {
  isOdooConfigured,
  m2oId,
  m2oName,
  num,
  searchRead,
  str,
  type Many2One,
} from "./odoo";

export const FIELD_SERVICE_PROJECT_ID = 2;

export const TASK_FIELDS = [
  "name",
  "create_date",
  "date_end",
  "stage_id",
  "priority",
  "partner_id",
  "partner_city",
  "category_id",
  "subcategory_id",
  "description",
  "effective_hours",
] as const;

interface OdooTask {
  id: number;
  name?: string | false;
  create_date?: string | false;
  date_end?: string | false;
  stage_id?: Many2One;
  priority?: string | false;
  partner_id?: Many2One;
  partner_city?: string | false;
  category_id?: Many2One;
  subcategory_id?: Many2One;
  description?: string | false;
  effective_hours?: number | false;
}

interface OdooPartner {
  id: number;
  email?: string | false;
}

/**
 * Odoo descriptions are HTML carrying collaborative-editing metadata
 * (data-last-history-steps with hundreds of digits). Strip both.
 */
export function stripOdooHtml(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Four values, not two: 0 Low, 1 Medium, 2 High, 3 Urgent.
 * odoo_arc.md claims only 0 and 2 exist — mapping on that basis silently
 * mislabels every Urgent ticket. See odoo_instruct.md §1.
 */
export function mapOdooPriority(raw: string): "urgent" | "normal" {
  return raw === "2" || raw === "3" ? "urgent" : "normal";
}

export interface OdooTicket extends Ticket {
  /** Stable Odoo partner id — a better registry key than the display name. */
  partnerId: number | null;
  /** Workflow column (New / In Progress / Done / Cancelled / Approval / Hold). */
  stage: string;
  /** Odoo's nearest analogue to Claimable Engagement Hours (90 of 220 rows). */
  effectiveHours: number | null;
}

export function mapOdooTaskToTicket(
  task: OdooTask,
  emailByPartner: Map<number, string | null>
): OdooTicket {
  const createdMs = parseOdooDatetime(task.create_date);
  const closedMs = parseOdooDatetime(task.date_end);
  const categoryFull = m2oName(task.category_id) || "Unspecified";
  const partnerId = m2oId(task.partner_id);
  const hours = num(task.effective_hours);

  return {
    // Odoo ids (71843) and HubSpot ids (33778612547) share a namespace.
    id: `odoo-${task.id}`,
    ticketNumber: `MOH-${String(task.id).slice(-5)}`,
    client: m2oName(task.partner_id),
    // email_from is empty on every organic task — the email lives on the partner.
    email: partnerId !== null ? emailByPartner.get(partnerId) ?? null : null,
    city: normalizeCity(str(task.partner_city)),
    category: categoryFull ? categoryFull.split(/[\s/]/)[0] : "",
    categoryFull,
    subCategory: m2oName(task.subcategory_id),
    name: str(task.name),
    description: stripOdooHtml(str(task.description)),
    created: formatDisplayDate(createdMs),
    closed: closedMs === null ? null : formatDisplayDate(closedMs),
    month: formatMonth(createdMs),
    priority: mapOdooPriority(str(task.priority)),
    partnerId,
    stage: m2oName(task.stage_id),
    effectiveHours: hours > 0 ? hours : null,
  };
}

/**
 * One batched query, never one per ticket. 88 distinct partners cover the
 * current 220 organic tasks and all 88 carry an email.
 */
async function fetchPartnerEmails(
  partnerIds: number[]
): Promise<Map<number, string | null>> {
  const map = new Map<number, string | null>();
  if (!partnerIds.length) return map;

  const partners = await searchRead<OdooPartner>(
    "res.partner",
    [["id", "in", partnerIds]],
    ["email"],
    { limit: 2000 }
  );
  for (const p of partners) {
    const email = str(p.email);
    map.set(p.id, email.includes("@") ? email : null);
  }
  return map;
}

/** Post-cutover tickets from Odoo. Throws if Odoo is unreachable — never lies. */
export async function fetchOdooTickets(): Promise<OdooTicket[]> {
  if (!isOdooConfigured()) {
    throw new Error("Odoo is not configured — set ODOO_URL / DB / USERNAME / API_KEY");
  }

  const tasks = await searchRead<OdooTask>(
    "project.task",
    [
      ["project_id", "=", FIELD_SERVICE_PROJECT_ID],
      ["create_date", ">=", CUTOVER_ODOO_UTC],
    ],
    [...TASK_FIELDS],
    { limit: 20000, order: "create_date desc" }
  );

  const partnerIds = [
    ...new Set(tasks.map((t) => m2oId(t.partner_id)).filter((id): id is number => id !== null)),
  ];
  const emailByPartner = await fetchPartnerEmails(partnerIds);

  return tasks.map((t) => mapOdooTaskToTicket(t, emailByPartner));
}
