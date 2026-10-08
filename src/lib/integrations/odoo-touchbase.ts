/**
 * Odoo reads for the Benefactor Touchbase Tracker:
 *  - the contact city of each benefactor (res.partner.city — the registry
 *    collapses Rawalpindi into "Other", the tracker needs it as-is), and
 *  - Experience tasks (Field Service, category Experience) per benefactor in
 *    a month, so a logged visit/call shows up without double entry.
 */
import "server-only";
import {
  EXPERIENCE_CATEGORY,
  FIELD_SERVICE_PROJECT,
  isOdooConfigured,
  m2oId,
  m2oName,
  searchRead,
  str,
  type Many2One,
} from "./odoo";

const CACHE_TTL_MS = 2 * 60 * 1000;
const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;

export interface OdooExperienceTask {
  id: number;
  partnerId: number;
  name: string;
  subcategory: string;
  stage: string;
  /** PKT YYYY-MM-DD of planned start, else closed, else created. */
  date: string;
  done: boolean;
  people: string[];
}

interface TaskRow {
  id: number;
  name?: string | false;
  stage_id?: Many2One;
  partner_id?: Many2One;
  subcategory_id?: Many2One;
  planned_date_begin?: string | false;
  date_end?: string | false;
  create_date?: string | false;
  employee_ids?: number[] | false;
}

/** Odoo naive-UTC "YYYY-MM-DD HH:MM:SS" → Pakistan calendar date. */
function odooUtcToPktDate(raw: string): string {
  const ms = Date.parse(`${raw.replace(" ", "T")}Z`);
  if (Number.isNaN(ms)) return "";
  return new Date(ms + PKT_OFFSET_MS).toISOString().slice(0, 10);
}

/** Month bounds in PKT, as naive UTC strings for Odoo domains. */
function monthBoundsUtc(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number);
  const toOdoo = (ms: number) => new Date(ms - PKT_OFFSET_MS).toISOString().slice(0, 19).replace("T", " ");
  return { start: toOdoo(Date.UTC(y, m - 1, 1)), end: toOdoo(Date.UTC(y, m, 1)) };
}

const cache = globalThis as unknown as {
  __mohsynTouchbaseCities?: { at: number; map: Map<number, string> };
  __mohsynTouchbaseTasks?: Map<string, { at: number; tasks: OdooExperienceTask[] }>;
};

export async function fetchPartnerCities(partnerIds: number[]): Promise<Map<number, string>> {
  const hit = cache.__mohsynTouchbaseCities;
  if (hit && Date.now() - hit.at < CACHE_TTL_MS && partnerIds.every((id) => hit.map.has(id))) {
    return hit.map;
  }
  const map = new Map<number, string>();
  if (!isOdooConfigured() || !partnerIds.length) return map;
  const rows = await searchRead<{ id: number; city?: string | false }>(
    "res.partner",
    [["id", "in", partnerIds]],
    ["city"],
    { limit: partnerIds.length + 10 }
  );
  for (const r of rows) map.set(r.id, str(r.city).trim());
  cache.__mohsynTouchbaseCities = { at: Date.now(), map };
  return map;
}

export async function fetchExperienceTasks(
  month: string,
  partnerIds: number[]
): Promise<OdooExperienceTask[]> {
  if (!isOdooConfigured() || !partnerIds.length) return [];
  const byMonth = (cache.__mohsynTouchbaseTasks ??= new Map());
  const hit = byMonth.get(month);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.tasks;

  const { start, end } = monthBoundsUtc(month);
  const inMonth = (field: string) => ["&", [field, ">=", start], [field, "<", end]];
  const rows = await searchRead<TaskRow>(
    "project.task",
    [
      ["project_id", "=", FIELD_SERVICE_PROJECT],
      ["category_id", "=", EXPERIENCE_CATEGORY],
      ["partner_id", "in", partnerIds],
      "|",
      "|",
      ...inMonth("planned_date_begin"),
      ...inMonth("date_end"),
      ...inMonth("create_date"),
    ],
    ["name", "stage_id", "partner_id", "subcategory_id", "planned_date_begin", "date_end", "create_date", "employee_ids"],
    { limit: 2000, order: "create_date desc" }
  );

  const employeeIds = [...new Set(rows.flatMap((r) => (Array.isArray(r.employee_ids) ? r.employee_ids : [])))];
  const employeeNames = new Map<number, string>();
  if (employeeIds.length) {
    const emps = await searchRead<{ id: number; name?: string | false }>(
      "hr.employee",
      [["id", "in", employeeIds]],
      ["name"],
      { limit: employeeIds.length + 10 }
    );
    for (const e of emps) employeeNames.set(e.id, str(e.name));
  }

  const tasks: OdooExperienceTask[] = [];
  for (const r of rows) {
    const partnerId = m2oId(r.partner_id);
    if (partnerId === null) continue;
    const stage = m2oName(r.stage_id);
    const when = str(r.planned_date_begin) || str(r.date_end) || str(r.create_date);
    tasks.push({
      id: r.id,
      partnerId,
      name: str(r.name),
      subcategory: m2oName(r.subcategory_id).replace(/Engagaement/i, "Engagement"),
      stage,
      date: when ? odooUtcToPktDate(when) : "",
      done: /done|complete|closed/i.test(stage),
      people: (Array.isArray(r.employee_ids) ? r.employee_ids : [])
        .map((id) => employeeNames.get(id) ?? "")
        .filter(Boolean),
    });
  }
  byMonth.set(month, { at: Date.now(), tasks });
  return tasks;
}
