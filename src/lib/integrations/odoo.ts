/**
 * Odoo JSON-RPC client.
 *
 * Not REST: one URL, one HTTP method. Every operation is a POST to
 * {ODOO_URL}/jsonrpc with a different body. See odoo_instruct.md §8.
 *
 * READ-ONLY BY CONVENTION. Only search_read / search_count / read_group /
 * fields_get are exposed here. The credential has full rights, so this file
 * is the guardrail — do not add a write helper.
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

/** Any read method on any model. Writes are deliberately unreachable. */
export async function execute<T>(
  model: string,
  method: ReadMethod,
  args: unknown[],
  kwargs: Record<string, unknown> = {}
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
