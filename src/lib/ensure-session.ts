import "server-only";
import { cache } from "react";
import { ensureCachedSession, getDataSyncMeta } from "./data-source";

/** Fast path: static/cached tickets only — never blocks on HubSpot or sheet sync */
export const ensureSession = cache(async () => ensureCachedSession());

/** @deprecated Alias for ensureSession */
export const ensureSessionCached = ensureSession;
