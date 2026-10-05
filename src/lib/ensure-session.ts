import "server-only";
import { cache } from "react";
import { getDataSyncMeta, warmSession } from "./data-source";

/**
 * Warm this serverless instance before a page reads any data. A warm instance
 * reuses its cache instantly; a cold one waits for the live Odoo pull (one
 * shared fetch, however many callers). Pages must await this themselves —
 * Next renders the layout and page in parallel, so a warm started only in the
 * layout would land after the page had already rendered the frozen baseline.
 */
export const ensureSession = cache(async () => warmSession());

/** @deprecated Alias for ensureSession */
export const ensureSessionCached = ensureSession;
