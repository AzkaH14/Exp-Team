/**
 * Odoo JSON-RPC client.
 *
 * Not REST: one URL, one HTTP method. Every operation is a POST to
 * {ODOO_URL}/jsonrpc with a different body. See odoo_instruct.md §8.
 *
 * Reads go through execute() and are limited to search_read / search_count /
 * read_group / fields_get. The credential has full rights, so this file is the
 * guardrail: the ONLY writes are the allowlisted helpers at the bottom —
 * updatePartnerFields() (res.partner name / date of birth / Family Overview),
 * postPartnerNote() (a chatter note on a contact) and
 * createExperienceTask() (one Field Service task in the Experience category).
 * Do not widen them.
 */
import "server-only";

const FETCH_TIMEOUT_MS = 30_000;

export interface OdooConfig {
  url: string;
  db: string;
  username: string;
  apiKey: string;
}

export function getOdooConfig(): OdooConfig | null {
  const url = process.env.ODOO_URL?.trim().replace(/\/+$/, "");
  const db = process.env.ODOO_DB?.trim();
  const username = process.env.ODOO_USERNAME?.trim();
  const apiKey = process.env.ODOO_API_KEY?.trim();
  if (!url || !db || !username || !apiKey) return null;
  return { url, db, username, apiKey };
}

export function isOdooConfigured(): boolean {
  return getOdooConfig() !== null;
}

/** Odoo returns [id, "Display Name"] for many2one — a tuple, not an object. */
export type Many2One = [number, string] | false | null | undefined;

export function m2oId(value: Many2One): number | null {
  return Array.isArray(value) ? value[0] : null;
}

export function m2oName(value: Many2One): string {
  return Array.isArray(value) ? value[1] : "";
}

/** Odoo returns `false` for ANY empty field — strings, dates and relations alike. */
export function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Odoo answers application-level failures with HTTP 200 and an `error` body —
 * bad field, permission denied, Python traceback. res.ok tells you nothing.
 */
async function rpc<T>(url: string, params: Record<string, unknown>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${url}/jsonrpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "call", params, id: Date.now() }),
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error("Odoo request timed out");
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) throw new Error(`Odoo HTTP ${res.status}`);

  const body = (await res.json()) as {
    result?: T;
    error?: { message?: string; data?: { message?: string; debug?: string } };
  };
  if (body.error) {
    throw new Error(
      body.error.data?.message || body.error.message || "Odoo call failed"
    );
  }
  return body.result as T;
}

/**
 * The uid is NOT a session token — Odoo issues no session and no expiry, and
 * the API key is re-sent on every call. Cache it per credential and clear it
 * only when a call fails with an access error.
 */
const uidCache = new Map<string, number>();

function cacheKey(c: OdooConfig): string {
  return `${c.url}|${c.db}|${c.username}`;
}

export async function authenticate(config: OdooConfig): Promise<number> {
  const key = cacheKey(config);
  const cached = uidCache.get(key);
  if (cached) return cached;

  const uid = await rpc<number | false>(config.url, {
    service: "common",
    method: "authenticate",
    args: [config.db, config.username, config.apiKey, {}],
  });
  if (!uid || typeof uid !== "number") {
    throw new Error("Odoo authentication failed — check ODOO_DB / username / API key");
  }
  uidCache.set(key, uid);
  return uid;
}

function clearUid(config: OdooConfig): void {
  uidCache.delete(cacheKey(config));
}

type ReadMethod = "search_read" | "search_count" | "read_group" | "fields_get";

/** Any read method on any model. Writes go through the allowlisted helpers below. */
export function execute<T>(
  model: string,
  method: ReadMethod,
  args: unknown[],
  kwargs: Record<string, unknown> = {}
): Promise<T> {
  return executeKw<T>(model, method, args, kwargs);
}

async function executeKw<T>(
  model: string,
  method: string,
  args: unknown[],
  kwargs: Record<string, unknown>
): Promise<T> {
  const config = getOdooConfig();
  if (!config) throw new Error("Odoo is not configured");

  const call = async () => {
    const uid = await authenticate(config);
    return rpc<T>(config.url, {
      service: "object",
      method: "execute_kw",
      args: [config.db, uid, config.apiKey, model, method, args, kwargs],
    });
  };

  try {
    return await call();
  } catch (e) {
    // A stale uid surfaces as an access/session error — retry once with a fresh one.
    if (e instanceof Error && /session|access|expired|uid/i.test(e.message)) {
      clearUid(config);
      return call();
    }
    throw e;
  }
}

export type OdooDomain = unknown[];

export function searchRead<T>(
  model: string,
  domain: OdooDomain,
  fields: string[],
  options: { limit?: number; order?: string; offset?: number } = {}
): Promise<T[]> {
  return execute<T[]>(model, "search_read", [domain], {
    fields,
    limit: options.limit ?? 5000,
    ...(options.order ? { order: options.order } : {}),
    ...(options.offset ? { offset: options.offset } : {}),
  });
}

export function searchCount(model: string, domain: OdooDomain): Promise<number> {
  return execute<number>(model, "search_count", [domain]);
}

/**
 * `lazy: false` is mandatory for multi-dimension grouping — without it Odoo
 * groups by the first dimension only and expects follow-up calls.
 */
export function readGroup<T>(
  model: string,
  domain: OdooDomain,
  fields: string[],
  groupBy: string[]
): Promise<T[]> {
  return execute<T[]>(model, "read_group", [domain, fields, groupBy], { lazy: false });
}

/** The only res.partner fields the portal may change. */
const WRITABLE_PARTNER_FIELDS = new Set(["name", "x_studio_date_of_birth", "comment"]);

export type PartnerFieldPatch = Partial<{
  name: string;
  /** YYYY-MM-DD, or false to clear. */
  x_studio_date_of_birth: string | false;
  /** Family Overview HTML. */
  comment: string;
}>;

/** Update allowlisted fields on one contact. Throws on any other field. */
export async function updatePartnerFields(
  partnerId: number,
  patch: PartnerFieldPatch
): Promise<void> {
  const keys = Object.keys(patch);
  if (!keys.length) return;
  for (const k of keys) {
    if (!WRITABLE_PARTNER_FIELDS.has(k)) {
      throw new Error(`Refusing to write res.partner.${k} — not in the portal allowlist`);
    }
  }
  if (!Number.isInteger(partnerId) || partnerId <= 0) {
    throw new Error("Invalid Odoo partner id");
  }
  const ok = await executeKw<boolean>("res.partner", "write", [[partnerId], patch], {});
  if (!ok) throw new Error(`Odoo refused the update on res.partner ${partnerId}`);
}

/** Field Service project and Experience category — the only place tasks may be created. */
export const FIELD_SERVICE_PROJECT = 2;
export const EXPERIENCE_CATEGORY = 17;

/**
 * Field Service stages the portal may move a task to (odoo_arc.md §4.4), with
 * the matching `state` — Odoo keeps the two separately, so both are written.
 */
const FIELD_SERVICE_STAGES = {
  planned: { stage_id: 17, state: "01_in_progress" },
  done: { stage_id: 19, state: "1_done" },
  cancelled: { stage_id: 20, state: "1_canceled" },
} as const;

export type FieldServiceStage = keyof typeof FIELD_SERVICE_STAGES;

/** Move one Field Service task to a stage. */
export async function setFieldServiceTaskStage(
  taskId: number,
  stage: FieldServiceStage
): Promise<void> {
  if (!Number.isInteger(taskId) || taskId <= 0) throw new Error("Invalid Odoo task id");
  const ok = await executeKw<boolean>(
    "project.task",
    "write",
    [[taskId], { ...FIELD_SERVICE_STAGES[stage] }],
    {}
  );
  if (!ok) throw new Error(`Odoo refused the stage change on project.task ${taskId}`);
}

export interface ExperienceTaskValues {
  name: string;
  subcategory_id: number;
  partner_id: number;
  /** Naive UTC "YYYY-MM-DD HH:MM:SS". */
  planned_date_begin?: string;
  date_deadline?: string;
  description?: string;
  /** hr.employee ids (e.g. "Experience Team"). */
  employee_ids?: number[];
}

/**
 * Create ONE Field Service task in the Experience category. Project and
 * category are fixed here, not taken from the caller; the customer is set on
 * both Customer fields the form requires. Returns the new task id.
 */
export async function createExperienceTask(values: ExperienceTaskValues): Promise<number> {
  const name = values.name.trim();
  if (!name) throw new Error("Task title is required");
  if (!Number.isInteger(values.partner_id) || values.partner_id <= 0) {
    throw new Error("Invalid Odoo customer");
  }
  if (!Number.isInteger(values.subcategory_id) || values.subcategory_id <= 0) {
    throw new Error("Invalid Odoo sub category");
  }
  const record: Record<string, unknown> = {
    name,
    project_id: FIELD_SERVICE_PROJECT,
    category_id: EXPERIENCE_CATEGORY,
    subcategory_id: values.subcategory_id,
    partner_id: values.partner_id,
    x_studio_customer_name: values.partner_id,
    // Real Experience tasks carry the team in employee_ids and leave user_ids
    // empty; without this Odoo auto-assigns the integration user (Tech Team).
    user_ids: [[6, 0, []]],
  };
  if (values.planned_date_begin) record.planned_date_begin = values.planned_date_begin;
  if (values.date_deadline) record.date_deadline = values.date_deadline;
  if (values.description) record.description = values.description;
  if (values.employee_ids?.length) record.employee_ids = [[6, 0, values.employee_ids]];

  const id = await executeKw<number>("project.task", "create", [record], {});
  if (!Number.isInteger(id)) throw new Error("Odoo did not return a task id");
  return id;
}

/** Post an internal note (not an email) in a contact's chatter. Returns the message id. */
export async function postPartnerNote(partnerId: number, bodyHtml: string): Promise<number> {
  if (!Number.isInteger(partnerId) || partnerId <= 0) {
    throw new Error("Invalid Odoo partner id");
  }
  return executeKw<number>("res.partner", "message_post", [[partnerId]], {
    body: bodyHtml,
    message_type: "comment",
    subtype_xmlid: "mail.mt_note",
  });
}
