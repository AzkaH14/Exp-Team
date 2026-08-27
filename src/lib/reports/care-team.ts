import "server-only";

export type CareCity = "Islamabad" | "Lahore" | "Karachi";

export interface CityCareTeam {
  physiotherapist: string;
  fieldDoctor: string;
}

const CITY_TEAMS: Record<CareCity, CityCareTeam> = {
  Islamabad: {
    physiotherapist: "Isha Ajmal",
    fieldDoctor: "Dr Abdullah",
  },
  Lahore: {
    physiotherapist: "Linta Ajmal",
    fieldDoctor: "Dr Danish",
  },
  Karachi: {
    physiotherapist: "Iqra Memon",
    fieldDoctor: "Abdul Aziz",
  },
};

export const SENIOR_CONSULTANTS = "Dr Wajeeha · Dr Javeria";
export const WELLNESS_COUNSELLOR = "Dr Farwa";

export function normalizeCareCity(city: string): CareCity | null {
  const c = city.trim().toLowerCase();
  if (c.includes("islamabad") || c === "isb") return "Islamabad";
  if (c.includes("lahore") || c === "lhr") return "Lahore";
  if (c.includes("karachi") || c === "khi") return "Karachi";
  return null;
}

export function careTeamForCity(city: string): CityCareTeam & { cityLabel: string } {
  const normalized = normalizeCareCity(city);
  if (normalized) {
    return { ...CITY_TEAMS[normalized], cityLabel: normalized };
  }
  return {
    physiotherapist: "Mohsyn physiotherapy team",
    fieldDoctor: "Mohsyn field doctor",
    cityLabel: city || "Unassigned",
  };
}
