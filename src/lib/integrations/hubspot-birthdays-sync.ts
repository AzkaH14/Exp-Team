import "server-only";
import { writeFileSync } from "fs";
import { join } from "path";
import { isExcludedHubSpotContact } from "../client-registry/hubspot-blocklist";
import {
  matchRegistryRecord,
  normalizeRegistryName,
  namesMatch,
} from "../client-registry/name-match";
import { getSacredRegistry } from "../client-registry/store";
import type { HubSpotBirthdayRecord } from "../types/client-registry";

const HUBSPOT_API = "https://api.hubapi.com";
const OUT_PATH = join(process.cwd(), "src/data/hubspot-birthdays.json");

const CONTACT_PROPERTIES = [
  "firstname",
  "lastname",
  "benefactor_name",
  "is_benefactor",
  "birthday",
  "date_of_birth",
  "relationship_to_benefactor",
] as const;

interface RawContact {
  firstname: string;
  lastname: string;
  benefactor_name: string;
  is_benefactor: string;
  birthday: string | null;
  date_of_birth: string | null;
  relationship_to_benefactor: string | null;
}

function getToken(): string | undefined {
  return process.env.HUBSPOT_ACCESS_TOKEN?.trim() || undefined;
}

function parseBirthday(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [, m, d] = s.split("-").map(Number);
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    return s;
  }
  const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) {
    const [, a, b, y] = slash;
    const m = Number(a);
    const d = Number(b);
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  // HubSpot sometimes stores midnight UTC timestamps
  if (/^\d+$/.test(s)) {
    const ms = Number(s);
    if (ms > 1e12) {
      const d = new Date(ms);
      if (!Number.isNaN(d.getTime())) {
        return d.toISOString().slice(0, 10);
      }
    }
  }
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return null;
}

async function hubspotSearch(after?: string): Promise<{
  results: RawContact[];
  after?: string;
}> {
  const token = getToken();
  if (!token) return { results: [] };

  const body: Record<string, unknown> = {
    filterGroups: [
      {
        filters: [{ propertyName: "benefactor_name", operator: "HAS_PROPERTY" }],
      },
    ],
    properties: [...CONTACT_PROPERTIES],
    limit: 100,
  };
  if (after) body.after = after;

  const res = await fetch(`${HUBSPOT_API}/crm/v3/objects/contacts/search`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`HubSpot contacts search failed: ${res.status}`);
  }

  const data = (await res.json()) as {
    results?: Array<{ properties: Record<string, string | null> }>;
    paging?: { next?: { after?: string } };
  };

  const results: RawContact[] = (data.results ?? []).map((r) => {
    const p = r.properties;
    return {
      firstname: (p.firstname ?? "").trim(),
      lastname: (p.lastname ?? "").trim(),
      benefactor_name: (p.benefactor_name ?? "").trim(),
      is_benefactor: (p.is_benefactor ?? "").trim(),
      birthday: parseBirthday(p.birthday),
      date_of_birth: parseBirthday(p.date_of_birth),
      relationship_to_benefactor: p.relationship_to_benefactor?.trim() || null,
    };
  });

  return { results, after: data.paging?.next?.after };
}

async function fetchAllContacts(): Promise<RawContact[]> {
  const all: RawContact[] = [];
  let after: string | undefined;
  do {
    const page = await hubspotSearch(after);
    all.push(...page.results);
    after = page.after;
  } while (after);
  return all;
}

function pickBeneficiaryBirthday(
  sacredBeneficiary: string,
  beneficiaries: HubSpotBirthdayRecord["beneficiaries"]
): string | null {
  const parts = sacredBeneficiary
    .split(/[/,]/)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const part of parts) {
    for (const b of beneficiaries) {
      if (b.birthday && namesMatch(part, b.name)) return b.birthday;
    }
  }

  for (const b of beneficiaries) {
    if (b.birthday) return b.birthday;
  }
  return null;
}

function buildFamilyRecords(contacts: RawContact[]): HubSpotBirthdayRecord[] {
  const registry = getSacredRegistry();
  const families = new Map<
    string,
    {
      hubspotKey: string;
      benefactorBirthday: string | null;
      beneficiaries: HubSpotBirthdayRecord["beneficiaries"];
    }
  >();

  for (const c of contacts) {
    if (!c.benefactor_name || isExcludedHubSpotContact(c.benefactor_name)) continue;

    if (!families.has(c.benefactor_name)) {
      families.set(c.benefactor_name, {
        hubspotKey: c.benefactor_name,
        benefactorBirthday: null,
        beneficiaries: [],
      });
    }

    const fam = families.get(c.benefactor_name)!;
    const name = `${c.firstname} ${c.lastname}`.replace(/\s+/g, " ").trim();
    const birthday = c.birthday ?? c.date_of_birth;
    const rel = (c.relationship_to_benefactor ?? "").toLowerCase();
    const looksLikeParent =
      /mother|father|parent|grandmother|grandfather|nani|nana|beneficiary/.test(rel);

    if (c.is_benefactor === "true" && !looksLikeParent) {
      if (birthday) fam.benefactorBirthday = birthday;
    } else if (name) {
      fam.beneficiaries.push({
        name,
        birthday,
        relationship: c.relationship_to_benefactor,
      });
    }
  }

  const records: HubSpotBirthdayRecord[] = [];

  for (const fam of families.values()) {
    const match =
      matchRegistryRecord(fam.hubspotKey, registry) ??
      matchRegistryRecord(fam.hubspotKey.replace(/\s+/g, ""), registry);

    if (!match) continue;

    records.push({
      id: match.id,
      benefactor: match.benefactor,
      beneficiary: match.beneficiary,
      hubspotKey: fam.hubspotKey,
      benefactorBirthday: fam.benefactorBirthday,
      beneficiaries: fam.beneficiaries,
      beneficiaryBirthday:
        pickBeneficiaryBirthday(match.beneficiary, fam.beneficiaries) ??
        (fam.beneficiaries.length === 0 ? fam.benefactorBirthday : null),
    });
  }

  records.sort((a, b) => a.benefactor.localeCompare(b.benefactor));

  // Merge duplicate HubSpot families mapping to the same sacred client
  const byId = new Map<string, HubSpotBirthdayRecord>();
  for (const rec of records) {
    const existing = byId.get(rec.id);
    if (!existing) {
      byId.set(rec.id, rec);
      continue;
    }
    if (!existing.benefactorBirthday && rec.benefactorBirthday) {
      existing.benefactorBirthday = rec.benefactorBirthday;
    }
    if (!existing.beneficiaryBirthday && rec.beneficiaryBirthday) {
      existing.beneficiaryBirthday = rec.beneficiaryBirthday;
    }
    const seen = new Set(existing.beneficiaries.map((b) => b.name));
    for (const b of rec.beneficiaries) {
      if (!seen.has(b.name)) {
        existing.beneficiaries.push(b);
        seen.add(b.name);
      }
    }
    if (!existing.beneficiaryBirthday) {
      existing.beneficiaryBirthday = pickBeneficiaryBirthday(
        existing.beneficiary,
        existing.beneficiaries
      );
    }
  }

  return [...byId.values()].sort((a, b) => a.benefactor.localeCompare(b.benefactor));
}

export async function syncHubSpotBirthdays(): Promise<{
  records: HubSpotBirthdayRecord[];
  summary: {
    hubspotContactFamilies: number;
    matchedSacredClients: number;
    withBenefactorBirthday: number;
    withBeneficiaryBirthday: number;
  };
}> {
  const contacts = await fetchAllContacts();
  const familyKeys = new Set(contacts.map((c) => c.benefactor_name).filter(Boolean));
  const records = buildFamilyRecords(contacts);

  const summary = {
    hubspotContactFamilies: familyKeys.size,
    matchedSacredClients: records.length,
    withBenefactorBirthday: records.filter((r) => r.benefactorBirthday).length,
    withBeneficiaryBirthday: records.filter((r) => r.beneficiaryBirthday).length,
  };

  const payload = {
    syncedAt: new Date().toISOString(),
    summary,
    clients: records,
  };

  writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2));

  return { records, summary };
}

export function isHubSpotBirthdaysConfigured(): boolean {
  return Boolean(getToken());
}

/** Match a beneficiary HubSpot contact name to sacred registry parts */
export function beneficiaryNameOverlap(a: string, b: string): boolean {
  return namesMatch(a, b) || normalizeRegistryName(a) === normalizeRegistryName(b);
}
