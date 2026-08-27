/**
 * HubSpot → Odoo boundary. The historical sheet supplies everything BEFORE
 * this instant; Odoo supplies everything ON OR AFTER it.
 *
 * 15 Aug 2026 is where HubSpot actually stopped: sheet volume collapses
 * 31 → 1 on this day while Odoo jumps 22 → 52. Aug 8-14 is a double-entry
 * window where ops ran both systems, served by the sheet because it is the
 * more complete source there (208 rows vs Odoo's 128 across Aug 8-13).
 *
 * Splits the 7,630-row sheet 7,626 / 4 — the 4 stragglers (Aug 15 x1,
 * Aug 17 x3) are dropped. Verified 20 Aug 2026 — see odoo_instruct.md §3.
 *
 * This is the ONLY place a boundary date may be defined.
 */

/** Local (Asia/Karachi) calendar date on which Odoo becomes the source. */
export const CUTOVER_DATE = process.env.MOHSYN_CUTOVER_DATE?.trim() || "2026-08-15";

/** Operating timezone. HubSpot exports and the board's date formatting both use it. */
export const CUTOVER_TZ = "Asia/Karachi";

/** Asia/Karachi is UTC+5 year-round — no DST since 2010. */
const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;

/**
 * Parse a `YYYY-MM-DD[ HH:mm[:ss]]` string as Asia/Karachi wall-clock time.
 * Returns epoch ms. Used for the sheet's `Create date`, which carries no zone.
 */
export function parsePktTimestamp(value: string): number | null {
  const m = String(value)
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  const [, y, mo, d, hh, mm, ss] = m;
  return (
    Date.UTC(
      Number(y),
      Number(mo) - 1,
      Number(d),
      Number(hh ?? 0),
      Number(mm ?? 0),
      Number(ss ?? 0)
    ) - PKT_OFFSET_MS
  );
}

/** The boundary as epoch ms (midnight Asia/Karachi on CUTOVER_DATE). */
export const CUTOVER_MS = parsePktTimestamp(CUTOVER_DATE)!;

/**
 * The boundary as the naive-UTC string Odoo domains expect.
 * `2026-08-15 00:00 PKT` -> `2026-08-14 19:00:00`.
 *
 * Passing CUTOVER_DATE straight into an Odoo domain instead of this value
 * silently pulls in 5 hours of tickets the sheet already covers.
 */
export const CUTOVER_ODOO_UTC = new Date(CUTOVER_MS)
  .toISOString()
  .slice(0, 19)
  .replace("T", " ");

/** True when a ticket belongs to the frozen historical (sheet) era. */
export function isHistorical(epochMs: number): boolean {
  return epochMs < CUTOVER_MS;
}
