import type { MedicalSessionNote } from "./types";
import { parseTicketDate } from "./ticket-match";

export type ClinicalTrajectory = "improving" | "stable" | "mixed" | "needs_attention" | "insufficient_data";

export interface SessionInsight {
  dateLabel: string;
  ticketNumber: string;
  practitioner: string | null;
  signal: "positive" | "neutral" | "concern";
  summary: string;
}

export interface ClinicalProgressAnalysis {
  trajectory: ClinicalTrajectory;
  trajectoryLabel: string;
  summary: string;
  insights: SessionInsight[];
  positiveCount: number;
  concernCount: number;
  sessionCount: number;
  recommendedActions: string[];
}

const POSITIVE_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\bimprov(?:ed|ing|ement)\b/i, label: "improvement noted" },
  { re: /\bbetter\b/i, label: "patient doing better" },
  { re: /\bprogress(?:ing)?\b/i, label: "progress reported" },
  { re: /\bstable\b/i, label: "condition stable" },
  { re: /\bincreased\s+(?:mobility|range|strength)\b/i, label: "mobility/strength gains" },
  { re: /\bconducted\b|\bcompleted\b|\bheld\b/i, label: "session completed" },
  { re: /\bpositive\b/i, label: "positive session" },
  { re: /\bdischarg(?:ed|e)\b/i, label: "discharge milestone" },
];

const CONCERN_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\bdeclin(?:ed|ing)\b/i, label: "decline reported" },
  { re: /\bworsen(?:ed|ing)\b/i, label: "worsening symptoms" },
  { re: /\bpain\b/i, label: "pain mentioned" },
  { re: /\bfell?\b|\bfall\b/i, label: "fall risk" },
  { re: /\bmissed\b|\bcancelled\b|\bno[- ]show\b/i, label: "missed session" },
  { re: /\burgent\b|\bemergency\b/i, label: "urgent concern" },
  { re: /\bunable\b|\bdifficulty\b|\bstruggling\b/i, label: "functional difficulty" },
  { re: /\bconcern\b|\balert\b/i, label: "clinical concern flagged" },
];

function analyzeNoteText(text: string): { signal: SessionInsight["signal"]; hits: string[] } {
  const blob = text.trim();
  if (!blob || blob.length < 8) {
    return { signal: "neutral", hits: [] };
  }

  const positive: string[] = [];
  const concerns: string[] = [];

  for (const p of POSITIVE_PATTERNS) {
    if (p.re.test(blob)) positive.push(p.label);
  }
  for (const p of CONCERN_PATTERNS) {
    if (p.re.test(blob)) concerns.push(p.label);
  }

  if (concerns.length > positive.length) {
    return { signal: "concern", hits: concerns.slice(0, 3) };
  }
  if (positive.length > 0) {
    return { signal: "positive", hits: positive.slice(0, 3) };
  }
  if (/\bscheduled\b|\bvisit\b|\bsession\b/i.test(blob)) {
    return { signal: "neutral", hits: ["session logged"] };
  }
  return { signal: "neutral", hits: [] };
}

function trajectoryFromCounts(
  positive: number,
  concern: number,
  sessionCount: number
): ClinicalTrajectory {
  if (sessionCount === 0) return "insufficient_data";
  if (concern >= 2 && concern > positive) return "needs_attention";
  if (positive >= 2 && positive > concern) return "improving";
  if (concern === 0 && positive >= 1) return "improving";
  if (positive === 0 && concern >= 1) return "needs_attention";
  if (positive > 0 && concern > 0) return "mixed";
  return "stable";
}

const TRAJECTORY_LABELS: Record<ClinicalTrajectory, string> = {
  improving: "Improving — positive signals across recent sessions",
  stable: "Steady — sessions on track with routine progress",
  mixed: "Mixed — some gains alongside areas needing focus",
  needs_attention: "Needs attention — concerns flagged in recent notes",
  insufficient_data: "Insufficient clinical notes for automated analysis",
};

function buildSummary(
  trajectory: ClinicalTrajectory,
  sessions: MedicalSessionNote[],
  positive: number,
  concern: number
): string {
  if (trajectory === "insufficient_data") {
    return "No substantive clinical notes were found in closed tickets for this period. Run HubSpot sync so ticket Notes tab content is pulled in, or ask the care team to add session notes on each closed ticket.";
  }

  const practitioners = [
    ...new Set(sessions.map((s) => s.practitioner).filter(Boolean) as string[]),
  ];
  const clinicianPart =
    practitioners.length > 0
      ? ` Notes from ${practitioners.slice(0, 3).join(", ")} were reviewed.`
      : "";

  const countPart = `${sessions.length} clinical session${sessions.length === 1 ? "" : "s"} analysed`;
  const signalPart =
    positive > 0 || concern > 0
      ? ` — ${positive} positive signal${positive === 1 ? "" : "s"}, ${concern} concern${concern === 1 ? "" : "s"}.`
      : ".";

  return `${countPart}${signalPart}${clinicianPart} ${TRAJECTORY_LABELS[trajectory]}`;
}

function recommendedActions(
  trajectory: ClinicalTrajectory,
  sessions: MedicalSessionNote[]
): string[] {
  const actions: string[] = [];
  if (trajectory === "needs_attention") {
    actions.push("Review flagged sessions with the assigned physiotherapist and field doctor.");
    actions.push("Confirm family has been updated on any change in care plan.");
  }
  if (trajectory === "mixed") {
    actions.push("Maintain exercises that are working; add focused work on domains with concern flags.");
  }
  if (trajectory === "improving") {
    actions.push("Continue current session frequency and home exercise plan.");
  }
  if (sessions.length < 2 && trajectory !== "insufficient_data") {
    actions.push("Low session volume this period — consider scheduling consistency review.");
  }
  if (!actions.length && trajectory === "stable") {
    actions.push("Continue monitoring; no immediate intervention indicated from ticket notes.");
  }
  return actions;
}

export function analyzeClinicalProgress(
  physioSessions: MedicalSessionNote[],
  medicalSessions: MedicalSessionNote[]
): ClinicalProgressAnalysis {
  const clinical = [...physioSessions, ...medicalSessions].filter(
    (s) => s.notes.trim().length > 12
  );

  const sorted = [...clinical].sort((a, b) => {
    const da = parseTicketDate(a.date)?.getTime() ?? 0;
    const db = parseTicketDate(b.date)?.getTime() ?? 0;
    return da - db;
  });

  const insights: SessionInsight[] = [];
  let positiveCount = 0;
  let concernCount = 0;

  for (const session of sorted) {
    const blob = `${session.sessionTitle} ${session.notes}`;
    const { signal, hits } = analyzeNoteText(blob);
    if (signal === "positive") positiveCount++;
    if (signal === "concern") concernCount++;

    if (hits.length === 0 && session.notes.length < 20) continue;

    insights.push({
      dateLabel: session.dateLabel,
      ticketNumber: session.ticketNumber,
      practitioner: session.practitioner,
      signal,
      summary:
        hits.length > 0
          ? hits.join("; ")
          : session.notes.slice(0, 120) + (session.notes.length > 120 ? "…" : ""),
    });
  }

  const trajectory = trajectoryFromCounts(positiveCount, concernCount, sorted.length);

  return {
    trajectory,
    trajectoryLabel: TRAJECTORY_LABELS[trajectory],
    summary: buildSummary(trajectory, sorted, positiveCount, concernCount),
    insights: insights.slice(-8),
    positiveCount,
    concernCount,
    sessionCount: sorted.length,
    recommendedActions: recommendedActions(trajectory, sorted),
  };
}
