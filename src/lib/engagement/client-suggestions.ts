import "server-only";
import { getAnalyticsData } from "../analytics-data";
import { getSessionDerived } from "../session-metrics";
import { computeQoLForClient } from "../qol-engine";
import type {
  EngagementCity,
  EngagementClient,
  EngagementPageResult,
  EngagementSegment,
} from "../types/engagement";
import { slugify } from "../utils";
import {
  engagementCityMatches,
  resolveEngagementClientMeta,
} from "./client-meta";
import { generateIntelligenceSuggestions } from "./intelligence";
import { classifySegment, getTopClientNames } from "./segmentation";
import { buildLastTicketByRegistryId, daysSinceLastTicket, isUnderutilisingClient } from "./last-activity";
import { getCityLead } from "./team";
import {
  buildUnderutilisingCrossCheck,
  getUnderutilisingSheetEntries,
  isOnUnderutilisingSheet,
} from "./underutilising-sheet";
import { collectUnderutilisingCandidates } from "./underutilising-candidates";

const PAGE_SIZE = 12;

function buildEngagementClientFromCandidate(
  candidate: ReturnType<typeof collectUnderutilisingCandidates>[number],
  segment: EngagementSegment,
  topMap: Map<string, string>,
  lastByRegistry: Map<string, Date>,
  qolMap: Map<string, { overall: number }> | undefined
): EngagementClient {
  const meta = resolveEngagementClientMeta(candidate.hubspotKey);
  const displayCity = meta.registryId ? meta.city : candidate.analyticsCity;
  const qol =
    qolMap?.get(candidate.hubspotKey) ??
    computeQoLForClient(candidate.hubspotKey, candidate.tickets);
  const topServices = topMap.get(candidate.hubspotKey) ?? "General FSO Assistance";
  const inactiveDays = daysSinceLastTicket(candidate.hubspotKey, lastByRegistry);

  return {
    client: meta.benefactor,
    slug: slugify(meta.benefactor),
    city: displayCity,
    email: candidate.email,
    tickets: candidate.tickets,
    segment,
    cityLead: getCityLead(displayCity),
    suggestions: generateIntelligenceSuggestions(
      meta.benefactor,
      segment,
      candidate.tickets,
      displayCity,
      topServices
    ),
    topServices,
    qolOverall: qol.overall,
    status:
      meta.status === "unknown"
        ? "active"
        : meta.status === "potential_pause"
          ? "pause"
          : meta.status,
    isPaused: meta.isPaused,
    daysSinceLastTicket: inactiveDays,
    onOpsSheet: candidate.onOpsSheet,
  };
}

export function getEngagementClientsPage(
  segment: EngagementSegment,
  city: EngagementCity = "all",
  page = 1
): EngagementPageResult {
  const analytics = getAnalyticsData();
  const topMap = new Map(
    analytics.topClients.map((c) => [c.client, c.topServices])
  );
  const topNames = getTopClientNames();
  const lastByRegistry = buildLastTicketByRegistryId();
  const sheetEntries = getUnderutilisingSheetEntries();

  if (segment === "underutilising") {
    const candidates = collectUnderutilisingCandidates(
      city,
      sheetEntries,
      lastByRegistry
    );

    const sorted = [...candidates].sort((a, b) => {
      const daysA =
        daysSinceLastTicket(a.hubspotKey, lastByRegistry) ?? 9999;
      const daysB =
        daysSinceLastTicket(b.hubspotKey, lastByRegistry) ?? 9999;
      return daysB - daysA;
    });

    const total = sorted.length;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const safePage = Math.min(Math.max(1, page), totalPages);
    const start = (safePage - 1) * PAGE_SIZE;
    const qolMap = getSessionDerived()?.qolByClient;

    const clients = sorted
      .slice(start, start + PAGE_SIZE)
      .map((c) =>
        buildEngagementClientFromCandidate(
          c,
          segment,
          topMap,
          lastByRegistry,
          qolMap
        )
      );

    const allUnderutilising = sorted.map((c) => ({
      client: c.hubspotKey,
      email: c.email,
    }));

    const ticketBasedUnderutilising = analytics.clients
      .filter((c) => {
        const meta = resolveEngagementClientMeta(c.client);
        if (
          meta.isPaused ||
          meta.isGratis ||
          meta.isCancelled ||
          meta.status === "potential_pause"
        ) {
          return false;
        }
        return isUnderutilisingClient(c.client, lastByRegistry);
      })
      .map((c) => ({ client: c.client, email: c.email }));

    return {
      clients,
      total,
      page: safePage,
      pageSize: PAGE_SIZE,
      totalPages,
      segment,
      city,
      underutilisingCrossCheck: buildUnderutilisingCrossCheck(
        sheetEntries && sheetEntries.length > 0
          ? ticketBasedUnderutilising
          : allUnderutilising,
        sheetEntries
      ),
    };
  }

  let filtered = analytics.clients.filter((c) => {
    const meta = resolveEngagementClientMeta(c.client);
    if (meta.isPaused || meta.isGratis || meta.isCancelled || meta.status === "potential_pause") return false;
    const seg = classifySegment(c.client, c.tickets, topNames, lastByRegistry);
    if (seg !== segment) return false;
    if (!engagementCityMatches(city, meta, c.city)) return false;
    return true;
  });

  filtered = filtered.sort((a, b) => {
    if (segment === "top") return b.tickets - a.tickets;
    return b.tickets - a.tickets;
  });

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * PAGE_SIZE;

  const qolMap = getSessionDerived()?.qolByClient;

  const clients: EngagementClient[] = filtered.slice(start, start + PAGE_SIZE).map((c) => {
    const meta = resolveEngagementClientMeta(c.client);
    const displayCity = meta.registryId ? meta.city : c.city;
    const qol =
      qolMap?.get(c.client) ?? computeQoLForClient(c.client, c.tickets);
    const topServices = topMap.get(c.client) ?? "General FSO Assistance";
    const inactiveDays = daysSinceLastTicket(c.client, lastByRegistry);
    return {
      client: meta.benefactor,
      slug: slugify(meta.benefactor),
      city: displayCity,
      email: c.email,
      tickets: c.tickets,
      segment,
      cityLead: getCityLead(displayCity),
      suggestions: generateIntelligenceSuggestions(
        meta.benefactor,
        segment,
        c.tickets,
        displayCity,
        topServices
      ),
      topServices,
      qolOverall: qol.overall,
      status:
        meta.status === "unknown"
          ? "active"
          : meta.status === "potential_pause"
            ? "pause"
            : meta.status,
      isPaused: meta.isPaused,
      daysSinceLastTicket: inactiveDays,
      onOpsSheet:
        sheetEntries === null
          ? null
          : isOnUnderutilisingSheet(c.client, sheetEntries, c.email),
    };
  });

  return {
    clients,
    total,
    page: safePage,
    pageSize: PAGE_SIZE,
    totalPages,
    segment,
    city,
  };
}
