import "server-only";
import riskAssessmentJson from "@/data/client-risk-assessment.json";
import type { HubSpotBirthdayRecord } from "../types/client-registry";
import { canonicalRegistryId, legacyRegistryId } from "./registry-id-aliases";

interface RiskAssessmentFile {
  importedAt?: string;
  summary?: Record<string, number>;
  clients: Array<
    HubSpotBirthdayRecord & {
      sourceFile?: string;
    }
  >;
}

let runtimeMap: Map<string, HubSpotBirthdayRecord> | null = null;

function loadFromFile(): Map<string, HubSpotBirthdayRecord> {
  const file = riskAssessmentJson as RiskAssessmentFile;
  const map = new Map<string, HubSpotBirthdayRecord>();
  for (const client of file.clients) {
    map.set(legacyRegistryId(client.id), client);
    map.set(canonicalRegistryId(client.id), client);
  }
  return map;
}

export function setRiskAssessmentCache(
  records: Array<HubSpotBirthdayRecord & { sourceFile?: string }>
): void {
  runtimeMap = new Map(records.map((c) => [c.id, c]));
}

export function getRiskAssessmentMap(): Map<string, HubSpotBirthdayRecord> {
  return runtimeMap ?? loadFromFile();
}

export function getRiskAssessmentForClient(id: string): HubSpotBirthdayRecord | undefined {
  return getRiskAssessmentMap().get(id);
}

export function getRiskAssessmentMeta() {
  const file = riskAssessmentJson as RiskAssessmentFile;
  return {
    importedAt: file.importedAt ?? null,
    summary: file.summary ?? {},
  };
}
