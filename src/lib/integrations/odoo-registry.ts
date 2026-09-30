/**
 * The client registry, read from Odoo — replaces the Google "sacred" sheet
 * and the HubSpot auto-add.
 *
 * A client is an Odoo contact tagged Benefactor. Its lifecycle tag gives the
 * status (Active / Paused / Gratis / Churned); its family relations give the
 * beneficiaries; x_studio_date_of_birth gives birthdays; the Notes field
 * ("Family Overview" on the form) and the chatter give the profile.
 *
 * Registry ids stay the slug ids the rest of the app is keyed on. A benefactor
 * already in the registry keeps its id (matched by Odoo partner id, then by
 * name), so local data and pre-cutover tickets keep attaching to it.
 */
import "server-only";
import { writeFileSync } from "fs";
import { join } from "path";
import type {
  ClientRegistryRecord,
  OdooChatterNote,
  OdooFamilyMember,
  OdooFamilyProfile,
} from "../types/client-registry";
import { matchRegistryRecord, slugFromBenefactor } from "../client-registry/name-match";
import { filterSacredRegistryClients } from "../client-registry/hubspot-blocklist";
import { dropForeignAliases } from "../client-registry/registry-supplement";
import {
  buildRegistrySummary,
  getSacredRegistryIncludingCancelled,
  setSacredRegistryCache,
} from "../client-registry/store";
import {
  ODOO_FAMILIES_PATH,
  setOdooFamiliesCache,
  type OdooFamiliesFile,
} from "../client-registry/odoo-families";
import { interestsFromSections, parseOverviewSections } from "../client-registry/odoo-overview";
import { normalizeCity } from "./historical-sheet";
import { stripOdooHtml } from "./odoo-sync";
import { isOdooConfigured, m2oId, m2oName, searchRead, str, type Many2One } from "./odoo";

const REGISTRY_PATH = join(process.cwd(), "src/data/client-registry.json");

const REGISTRY_CITIES: ClientRegistryRecord["city"][] = [
  "Islamabad",
  "Karachi",
  "Lahore",
  "Lodhran",
  "Gujranwala",
  "Faisalabad",
];

interface OdooTag {
  id: number;
  name: string;
}

interface OdooPartnerRow {
  id: number;
  name: string | false;
  city?: string | false;
  category_id: number[];
  x_benefactor_id?: string | false;
  x_studio_date_of_birth?: string | false;
  x_studio_onboarding_date?: string | false;
  comment?: string | false;
  email?: string | false;
}

interface OdooRelationRow {
  id: number;
  partner_id: Many2One;
  related_partner_id: Many2One;
  relationship_id: Many2One;
  sequence?: number | false;
}

interface OdooMessageRow {
  id: number;
  res_id: number;
  body: string | false;
  date: string | false;
  author_id: Many2One;
}

export interface OdooRegistrySyncResult {
  ok: boolean;
  error?: string;
  clientCount: number;
  summary: Record<string, unknown>;
  /** Benefactors with no beneficiary linked in Odoo — a data-entry gap. */
  withoutBeneficiaries: string[];
  /** Benefactors that did not match an existing registry id (got a new slug). */
  newIds: string[];
  syncedAt: string;
}

function registryCity(raw: string): ClientRegistryRecord["city"] {
  const city = normalizeCity(raw);
  return (REGISTRY_CITIES as string[]).includes(city)
    ? (city as ClientRegistryRecord["city"])
    : "Other";
}

function statusFromTags(tagNames: Set<string>): ClientRegistryRecord["status"] {
  if (tagNames.has("churned")) return "cancelled";
  if (tagNames.has("paused")) return "pause";
  if (tagNames.has("gratis")) return "gratis";
  return "active";
}

function tierFromStatus(status: ClientRegistryRecord["status"]): ClientRegistryRecord["serviceTier"] {
  if (status === "gratis") return "premium_gratis";
  if (status === "pause") return "pause";
  return "premium";
}

function isoDate(value: unknown): string | null {
  const s = str(value);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

async function fetchTags(): Promise<Map<number, string>> {
  const tags = await searchRead<OdooTag>("res.partner.category", [], ["name"], { limit: 500 });
  return new Map(tags.map((t) => [t.id, t.name.trim().toLowerCase()]));
}

function tagId(tags: Map<number, string>, name: string): number | null {
  for (const [id, n] of tags) if (n === name) return id;
  return null;
}

/** Chunk a large `in` domain so one request never carries thousands of ids. */
async function searchReadIn<T>(
  model: string,
  field: string,
  ids: number[],
  extra: unknown[],
  fields: string[],
  options: { order?: string } = {}
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    out.push(
      ...(await searchRead<T>(model, [[field, "in", chunk], ...extra], fields, {
        limit: 20000,
        ...options,
      }))
    );
  }
  return out;
}

/**
 * Keep existing registry ids. Partner id first (stable once an Odoo sync has
 * run), then the fuzzy name matcher the ticket pipeline already trusts.
 */
function resolveRegistryId(
  partner: OdooPartnerRow,
  name: string,
  previous: ClientRegistryRecord[],
  taken: Set<string>
): { id: string; previous: ClientRegistryRecord | null } {
  const byPartner = previous.find((r) => r.odooPartnerId === partner.id);
  const candidate = byPartner ?? matchRegistryRecord(name, previous);
  if (candidate && !taken.has(candidate.id)) {
    return { id: candidate.id, previous: candidate };
  }
  let id = slugFromBenefactor(name) || `odoo-${partner.id}`;
  if (taken.has(id)) id = `${id}-${partner.id}`;
  return { id, previous: null };
}

function noteFromMessage(m: OdooMessageRow): OdooChatterNote | null {
  const body = stripOdooHtml(str(m.body).replace(/<img[^>]*>/gi, "")).trim();
  if (body.length < 3) return null;
  const date = str(m.date);
  return {
    id: m.id,
    body,
    createdAt: date ? `${date.replace(" ", "T")}Z` : null,
    author: m2oName(m.author_id) || null,
  };
}

export async function syncOdooRegistry(options: { writeFile?: boolean } = {}): Promise<OdooRegistrySyncResult> {
  const syncedAt = new Date().toISOString();
  const fail = (error: string): OdooRegistrySyncResult => ({
    ok: false,
    error,
    clientCount: 0,
    summary: {},
    withoutBeneficiaries: [],
    newIds: [],
    syncedAt,
  });

  if (!isOdooConfigured()) return fail("Odoo is not configured");

  try {
    const tags = await fetchTags();
    const benefactorTag = tagId(tags, "benefactor");
    const beneficiaryTag = tagId(tags, "beneficiary");
    const testTag = tagId(tags, "test");
    if (benefactorTag === null) return fail('Odoo has no "Benefactor" contact tag');

    const partnerFields = [
      "name",
      "city",
      "category_id",
      "x_benefactor_id",
      "x_studio_date_of_birth",
      "x_studio_onboarding_date",
      "comment",
      "email",
    ];
    const benefactors = (
      await searchRead<OdooPartnerRow>(
        "res.partner",
        [["category_id", "in", [benefactorTag]]],
        partnerFields,
        { limit: 5000, order: "name asc" }
      )
    ).filter((p) => testTag === null || !p.category_id.includes(testTag));

    const benefactorIds = benefactors.map((p) => p.id);

    // Relations where the benefactor is the subject: "benefactor's <relationship> is related".
    // Odoo's auto-generated mirrors are kept — a mirror is still true of this benefactor.
    const relations = await searchReadIn<OdooRelationRow>(
      "prodo.partner.family.relation",
      "partner_id",
      benefactorIds,
      [],
      ["partner_id", "related_partner_id", "relationship_id", "sequence"],
      { order: "sequence asc, id asc" }
    );

    const relatedIds = [
      ...new Set(
        relations
          .map((r) => m2oId(r.related_partner_id))
          .filter((id): id is number => id !== null)
      ),
    ];
    const relatedPartners = await searchReadIn<OdooPartnerRow>(
      "res.partner",
      "id",
      relatedIds,
      [],
      ["name", "category_id", "x_studio_date_of_birth"]
    );
    const relatedById = new Map(relatedPartners.map((p) => [p.id, p]));

    const messages = await searchReadIn<OdooMessageRow>(
      "mail.message",
      "res_id",
      benefactorIds,
      [
        ["model", "=", "res.partner"],
        ["message_type", "in", ["comment", "email"]],
      ],
      ["res_id", "body", "date", "author_id"],
      { order: "date desc" }
    );
    const notesByPartner = new Map<number, OdooChatterNote[]>();
    for (const m of messages) {
      const note = noteFromMessage(m);
      if (!note) continue;
      const list = notesByPartner.get(m.res_id) ?? [];
      list.push(note);
      notesByPartner.set(m.res_id, list);
    }

    const previous = getSacredRegistryIncludingCancelled();
    const taken = new Set<string>();
    let records: ClientRegistryRecord[] = [];
    const families: OdooFamilyProfile[] = [];
    const withoutBeneficiaries: string[] = [];
    const newIds: string[] = [];

    for (const p of benefactors) {
      const name = str(p.name).trim();
      if (!name) continue;

      const { id, previous: prev } = resolveRegistryId(p, name, previous, taken);
      taken.add(id);
      if (!prev) newIds.push(id);

      const tagNames = new Set(p.category_id.map((t) => tags.get(t) ?? ""));
      const status = statusFromTags(tagNames);

      const seen = new Set<number>();
      const members: OdooFamilyMember[] = [];
      for (const rel of relations) {
        if (m2oId(rel.partner_id) !== p.id) continue;
        const relatedId = m2oId(rel.related_partner_id);
        if (relatedId === null || relatedId === p.id || seen.has(relatedId)) continue;
        seen.add(relatedId);
        const related = relatedById.get(relatedId);
        members.push({
          partnerId: relatedId,
          name: str(related?.name).trim() || m2oName(rel.related_partner_id),
          relationship: m2oName(rel.relationship_id) || "Relative",
          birthday: isoDate(related?.x_studio_date_of_birth),
          isBeneficiary: beneficiaryTag !== null && Boolean(related?.category_id.includes(beneficiaryTag)),
        });
      }
      const beneficiaries = members.some((m) => m.isBeneficiary)
        ? members.filter((m) => m.isBeneficiary)
        : members;
      if (!beneficiaries.length) withoutBeneficiaries.push(name);

      const code = str(p.x_benefactor_id).trim() || null;
      const aliases = [
        ...new Set(
          [
            ...(prev?.aliases ?? []),
            // Old spelling keeps pre-cutover HubSpot tickets attached.
            prev && prev.benefactor !== name ? prev.benefactor : "",
          ].filter(Boolean)
        ),
      ];
      const email = str(p.email).trim();

      records.push({
        id,
        benefactor: name,
        beneficiary: beneficiaries.map((m) => m.name).join(" / "),
        city: registryCity(str(p.city)),
        signupDate: isoDate(p.x_studio_onboarding_date),
        serviceTier: tierFromStatus(status),
        status,
        country: null,
        linkedin: null,
        biraUrl: null,
        aliases,
        contactEmails: email.includes("@") ? [email] : undefined,
        source: "odoo",
        // Portal-only scheduling config, not client data — carried over.
        engagementCities: prev?.engagementCities,
        odooPartnerId: p.id,
        benefactorCode: code,
      });

      const overviewSections = parseOverviewSections(str(p.comment));
      families.push({
        registryId: id,
        partnerId: p.id,
        benefactorCode: code,
        benefactor: name,
        benefactorBirthday: isoDate(p.x_studio_date_of_birth),
        members,
        overviewSections,
        interests: interestsFromSections(overviewSections),
        notes: notesByPartner.get(p.id) ?? [],
      });
    }

    records = dropForeignAliases(records);
    const visible = filterSacredRegistryClients(records);
    const summary = {
      ...buildRegistrySummary(visible),
      source: "odoo",
      odooBenefactors: benefactors.length,
      withoutBeneficiaries: withoutBeneficiaries.length,
    };

    const shouldWrite =
      options.writeFile === true || (options.writeFile !== false && !process.env.VERCEL);
    if (shouldWrite) {
      writeFileSync(
        REGISTRY_PATH,
        JSON.stringify(
          {
            version: 4,
            updatedAt: syncedAt.slice(0, 10),
            source: "Odoo res.partner (Benefactor tag)",
            summary,
            clients: records,
          },
          null,
          2
        )
      );
      const familiesFile: OdooFamiliesFile = { syncedAt, families };
      writeFileSync(ODOO_FAMILIES_PATH, JSON.stringify(familiesFile, null, 2));
    }

    setSacredRegistryCache(records, summary);
    setOdooFamiliesCache(families, syncedAt);

    return {
      ok: true,
      clientCount: visible.length,
      summary,
      withoutBeneficiaries,
      newIds,
      syncedAt,
    };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Odoo registry sync failed");
  }
}

/**
 * Registry source switch. Default is Odoo whenever it is configured;
 * MOHSYN_REGISTRY_SOURCE=sheet restores the Google Sheet + HubSpot path.
 */
export function isOdooRegistryEnabled(): boolean {
  return process.env.MOHSYN_REGISTRY_SOURCE?.trim() !== "sheet" && isOdooConfigured();
}
