/** Score HubSpot ticket notes so Dr Isha-style session analyses beat finance boilerplate. */
export function scoreClinicalNote(note: string): number {
  const text = note.replace(/\s+/g, " ").trim();
  const lower = text.toLowerCase();
  if (!text) return -100;

  let score = 0;
  if (text.length >= 80) score += 8;
  if (text.length >= 200) score += 12;
  if (text.length >= 500) score += 18;

  if (
    /cognitive rehabilitation|session report|orientation training|clock drawing test|delayed recall|semantic memory|fruit naming task|environmental cues|compensatory strategies/.test(
      lower
    )
  ) {
    score += 90;
  }

  if (/during today.s \d+-minute|scored \d+\/\d+/.test(lower)) score += 45;
  if (/range of motion|\brom\b exercises?|upper and lower extremities/.test(lower)) score += 35;
  if (/\b(conducted|assessment|participated|cooperative|engaged|recommended)\b/.test(lower)) {
    score += 20;
  }

  if (
    /finance (?:has been |group has been )?updated|shared (?:the )?details with (?:the )?finance|closing this ticket/.test(
      lower
    ) &&
    text.length < 180
  ) {
    score -= 120;
  }

  return score;
}

export function rankClinicalNotes(notes: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const note of notes) {
    const trimmed = note.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase().slice(0, 220);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(trimmed);
  }

  const ranked = unique
    .map((note) => ({ note, score: scoreClinicalNote(note) }))
    .sort((a, b) => b.score - a.score || b.note.length - a.note.length);

  const clinical = ranked.filter((row) => row.score >= 20).map((row) => row.note);
  if (clinical.length) return clinical;

  const substantive = ranked
    .filter((row) => row.score > -50 && row.note.length >= 40)
    .map((row) => row.note);
  if (substantive.length) return substantive;

  return ranked.filter((row) => row.score > -80).map((row) => row.note);
}
