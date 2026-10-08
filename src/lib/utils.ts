import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

const LOCALE = "en-GB";
const TIMEZONE = "Asia/Karachi";

/** Deterministic formatting — avoids SSR/client hydration mismatches */
export function formatNumber(n: number): string {
  return n.toLocaleString(LOCALE);
}

/** e.g. 17:18:47 — same output in Node SSR and browser */
export function formatSyncTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString(LOCALE, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      timeZone: TIMEZONE,
    });
  } catch {
    return "—";
  }
}

export function formatPct(n: number, digits = 1): string {
  return `${n.toFixed(digits)}%`;
}

/**
 * A Field Service task in Odoo. `/odoo/project/2/<id>` opens the project
 * record itself (an empty-looking project form) — the task lives under the
 * project's "tasks" action.
 */
export function odooTaskUrl(odooUrl: string, taskId: number): string {
  return `${odooUrl}/odoo/project/2/tasks/${taskId}`;
}
