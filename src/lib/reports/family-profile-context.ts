import "server-only";
import { getMergedProfileById } from "../client-registry/merge";
import type { FamilyProfileContext } from "./types";

function formatBirthday(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function buildFamilyProfileContext(registryId: string): FamilyProfileContext {
  const profile = getMergedProfileById(registryId);
  if (!profile) {
    return {
      registryId,
      benefactor: "",
      beneficiary: "",
      city: "",
      serviceTier: "",
      status: "",
      hobbies: [],
      interests: [],
      engagementNotes: [],
      medicalHighlights: [],
      generalOverview: null,
      prefersLowTouch: false,
      indoorOnly: false,
      biraBeneficiaries: [],
      biraSourceFile: null,
      biraUrl: null,
      profileCompleteness: 0,
      missingFields: [],
      hasInternalProfile: false,
      hasBira: false,
    };
  }

  if (profile.odoo) {
    // Odoo registry mode: the Family Overview and family relations are the profile.
    const family = profile.odoo;
    const tagged = family.members.filter((m) => m.isBeneficiary);
    const people = (tagged.length ? tagged : family.members).map((m) => ({
      name: m.name,
      birthday: m.birthday,
      birthdayLabel: formatBirthday(m.birthday),
    }));
    const section = (re: RegExp) =>
      family.overviewSections.find((s) => re.test(s.heading))?.body ?? null;
    const medical = section(/medical|health/i);
    const overviewText =
      section(/general overview|client overview|^overview$/i) ??
      family.overviewSections[0]?.body ??
      null;
    const allText = family.overviewSections.map((s) => s.body).join("\n");
    return {
      registryId: profile.id,
      benefactor: profile.benefactor,
      beneficiary: profile.beneficiary,
      city: profile.city,
      serviceTier: profile.serviceTier,
      status: profile.status,
      hobbies: [],
      interests: family.interests,
      engagementNotes: profile.resolvedEngagementNotes,
      medicalHighlights: medical
        ? medical
            .split("\n")
            .map((l) => l.replace(/^[-•*]\s*/, "").trim())
            .filter(Boolean)
        : [],
      generalOverview: overviewText,
      prefersLowTouch: /low[- ]touch/i.test(allText),
      indoorOnly: false,
      biraBeneficiaries: people,
      biraSourceFile: null,
      biraUrl: null,
      profileCompleteness: profile.profileCompleteness,
      missingFields: profile.missingFields,
      hasInternalProfile: family.overviewSections.length > 0 || family.notes.length > 0,
      hasBira: people.length > 0,
    };
  }

  const enrichment = profile.enrichment;
  const bira = profile.riskAssessment as
    | (typeof profile.riskAssessment & { sourceFile?: string })
    | null;

  const hubspotBeneficiaries = (profile.hubspot?.beneficiaries ?? []).map((b) => ({
    name: b.name,
    birthday: b.birthday,
    birthdayLabel: formatBirthday(b.birthday),
  }));
  const noteBeneficiaryNames = profile.hubspotNotes?.beneficiaryNames ?? [];
  const biraBeneficiaries =
    (bira?.beneficiaries ?? []).length > 0
      ? (bira?.beneficiaries ?? []).map((b) => ({
          name: b.name,
          birthday: b.birthday,
          birthdayLabel: formatBirthday(b.birthday),
        }))
      : hubspotBeneficiaries.length > 0
        ? hubspotBeneficiaries
        : noteBeneficiaryNames.map((name) => ({
            name,
            birthday: null as string | null,
            birthdayLabel: null as string | null,
          }));

  return {
    registryId: profile.id,
    benefactor: profile.benefactor,
    beneficiary: profile.beneficiary,
    city: profile.city,
    serviceTier: profile.serviceTier,
    status: profile.status,
    hobbies: enrichment?.hobbies ?? profile.overrides.hobbies ?? [],
    interests: enrichment?.interests ?? [],
    engagementNotes: profile.resolvedEngagementNotes,
    medicalHighlights: enrichment?.medicalHighlights ?? [],
    generalOverview: enrichment?.generalOverview ?? null,
    prefersLowTouch: enrichment?.prefersLowTouch ?? false,
    indoorOnly: enrichment?.indoorOnly ?? false,
    biraBeneficiaries,
    biraSourceFile: bira?.sourceFile ?? null,
    biraUrl: profile.biraUrl,
    profileCompleteness: profile.profileCompleteness,
    missingFields: profile.missingFields,
    hasInternalProfile: Boolean(enrichment) || Boolean(profile.hubspotNotes?.notes.length),
    hasBira: biraBeneficiaries.length > 0,
  };
}
