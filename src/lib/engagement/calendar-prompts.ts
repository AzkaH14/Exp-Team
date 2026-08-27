import { getMergedProfileById } from "../client-registry/merge";
import { getUpcomingUniversalSuggestions } from "../client-registry/calendar-suggestions";
import { UNDERUTILISING_INACTIVE_DAYS } from "./constants";

const PROMPT_WINDOW_DAYS = 21;

function daysUntilNextAnnual(iso: string | null | undefined, now = new Date()): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  let next = new Date(now.getFullYear(), d.getMonth(), d.getDate());
  // If already passed this year (or earlier today by clock), roll to next year
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (next < todayStart) {
    next = new Date(now.getFullYear() + 1, d.getMonth(), d.getDate());
  }
  return Math.round((next.getTime() - todayStart.getTime()) / (1000 * 60 * 60 * 24));
}

function datePrompt(
  iso: string | null | undefined,
  label: string,
  windowDays = PROMPT_WINDOW_DAYS
): string | null {
  const diff = daysUntilNextAnnual(iso);
  if (diff == null || diff < 0 || diff > windowDays) return null;
  if (diff === 0) return `${label} today`;
  if (diff === 1) return `${label} tomorrow`;
  return `${label} in ${diff}d`;
}

/**
 * Short scheduling hints — birthday/anniversary when near, plus re-engage if quiet.
 * Keeps noise low: at most one date prompt + optional underutilising line.
 */
export function calendarPromptForClient(input: {
  registryId: string;
  underutilising: boolean;
  daysSinceTouch: number | null;
}): string | null {
  const profile = getMergedProfileById(input.registryId);
  const parts: string[] = [];

  const dateHints = [
    datePrompt(profile?.resolvedBeneficiaryBirthday, "Beneficiary birthday"),
    datePrompt(profile?.resolvedBenefactorBirthday, "Benefactor birthday"),
    datePrompt(
      profile?.overrides.anniversary ?? profile?.enrichment?.anniversary ?? null,
      "Anniversary"
    ),
  ].filter((h): h is string => Boolean(h));

  // Prefer the soonest date (already ordered by check order; pick first = beneficiary first)
  if (dateHints[0]) parts.push(dateHints[0]);

  if (input.underutilising) {
    const days = input.daysSinceTouch;
    if (days == null) parts.push("No touch on record — schedule a check-in");
    else parts.push(`No touch in ${days}d — re-engage`);
  }

  return parts.length ? parts.join(" · ") : null;
}

/** Portfolio-wide observances within a week — shown once at the top of the calendar */
export function calendarWeekObservanceBanner(now = new Date()): string | null {
  const upcoming = getUpcomingUniversalSuggestions(now, 7);
  const high = upcoming.find((s) => s.priority === "high") ?? upcoming[0];
  return high?.title ?? null;
}

export function isUnderutilisingByDays(
  daysSinceTouch: number | null,
  inactiveDays = UNDERUTILISING_INACTIVE_DAYS
): boolean {
  if (daysSinceTouch == null) return true;
  return daysSinceTouch >= inactiveDays;
}
