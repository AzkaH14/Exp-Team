import "server-only";
import { getSessionDerived } from "./session-metrics";
import type { ClientQoLProfile } from "./types/qol";

export function getAllClientProfiles(): ClientQoLProfile[] {
  const derived = getSessionDerived();
  if (!derived) return [];
  return Array.from(derived.profilesBySlug.values());
}

export function getClientProfileBySlug(slug: string): ClientQoLProfile | null {
  return getSessionDerived()?.profilesBySlug.get(slug) ?? null;
}

export function getClientProfileByName(name: string): ClientQoLProfile | null {
  return getAllClientProfiles().find((p) => p.client === name) ?? null;
}
