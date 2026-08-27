/** Doctors and clinicians coordinators can assign on doctor-call events */
export const ENGAGEMENT_DOCTORS = [
  "Dr Abdullah",
  "Dr Danish",
  "Abdul Aziz",
  "Dr Wajeeha",
  "Dr Javeria",
  "Isha Ajmal",
  "Linta Ajmal",
  "Iqra Memon",
] as const;

export type EngagementDoctor = (typeof ENGAGEMENT_DOCTORS)[number];

const DEFAULT_DOCTOR_BY_CITY: Record<string, string> = {
  Islamabad: "Dr Abdullah",
  Lahore: "Dr Danish",
  Karachi: "Abdul Aziz",
};

function normalizeCity(city: string): string | null {
  const c = city.trim().toLowerCase();
  if (c.includes("islamabad") || c === "isb") return "Islamabad";
  if (c.includes("lahore") || c === "lhr") return "Lahore";
  if (c.includes("karachi") || c === "khi") return "Karachi";
  return null;
}

export function defaultDoctorForCity(city: string): string {
  const normalized = normalizeCity(city);
  if (normalized) return DEFAULT_DOCTOR_BY_CITY[normalized];
  return "Dr Abdullah";
}

export function listDoctorsForPicker(city: string): string[] {
  const def = defaultDoctorForCity(city);
  const all = new Set<string>([def, ...ENGAGEMENT_DOCTORS]);
  return [...all];
}
