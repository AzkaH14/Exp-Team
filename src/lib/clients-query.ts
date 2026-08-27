import "server-only";
import { getSessionDerived } from "./session-metrics";
import type { ClientQoLListItem } from "./types/client-list";

export function getClientListSlim(): ClientQoLListItem[] {
  return getSessionDerived()?.clientListSlim ?? [];
}
