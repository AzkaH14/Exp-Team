import supplementJson from "@/data/client-registry-supplement.json";
import type { ClientRegistryRecord } from "../types/client-registry";
import { namesMatch, slugFromBenefactor } from "./name-match";

type SupplementEntry = {
  aliases?: string[];
  canonicalBenefactor?: string;
  status?: ClientRegistryRecord["status"];
  tier?: ClientRegistryRecord["serviceTier"];
  beneficiary?: string;
  city?: ClientRegistryRecord["city"];
  contactEmails?: string[];
  engagementCities?: ClientRegistryRecord["city"][];
};

interface SupplementFile {
  byBenefactor?: Record<string, SupplementEntry>;
  additionalClients?: Array<Partial<ClientRegistryRecord> & { benefactor: string; id?: string }>;
}

function findSupplementEntry(
  benefactor: string,
  supplement: Record<string, SupplementEntry>
): SupplementEntry {
  if (supplement[benefactor]) return supplement[benefactor];

  for (const [key, entry] of Object.entries(supplement)) {
    if (namesMatch(key, benefactor)) return entry;
  }

  return {};
}

/** Merge supplement aliases and HubSpot-only families onto the sacred registry */
export function applyRegistrySupplement(
  clients: ClientRegistryRecord[]
): ClientRegistryRecord[] {
  const file = supplementJson as SupplementFile;
  const byBenefactor = file.byBenefactor ?? {};
  const additional = file.additionalClients ?? [];

  const merged = clients.map((client) => {
    const sup = findSupplementEntry(client.benefactor, byBenefactor);
    const aliases = [...new Set([...client.aliases, ...(sup.aliases ?? [])])];
    const benefactor = sup.canonicalBenefactor ?? client.benefactor;
    const changed =
      benefactor !== client.benefactor ||
      aliases.length !== client.aliases.length ||
      (sup.beneficiary && sup.beneficiary !== client.beneficiary) ||
      (sup.city && sup.city !== client.city) ||
      (sup.contactEmails &&
        JSON.stringify(sup.contactEmails) !==
          JSON.stringify(client.contactEmails ?? [])) ||
      (sup.status && sup.status !== client.status) ||
      (sup.tier && sup.tier !== client.serviceTier) ||
      (sup.engagementCities &&
        JSON.stringify(sup.engagementCities) !==
          JSON.stringify(client.engagementCities ?? []));

    if (!changed) return client;

    return {
      ...client,
      benefactor,
      beneficiary: sup.beneficiary ?? client.beneficiary,
      city: sup.city ?? client.city,
      contactEmails: sup.contactEmails ?? client.contactEmails,
      status: sup.status ?? client.status,
      serviceTier: sup.tier ?? client.serviceTier,
      engagementCities: sup.engagementCities ?? client.engagementCities,
      aliases,
    };
  });

  const withAdditional = [...merged];
  for (const extra of additional) {
    const alreadyPresent = withAdditional.some(
      (client) =>
        namesMatch(client.benefactor, extra.benefactor) ||
        client.aliases.some((alias) => namesMatch(alias, extra.benefactor))
    );
    if (alreadyPresent) continue;

    withAdditional.push({
      benefactor: extra.benefactor,
      beneficiary: extra.beneficiary ?? "TBC",
      city: extra.city ?? "Other",
      signupDate: extra.signupDate ?? null,
      serviceTier: extra.serviceTier ?? "premium",
      status: extra.status ?? "active",
      country: extra.country ?? null,
      linkedin: extra.linkedin ?? null,
      biraUrl: extra.biraUrl ?? null,
      aliases: extra.aliases ?? [],
      contactEmails: extra.contactEmails ?? [],
      source: "sacred",
      id: extra.id ?? slugFromBenefactor(extra.benefactor),
    });
  }

  return withAdditional;
}
