import type { ClientRegistryRecord } from "../types/client-registry";

/** Split HubSpot compact labels: "SyedaZehra Ali" → "Syeda Zehra Ali" */
export function formatHubSpotBenefactorLabel(raw: string): string {
  const s = raw.replace(/\s+/g, " ").trim();
  if (!s) return s;
  return s
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

/** Normalize names for fuzzy benefactor/beneficiary ↔ HubSpot matching */
export function normalizeRegistryName(name: string): string {
  if (!name) return "";
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(dr|mr|mrs|ms|miss|syed|muhammad|mohammad|md)\b/gi, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function registryNameTokens(name: string): Set<string> {
  const n = normalizeRegistryName(name);
  return new Set(n.split(" ").filter((t) => t.length > 1));
}

export function compactRegistryName(name: string): string {
  return normalizeRegistryName(name).replace(/\s+/g, "");
}

export function namesMatch(a: string, b: string): boolean {
  const na = normalizeBeneficiarySpelling(a);
  const nb = normalizeBeneficiarySpelling(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  if (compactRegistryName(a) === compactRegistryName(b)) return true;

  const ta = registryNameTokens(a);
  const tb = registryNameTokens(b);
  if (!ta.size || !tb.size) return false;

  let overlap = 0;
  for (const t of ta) {
    if (tb.has(t)) overlap++;
  }
  const minSize = Math.min(ta.size, tb.size);
  return overlap >= Math.max(2, minSize - 1);
}

/** HubSpot vs sacred-registry spelling drift (e.g. Shahnaz / Shehnaz) */
function normalizeBeneficiarySpelling(name: string): string {
  return normalizeRegistryName(name)
    .replace(/\bshahnaz\b/g, "shehnaz")
    .replace(/\bshehnaz\b/g, "shehnaz");
}

export function expandBeneficiaryNameVariants(name: string): string[] {
  const base = name.trim();
  if (!base) return [];
  const variants = new Set<string>([base]);
  const norm = normalizeBeneficiarySpelling(base);
  variants.add(norm);
  if (/shahnaz|shehnaz/i.test(base)) {
    variants.add(base.replace(/shahnaz/gi, "Shehnaz"));
    variants.add(base.replace(/shehnaz/gi, "Shahnaz"));
    variants.add("Ms Shehnaz");
    variants.add("Ms Shahnaz");
    variants.add("Shehnaz Wasim");
    variants.add("Shahnaz Wasim");
  }
  return [...variants];
}

export function slugFromBenefactor(name: string): string {
  return normalizeRegistryName(name).replace(/\s+/g, "-");
}

const TEST_PATTERNS = [
  /^test\b/i,
  /\btest\s*user/i,
  /\bdemo\b/i,
  /\bsample\b/i,
  /^unknown$/i,
  /^n\/a$/i,
];

export function isTestSuspectName(name: string): boolean {
  const n = name.trim();
  if (!n || n.length < 2) return true;
  return TEST_PATTERNS.some((p) => p.test(n));
}

export function isMohsynDuplicateLabel(name: string): boolean {
  return /^mohsyn\s+x\s+/i.test(name.trim());
}

/** Expand HubSpot contact labels (Mohsyn x …, semicolons, parentheticals) into match candidates */
export function parseHubSpotClientLabel(name: string): string[] {
  const candidates: string[] = [];
  const raw = name.trim();
  if (!raw) return candidates;

  if (raw.includes(";")) {
    for (const part of raw.split(";")) {
      candidates.push(...parseHubSpotClientLabel(part.trim()));
    }
    return [...new Set(candidates.filter(Boolean))];
  }

  const stripped = raw.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  if (stripped) candidates.push(stripped);

  const mohsyn = stripped.match(/^mohsyn\s+x\s+(.+)$/i);
  if (mohsyn) {
    const inner = mohsyn[1].replace(/\.$/, "").trim();
    if (inner) candidates.push(inner);
    if (inner.includes("/")) {
      for (const part of inner.split("/")) {
        const p = part.trim();
        if (p) candidates.push(p);
      }
    }
  }

  return [...new Set(candidates.filter(Boolean))];
}

export function hubSpotMatchLabels(hubspotName: string): string[] {
  const formatted = formatHubSpotBenefactorLabel(hubspotName);
  return [
    ...new Set(
      [
        hubspotName,
        formatted,
        ...parseHubSpotClientLabel(hubspotName),
        ...parseHubSpotClientLabel(formatted),
      ].filter(Boolean)
    ),
  ];
}

export function matchRegistryRecord(
  hubspotName: string,
  registry: ClientRegistryRecord[]
): ClientRegistryRecord | null {
  const labels = hubSpotMatchLabels(hubspotName);
  const exact = (label: string, names: (r: ClientRegistryRecord) => string[]) => {
    const norm = normalizeRegistryName(label);
    const compact = compactRegistryName(label);
    if (!norm) return null;
    return (
      registry.find((r) =>
        names(r).some(
          (n) => normalizeRegistryName(n) === norm || compactRegistryName(n) === compact
        )
      ) ?? null
    );
  };

  // 1. A family whose benefactor IS this name always wins. Without this tier an
  //    alias or beneficiary on another family could claim the ticket first —
  //    e.g. "Syeda Zehra Ali" (her own Odoo benefactor) was filed under Bilal
  //    Iqbal Hameed via a stale alias, and "Syed Masood Ahmed" under Ibrahim
  //    Masood via a beneficiary name.
  for (const label of labels) {
    const hit = exact(label, (r) => [r.benefactor]);
    if (hit) return hit;
  }
  // 2. Exact alias / beneficiary hits before fuzzy token overlap.
  for (const label of labels) {
    const hit = exact(label, (r) => [r.beneficiary, ...r.aliases]);
    if (hit) return hit;
  }

  for (const label of labels) {
    for (const r of registry) {
      const names = [r.benefactor, r.beneficiary, ...r.aliases];
      if (names.some((n) => namesMatch(label, n))) return r;
    }
  }
  return null;
}

export function canonicalizeHubSpotClientName(
  hubspotName: string,
  registry: ClientRegistryRecord[]
): string {
  const formatted = formatHubSpotBenefactorLabel(hubspotName);
  return matchRegistryRecord(formatted, registry)?.benefactor ?? formatted;
}

/** Exact-key lookup map for fast ticket client canonicalization. */
export function buildRegistryCanonicalMap(
  registry: ClientRegistryRecord[]
): Map<string, string> {
  const map = new Map<string, string>();
  const add = (name: string, benefactor: string) => {
    const norm = normalizeRegistryName(name);
    const compact = compactRegistryName(name);
    if (norm) map.set(norm, benefactor);
    if (compact) map.set(compact, benefactor);
  };
  // Aliases first, benefactors last — a real benefactor name must overwrite an
  // alias of the same spelling on another family (see matchRegistryRecord).
  for (const r of registry) for (const alias of r.aliases) add(alias, r.benefactor);
  for (const r of registry) add(r.benefactor, r.benefactor);
  return map;
}

export function canonicalizeHubSpotClientNameFast(
  hubspotName: string,
  exactMap: Map<string, string>,
  registry: ClientRegistryRecord[]
): string {
  const formatted = formatHubSpotBenefactorLabel(hubspotName);
  for (const label of hubSpotMatchLabels(formatted)) {
    const norm = normalizeRegistryName(label);
    const compact = compactRegistryName(label);
    const hit =
      (norm && exactMap.get(norm)) || (compact && exactMap.get(compact));
    if (hit) return hit;
  }
  // Fall back to fuzzy match only when exact keys miss
  return matchRegistryRecord(formatted, registry)?.benefactor ?? formatted;
}
