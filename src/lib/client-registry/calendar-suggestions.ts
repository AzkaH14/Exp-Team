import type { EngagementSuggestion } from "../types/engagement";

interface CalendarEvent {
  id: string;
  title: string;
  month: number;
  day: number;
  scope: "all" | "beneficiary" | "benefactor";
}

/** Fixed observances — broadcast to all clients */
const UNIVERSAL_EVENTS: CalendarEvent[] = [
  { id: "womens-day", title: "International Women's Day outreach", month: 3, day: 8, scope: "all" },
  { id: "mothers-day", title: "Mother's Day gesture / call", month: 5, day: 11, scope: "beneficiary" },
  { id: "fathers-day", title: "Father's Day gesture / call", month: 6, day: 15, scope: "beneficiary" },
];

export function getUpcomingUniversalSuggestions(
  now = new Date(),
  windowDays = 45
): EngagementSuggestion[] {
  const year = now.getFullYear();
  const suggestions: EngagementSuggestion[] = [];

  for (const ev of UNIVERSAL_EVENTS) {
    const eventDate = new Date(year, ev.month - 1, ev.day);
    const diff = (eventDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    if (diff >= -7 && diff <= windowDays) {
      suggestions.push({
        id: ev.id,
        title: ev.title,
        rationale:
          ev.scope === "all"
            ? "Portfolio-wide observance — send thoughtful message or small gesture to all active clients."
            : `Upcoming ${ev.title} — plan personalised outreach for eligible families.`,
        channel: "whatsapp",
        priority: diff <= 14 ? "high" : "medium",
      });
    }
  }

  return suggestions;
}

export function getPersonalDateSuggestions(input: {
  benefactorBirthday?: string | null;
  beneficiaryBirthday?: string | null;
  anniversary?: string | null;
  benefactor: string;
  beneficiary: string;
}): EngagementSuggestion[] {
  const suggestions: EngagementSuggestion[] = [];
  const now = new Date();

  const check = (iso: string | null | undefined, label: string, id: string) => {
    if (!iso) return;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return;
    const thisYear = new Date(now.getFullYear(), d.getMonth(), d.getDate());
    const diff = (thisYear.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    if (diff >= 0 && diff <= 30) {
      suggestions.push({
        id,
        title: `${label} coming up`,
        rationale: `${label} for ${input.beneficiary || input.benefactor} in ${Math.round(diff)} days — schedule call, gift, or experience.`,
        channel: "call",
        priority: diff <= 7 ? "high" : "medium",
      });
    }
  };

  check(input.beneficiaryBirthday, "Beneficiary birthday", "beneficiary-bday");

  return suggestions;
}

export function getHobbySuggestions(input: {
  hobbies: string[];
  interests: string[];
  indoorOnly?: boolean;
  city: string;
}): EngagementSuggestion[] {
  const suggestions: EngagementSuggestion[] = [];
  const all = [...input.hobbies, ...input.interests].map((s) => s.toLowerCase());

  const add = (id: string, title: string, rationale: string, channel: EngagementSuggestion["channel"]) => {
    suggestions.push({ id, title, rationale, channel, priority: "medium" });
  };

  if (all.some((h) => /art|craft|creative|doll/.test(h))) {
    add(
      "art-workshop",
      "Invite to art / craft workshop",
      `Client profile suggests creative interests — arrange a small-group art session or craft kit delivery in ${input.city}.`,
      "visit"
    );
  }
  if (all.some((h) => /qawali|cultural|music/.test(h))) {
    add(
      "cultural-event",
      "Curated cultural evening",
      "Past engagement shows openness to qawali and cultural events — share upcoming listings.",
      "whatsapp"
    );
  }
  if (all.some((h) => /coffee|cappuccino/.test(h))) {
    add(
      "coffee-outing",
      "Specialty coffee outing",
      "Profile notes coffee preference — pair FSO visit with café outing.",
      "visit"
    );
  }
  if (all.some((h) => /conversation|intellectual|indoor/.test(h))) {
    add(
      "in-home-visit",
      "Meaningful in-home visit",
      "Client responds best to respectful conversation at home — book unhurried FSO visit.",
      "visit"
    );
  }
  if (!input.indoorOnly && all.some((h) => /outdoor|outing|social/.test(h))) {
    add(
      "social-outing",
      "Light social outing",
      "Encourage a short outing aligned with mobility and preferences.",
      "visit"
    );
  }
  if (all.length === 0) {
    add(
      "experience-menu",
      "Share experience menu (plays, movies, workshops)",
      "Hobbies not yet captured — send curated list of plays, exhibitions, and workshops; log preferences in Client Profiles.",
      "email"
    );
  } else {
    add(
      "plays-movies",
      "Theatre / cinema options",
      "Share current play and movie listings matching stated interests.",
      "whatsapp"
    );
  }

  return suggestions.slice(0, 4);
}
