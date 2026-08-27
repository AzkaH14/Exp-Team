import type {
  ClientRegistryRecord,
  ClientRegistryStatus,
  ClientServiceTier,
} from "../types/client-registry";
import { namesMatch } from "./name-match";
import { isExcludedHubSpotContact } from "./hubspot-blocklist";

const MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

function cleanName(raw: string): string {
  return raw
    .replace(/\r/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*\([^)]*gratis[^)]*\)/gi, "")
    .replace(/\s*\([^)]*cancel[^)]*\)/gi, "")
    .replace(/\s*\([^)]*refund[^)]*\)/gi, "")
    .replace(/\s*\([^)]*hold[^)]*\)/gi, "")
    .replace(/\s*\([^)]*pause[^)]*\)/gi, "")
    .trim();
}

function parseSignupDate(raw: string | undefined): string | null {
  if (!raw?.trim()) return null;
  const s = raw.trim().replace(/\r/g, " ").replace(/\s+/g, " ");

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const m = s.match(
    /(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})/
  );
  if (m) {
    const day = Number(m[1]);
    const mo = MONTHS[m[2].toLowerCase()];
    const year = Number(m[3]);
    if (mo && day >= 1 && day <= 31) {
      return `${year}-${String(mo).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

function parseCitySection(label: string): ClientRegistryRecord["city"] | null {
  const s = label.toLowerCase().replace(/\s+/g, " ").trim();
  if (!s || s.includes("overview") || s === "city") return null;
  if (/islamabad|rawalpindi/.test(s)) return "Islamabad";
  if (/lahore/.test(s)) return "Lahore";
  if (/karachi/.test(s)) return "Karachi";
  if (/lodhran/.test(s)) return "Lodhran";
  if (/gujranwala|gujran/.test(s)) return "Gujranwala";
  if (/faisalabad|lyallpur/.test(s)) return "Faisalabad";
  if (/other|multan|abbottabad|abbotabbad/.test(s)) return "Other";
  return null;
}

function parseStatus(
  sno: string,
  benefactor: string,
  service: string
): ClientRegistryStatus {
  const blob = `${sno} ${benefactor} ${service}`.toLowerCase();
  if (/unsub|cancel/.test(blob)) return "cancelled";
  if (/gratis|ambassador/.test(blob)) return "gratis";
  if (/pause|hold/.test(blob)) return "pause";
  return "active";
}

function parseTier(service: string): ClientServiceTier {
  if (/gratis/i.test(service)) return "premium_gratis";
  return "premium";
}

function isSkipRow(cells: string[]): boolean {
  const joined = cells.join(" ").toLowerCase().trim();
  if (!joined) return true;

  const benefactor = (cells[1] ?? "").replace(/\s+/g, " ").trim().toLowerCase();

  if (/^client overview|^overview/.test(joined)) return true;
  if (/total number of|live \(with gratis\)/.test(joined)) {
    return true;
  }
  // Overview table header (City | Premium | Premium Gratis | …)
  if (/^city\s*,?\s*premium/.test(joined)) return true;
  // Footer stat rows (e.g. benefactor column = "7", "107", "Total")
  if (/^(total|active|pause|gratis|city|premium)$/.test(benefactor)) {
    return true;
  }
  return false;
}

function isValidBenefactor(name: string): boolean {
  if (!name || name.length < 2) return false;
  if (/^\d+$/.test(name)) return false;
  if (/^(total|active|pause|gratis|overview|city|premium)$/i.test(name)) {
    return false;
  }
  return true;
}

/** S.No is a row number or a status label (Pause, Unsubscribed, Gratis, …) */
function hasValidSno(sno: string): boolean {
  const s = sno.trim();
  if (/^\d+$/.test(s)) return true;
  if (/pause|unsub|gratis|potential/i.test(s)) return true;
  return false;
}

/** Staff / departed contacts — see hubspot-blocklist.ts */
function isBlockedSheetBenefactor(name: string): boolean {
  return isExcludedHubSpotContact(name);
}

/** Start a new benefactor row when numbered/status row or unnumbered with signup date */
function isNewBenefactorRow(
  sno: string,
  signupRaw: string,
  benefactor: string
): boolean {
  if (!isValidBenefactor(benefactor) || isBlockedSheetBenefactor(benefactor)) {
    return false;
  }
  if (hasValidSno(sno)) return true;
  return parseSignupDate(signupRaw) !== null;
}

function findHeaderRow(rows: string[][]): number {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const h = rows[i].map((c) => c.toLowerCase());
    if (h.some((c) => c.includes("benefactor"))) return i;
  }
  return 0;
}

function colIndex(headers: string[], ...needles: string[]): number {
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].replace(/\s+/g, " ").trim();
    if (needles.some((n) => h === n || h === `${n} `)) return i;
  }
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].replace(/\s+/g, " ").trim();
    if (needles.some((n) => h.includes(n))) return i;
  }
  return -1;
}

function beneficiaryColIndex(headers: string[]): number {
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].replace(/\s+/g, " ").trim();
    if (h === "beneficiary" || h === "beneficiary ") return i;
  }
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].replace(/\s+/g, " ").trim();
    if (h.startsWith("beneficiary") && !h.includes("relation")) return i;
  }
  return -1;
}

export interface MohsynSheetClient {
  benefactor: string;
  beneficiaries: string[];
  city: ClientRegistryRecord["city"];
  signupDate: string | null;
  status: ClientRegistryStatus;
  serviceTier: ClientServiceTier;
}

/** Parse Mohsyn live sacred sheet CSV (city sections + multi-row beneficiaries) */
export function parseMohsynSacredSheet(
  rows: string[][]
): MohsynSheetClient[] {
  if (rows.length < 2) return [];

  const headerIdx = findHeaderRow(rows);
  const headers = rows[headerIdx].map((h) =>
    h.toLowerCase().replace(/\s+/g, " ").trim()
  );

  const iSno = colIndex(headers, "s. no", "s.no", "s no");
  const iBenefactor = colIndex(headers, "benefactor");
  const iSignup = colIndex(headers, "signup");
  const iBeneficiary = beneficiaryColIndex(headers);
  const iService = colIndex(headers, "service");

  if (iBenefactor < 0) {
    throw new Error(`Sacred sheet: no Benefactor column. Headers: ${headers.join(", ")}`);
  }

  let currentCity: ClientRegistryRecord["city"] = "Islamabad";
  const clients: MohsynSheetClient[] = [];
  let current: MohsynSheetClient | null = null;

  const flush = () => {
    if (!current || !current.benefactor) return;
    clients.push(current);
    current = null;
  };

  for (const row of rows.slice(headerIdx + 1)) {
    if (isSkipRow(row)) continue;

    const sno = (iSno >= 0 ? row[iSno] : "") ?? "";
    const benefactorRaw = (row[iBenefactor] ?? "").trim();
    const beneficiaryRaw = (iBeneficiary >= 0 ? row[iBeneficiary] : "") ?? "";
    const signupRaw = (iSignup >= 0 ? row[iSignup] : "") ?? "";
    const serviceRaw = (iService >= 0 ? row[iService] : "") ?? "";

    const cityFromSection = parseCitySection(benefactorRaw || sno);
    if (cityFromSection && !beneficiaryRaw.trim() && !signupRaw.trim()) {
      currentCity = cityFromSection;
      flush();
      continue;
    }

    const benefactor = cleanName(benefactorRaw);
    const beneficiary = cleanName(beneficiaryRaw);

    if (benefactor) {
      if (!isNewBenefactorRow(sno, signupRaw, benefactor)) continue;
      flush();
      current = {
        benefactor,
        beneficiaries: beneficiary ? [beneficiary] : [],
        city: currentCity,
        signupDate: parseSignupDate(signupRaw),
        status: parseStatus(sno, benefactorRaw, serviceRaw),
        serviceTier: parseTier(serviceRaw),
      };
    } else if (beneficiary && current) {
      current.beneficiaries.push(beneficiary);
    } else if (beneficiary && !current) {
      // orphan beneficiary row — skip
      continue;
    }
  }

  flush();

  // Deduplicate by benefactor (last row wins — sheet order)
  const byName = new Map<string, MohsynSheetClient>();
  for (const c of clients) {
    const key = c.benefactor.toLowerCase();
    byName.set(key, c);
  }

  return [...byName.values()].sort((a, b) =>
    a.benefactor.localeCompare(b.benefactor)
  );
}

export function mohsynClientsToRegistry(
  parsed: MohsynSheetClient[],
  supplement: Record<
    string,
    {
      aliases?: string[];
      canonicalBenefactor?: string;
      status?: ClientRegistryStatus;
      tier?: ClientServiceTier;
      beneficiary?: string;
      city?: ClientRegistryRecord["city"];
      contactEmails?: string[];
    }
  >
): Omit<ClientRegistryRecord, "id">[] {
  return parsed.map((c) => {
    const sup = findSupplement(c.benefactor, supplement);
    const beneficiary =
      sup.beneficiary ??
      (c.beneficiaries.filter(Boolean).join(" / ") || "TBC");

    return {
      benefactor: sup.canonicalBenefactor ?? c.benefactor,
      beneficiary,
      city: sup.city ?? c.city,
      signupDate: c.signupDate,
      serviceTier: sup.tier ?? c.serviceTier,
      status: sup.status ?? c.status,
      country: null,
      linkedin: null,
      biraUrl: null,
      aliases: [...new Set(sup.aliases ?? [])],
      contactEmails: (sup as { contactEmails?: string[] }).contactEmails,
      engagementCities: (sup as { engagementCities?: ClientRegistryRecord["city"][] }).engagementCities,
      source: "sacred" as const,
    };
  });
}

function findSupplement(
  benefactor: string,
  supplement: Record<
    string,
    {
      aliases?: string[];
      canonicalBenefactor?: string;
      status?: ClientRegistryStatus;
      tier?: ClientServiceTier;
      beneficiary?: string;
      city?: ClientRegistryRecord["city"];
      contactEmails?: string[];
    }
  >
) {
  if (supplement[benefactor]) return supplement[benefactor];

  for (const [key, sup] of Object.entries(supplement)) {
    if (namesMatch(key, benefactor)) return sup;
    if (sup.aliases?.some((alias) => namesMatch(alias, benefactor))) return sup;
  }

  return {};
}
