/**
 * Engagement Calendar → Odoo.
 *
 * The calendar's Type options are the Odoo sub categories under Experience
 * (service.category id 17), and "Create ticket in Odoo" on a logged entry
 * creates one Field Service task from it. Saving an entry never creates a
 * task — only the explicit button does.
 */
import "server-only";
import type { ClientRegistryRecord } from "../types/client-registry";
import type { EngagementEvent, ExperienceSubcategory } from "../types/engagement-calendar";
import {
  EXPERIENCE_CATEGORY,
  FIELD_SERVICE_PROJECT,
  createExperienceTask,
  isOdooConfigured,
  searchRead,
  str,
} from "./odoo";

const SUBCATEGORY_TTL_MS = 30 * 60 * 1000;

/**
 * Snapshot of Odoo's Experience sub categories (verified 30 Sep 2026), used
 * only when Odoo is unreachable so the calendar still offers the right types.
 */
const FALLBACK_SUBCATEGORIES: Array<{ id: number; name: string }> = [
  { id: 162, name: "Gift/Flower Delivery Assistance" },
  { id: 163, name: "Event Support" },
  { id: 173, name: "Engagaement Visit" },
  { id: 263, name: "Offboarding" },
  { id: 264, name: "City Owner Visit" },
  { id: 273, name: "Other" },
];

/** "Experience Team" hr.employee — the default assignee staff use for these tasks. */
const EXPERIENCE_TEAM_EMPLOYEE = "Experience Team";

const CITY_CODES: Record<string, string> = {
  Islamabad: "ISB",
  Karachi: "KHI",
  Lahore: "LHR",
};

function toLabel(name: string): string {
  // Odoo's record is misspelled; keep the id, fix the display and task title.
  return name.replace(/Engagaement/i, "Engagement").trim();
}

function toSubcategories(rows: Array<{ id: number; name: string }>): ExperienceSubcategory[] {
  const list = rows.map((r) => ({ id: r.id, name: r.name, label: toLabel(r.name) }));
  // "Other" last, the rest alphabetical.
  return list.sort((a, b) =>
    a.label === "Other" ? 1 : b.label === "Other" ? -1 : a.label.localeCompare(b.label)
  );
}

let subcategoryCache: { at: number; list: ExperienceSubcategory[] } | null = null;

export async function getExperienceSubcategories(): Promise<ExperienceSubcategory[]> {
  if (subcategoryCache && Date.now() - subcategoryCache.at < SUBCATEGORY_TTL_MS) {
    return subcategoryCache.list;
  }
  if (!isOdooConfigured()) return toSubcategories(FALLBACK_SUBCATEGORIES);
  try {
    const rows = await searchRead<{ id: number; name: string | false }>(
      "service.category",
      [["parent_id", "=", EXPERIENCE_CATEGORY]],
      ["name"],
      { limit: 200 }
    );
    const list = toSubcategories(
      rows.map((r) => ({ id: r.id, name: str(r.name) })).filter((r) => r.name)
    );
    if (list.length) {
      subcategoryCache = { at: Date.now(), list };
      return list;
    }
  } catch (e) {
    console.warn("Odoo Experience sub categories unavailable, using snapshot:", e);
  }
  return subcategoryCache?.list ?? toSubcategories(FALLBACK_SUBCATEGORIES);
}

export async function findExperienceSubcategory(
  id: number
): Promise<ExperienceSubcategory | null> {
  return (await getExperienceSubcategories()).find((s) => s.id === id) ?? null;
}

let employeeCache: { at: number; rows: Array<{ id: number; name: string }> } | null = null;

async function experienceEmployees(): Promise<Array<{ id: number; name: string }>> {
  if (employeeCache && Date.now() - employeeCache.at < SUBCATEGORY_TTL_MS) return employeeCache.rows;
  const rows = await searchRead<{ id: number; name: string | false }>(
    "hr.employee",
    [["department_id.name", "=", "Experience"]],
    ["name"],
    { limit: 200 }
  );
  employeeCache = {
    at: Date.now(),
    rows: rows.map((r) => ({ id: r.id, name: str(r.name) })),
  };
  return employeeCache.rows;
}

/** Always the Experience Team employee — the single standing assignee. */
async function assigneeIds(): Promise<number[]> {
  const rows = await experienceEmployees();
  const team = rows.find((r) => r.name.toLowerCase() === EXPERIENCE_TEAM_EMPLOYEE.toLowerCase());
  return team ? [team.id] : [];
}

/** YYYY-MM-DD + HH:MM in Pakistan time → naive UTC string for Odoo. */
function pktToOdooUtc(date: string, time: string): string {
  const [h, m] = time.split(":").map(Number);
  const utc = new Date(`${date}T00:00:00Z`).getTime() + ((h - 5) * 60 + m) * 60_000;
  return new Date(utc).toISOString().slice(0, 19).replace("T", " ");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Title convention used by ops: "Engagement Visit - Ensherah Khan - KHI". */
export function experienceTaskTitle(
  event: Pick<EngagementEvent, "title" | "clientLabel" | "city">,
  sub: ExperienceSubcategory
): string {
  const what = event.title.trim() || sub.label;
  const code = CITY_CODES[event.city] ?? event.city.slice(0, 3).toUpperCase();
  return `${what} - ${event.clientLabel} - ${code}`;
}

export async function createOdooTaskFromEvent(
  event: EngagementEvent,
  record: ClientRegistryRecord
): Promise<{ id: number; name: string }> {
  if (!isOdooConfigured()) throw new Error("Odoo is not configured");
  if (!record.odooPartnerId) {
    throw new Error(`${record.benefactor} has no Odoo contact — sync the registry from Odoo first`);
  }
  if (event.type !== "experience" || !event.odooSubcategoryId) {
    throw new Error("Pick an Experience type (Odoo sub category) for this entry first");
  }
  const sub = await findExperienceSubcategory(event.odooSubcategoryId);
  if (!sub) throw new Error("That type is no longer an Experience sub category in Odoo");

  // A task already carrying this entry's reference means a previous attempt
  // reached Odoo but the calendar never recorded it — reuse, never duplicate.
  const ref = `portal-entry:${event.id}`;
  const [already] = await searchRead<{ id: number; name: string | false }>(
    "project.task",
    [["project_id", "=", FIELD_SERVICE_PROJECT], ["description", "ilike", ref]],
    ["name"],
    { limit: 1 }
  );
  if (already) return { id: already.id, name: str(already.name) };

  const name = experienceTaskTitle(event, sub);
  const notes = event.notes.trim();

  // Start and end are compulsory on new entries — map straight to Odoo's
  // Planned Date (start) and Deadline (end).
  if (!event.time || !event.endDate || !event.endTime) {
    throw new Error("Set the start date/time and end date/time before creating the Odoo task");
  }
  const planned_date_begin = pktToOdooUtc(event.date, event.time);
  const date_deadline = pktToOdooUtc(event.endDate, event.endTime);

  const id = await createExperienceTask({
    name,
    subcategory_id: sub.id,
    partner_id: record.odooPartnerId,
    planned_date_begin,
    date_deadline,
    description:
      (notes ? `<p>${escapeHtml(notes).replace(/\n/g, "<br/>")}</p>` : "") +
      `<p><em>Created from the Engagement Calendar on ${escapeHtml(event.date)} by ${escapeHtml(event.createdBy || "team")}</em></p>` +
      `<p style="color:#999;font-size:10px">${ref}</p>`,
    employee_ids: await assigneeIds(),
  });
  return { id, name };
}
