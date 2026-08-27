import type { LearnedAction } from "../types/engagement";

const STORAGE_KEY = "mohsyn-engagement-learning";

function readStore(): LearnedAction[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as LearnedAction[]) : [];
  } catch {
    return [];
  }
}

function writeStore(actions: LearnedAction[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(actions));
}

export function getLearnedActions(client?: string): LearnedAction[] {
  const all = readStore();
  if (!client) return all;
  return all.filter((a) => a.client === client);
}

export function recordLearnedAction(
  client: string,
  action: string,
  outcome: string
): LearnedAction {
  const entry: LearnedAction = {
    client,
    action,
    outcome,
    recordedAt: new Date().toISOString(),
  };
  const all = readStore();
  all.unshift(entry);
  writeStore(all.slice(0, 200));
  return entry;
}
