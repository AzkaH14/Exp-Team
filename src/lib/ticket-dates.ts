/**
 * The board groups analytics by the `month` string and sorts on `created`.
 * Every ticket source MUST produce byte-identical output here or the cutover
 * shows up as a fake gap in every time series.
 *
 * These mirror formatDisplayDate() / formatMonth() in integrations/hubspot-sync.ts.
 * Do not copy them again — import from here.
 */
import { CUTOVER_TZ } from "./cutover";

/** "01 Nov 2025" */
export function formatDisplayDate(epochMs: number | null): string {
  if (epochMs === null || Number.isNaN(epochMs)) return "";
  try {
    return new Date(epochMs).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: CUTOVER_TZ,
    });
  } catch {
    return "";
  }
}

/** "Nov 2025" */
export function formatMonth(epochMs: number | null): string {
  if (epochMs === null || Number.isNaN(epochMs)) return "";
  try {
    return new Date(epochMs).toLocaleDateString("en-GB", {
      month: "short",
      year: "numeric",
      timeZone: CUTOVER_TZ,
    });
  } catch {
    return "";
  }
}

/**
 * Odoo returns naive UTC with no zone marker ("2026-08-19 07:48:34").
 * Without the Z, JS parses it as local time and shifts every ticket.
 */
export function parseOdooDatetime(value: unknown): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const ms = Date.parse(value.trim().replace(" ", "T") + "Z");
  return Number.isNaN(ms) ? null : ms;
}
