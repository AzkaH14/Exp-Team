import "server-only";
import { writeFileSync } from "fs";
import path from "path";
import localJson from "@/data/celebrations-calendar.json";
import holidaysJson from "@/data/pakistan-holidays.json";
import { getHubSpotBirthdayForClient } from "../client-registry/hubspot-birthdays";
import { getRiskAssessmentForClient } from "../client-registry/risk-assessment";
import { getOdooFamily } from "../client-registry/odoo-families";
import {
  getEnrichmentMap,
  getOverrides,
  getSacredRegistry,
} from "../client-registry/store";
import {
  engagementCitiesFor,
  resolveScheduleCity,
} from "../engagement/calendar-clients";
import {
  appendHubSpotTicketNote,
  createHubSpotClientTicket,
  hubSpotTicketUrl,
  isHubSpotTicketCreateEnabled,
} from "../integrations/hubspot-ticket-create";
import {
  appendCelebrationSheetEvent,
  deleteCelebrationSheetEvent,
  isCelebrationsSheetConfigured,
  listCelebrationSheetEvents,
  updateCelebrationSheetEvent,
} from "../integrations/celebrations-sheet";
import {
  DEFAULT_CELEBRATION_CATEGORIES,
  type CelebrationCategory,
  type CelebrationCity,
  type CelebrationEvent,
  type CelebrationEventInput,
  type CelebrationMutationResult,
  type CelebrationUser,
  type CelebrationsMonthPayload,
} from "../types/celebrations-calendar";

interface LocalFile {
  version: number;
  description?: string;
  events: CelebrationEvent[];
}

const LOCAL_PATH = path.join(process.cwd(), "src/data/celebrations-calendar.json");
const MONTH_CACHE_TTL_MS = 5 * 60_000;
const CITY_SET = new Set<CelebrationCity>(["Islamabad", "Karachi", "Lahore"]);

const globalStore = globalThis as unknown as {
  __mohsynCelebrationsLocalEvents?: CelebrationEvent[];
  __mohsynCelebrationsUseLocalFallback?: boolean;
  __mohsynCelebrationsMonthCache?: Map<
    string,
    { payload: CelebrationsMonthPayload; loadedAt: number }
  >;
};

function localEvents(): CelebrationEvent[] {
  if (!globalStore.__mohsynCelebrationsLocalEvents) {
    globalStore.__mohsynCelebrationsLocalEvents = [
      ...((localJson as LocalFile).events ?? []),
    ];
  }
  return globalStore.__mohsynCelebrationsLocalEvents;
}

function persistLocal(events: CelebrationEvent[]): void {
  try {
    writeFileSync(
      LOCAL_PATH,
      JSON.stringify(
        {
          version: (localJson as LocalFile).version ?? 1,
          description: (localJson as LocalFile).description,
          events,
        },
        null,
        2
      )
    );
  } catch (error) {
    console.warn("Could not persist celebrations-calendar.json:", error);
  }
}

function sheetStorageEnabled(): boolean {
  return (
    isCelebrationsSheetConfigured() &&
    !globalStore.__mohsynCelebrationsUseLocalFallback
  );
}

function enableLocalFallback(error: unknown): void {
  globalStore.__mohsynCelebrationsUseLocalFallback = true;
  console.error(
    "Celebrations Sheet unavailable; using local fallback:",
    error instanceof Error ? error.message : error
  );
}

async function storedEvents(): Promise<CelebrationEvent[]> {
  if (sheetStorageEnabled()) {
    try {
      return await listCelebrationSheetEvents();
    } catch (error) {
      enableLocalFallback(error);
    }
  }
  return [...localEvents()];
}

function invalidateMonthCache(): void {
  globalStore.__mohsynCelebrationsMonthCache = undefined;
}

async function appendStored(event: CelebrationEvent): Promise<void> {
  if (sheetStorageEnabled()) {
    try {
      await appendCelebrationSheetEvent(event);
      invalidateMonthCache();
      return;
    } catch (error) {
      enableLocalFallback(error);
    }
  }
  const events = localEvents();
  events.push(event);
  persistLocal(events);
  invalidateMonthCache();
}

async function replaceStored(event: CelebrationEvent): Promise<boolean> {
  if (sheetStorageEnabled()) {
    try {
      const updated = await updateCelebrationSheetEvent(event);
      if (updated) invalidateMonthCache();
      return updated;
    } catch (error) {
      enableLocalFallback(error);
    }
  }
  const events = localEvents();
  const index = events.findIndex((item) => item.id === event.id);
  if (index < 0) return false;
  events[index] = event;
  persistLocal(events);
  invalidateMonthCache();
  return true;
}

function safeId(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

const NAME_NOISE = new Set(["dr", "mr", "mrs", "ms", "miss", "prof", "sir", "birthday", "bday"]);

function nameTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/['’]s\b/g, " ")
      .split(/[^a-z]+/)
      .filter((t) => t.length >= 3 && !NAME_NOISE.has(t))
  );
}

function isBirthdayEvent(event: CelebrationEvent): boolean {
  return event.categoryId === "birthday" || /birth\s?day|bday/i.test(event.title);
}

/**
 * Same person when the hand-entered title / client labels share two name words
 * with the generated person (one, if the name has a single word) — so
 * "Abdul Shakoor's birthday" matches "Abdul Shakoor Khan Aquil".
 */
function samePerson(manual: CelebrationEvent, generated: CelebrationEvent): boolean {
  const person = nameTokens(generated.clientLabels[0] ?? generated.title);
  if (!person.size) return false;
  const other = nameTokens([manual.title, ...manual.clientLabels].join(" "));
  let shared = 0;
  for (const t of person) if (other.has(t)) shared++;
  return shared >= Math.min(2, person.size);
}

function annualDate(raw: string | null | undefined, year: string): string | null {
  if (!raw) return null;
  const match = raw.match(/(?:\d{4}-)?(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = `${year}-${match[1]}-${match[2]}`;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date
    ? null
    : date;
}

function citiesForRegistry(record: ReturnType<typeof getSacredRegistry>[number]): CelebrationCity[] {
  return engagementCitiesFor(record).filter((city): city is CelebrationCity =>
    CITY_SET.has(city as CelebrationCity)
  );
}

function profileEvent(params: {
  registryId: string;
  personKey: string;
  personLabel: string;
  relation: string;
  date: string;
  cities: CelebrationCity[];
  kind?: "birthday" | "anniversary";
}): CelebrationEvent {
  const kind = params.kind ?? "birthday";
  const id = `profile:${kind}:${params.registryId}:${safeId(params.personKey)}`;
  return {
    id,
    source: "profile",
    kind,
    categoryId: kind,
    categoryLabel: kind === "birthday" ? "Birthday" : "Anniversary",
    title:
      kind === "birthday"
        ? `${params.personLabel}'s birthday`
        : `${params.personLabel} anniversary`,
    date: params.date,
    time: null,
    allDay: true,
    recurrence: "annual",
    registryIds: [params.registryId],
    clientLabels: [params.personLabel],
    cities: params.cities,
    notes: "",
    status: "planned",
    createdBy: "system",
    createdAt: "",
    updatedAt: "",
    ticketLinks: {},
  };
}

function generatedProfileEvents(month: string): CelebrationEvent[] {
  const year = month.slice(0, 4);
  const enrichment = getEnrichmentMap();
  const overrides = getOverrides();
  const events = new Map<string, CelebrationEvent>();

  for (const record of getSacredRegistry()) {
    const cities = citiesForRegistry(record);
    if (!cities.length) continue;

    if (record.source === "odoo") {
      // Odoo is the only birthday source: x_studio_date_of_birth on the
      // family members and the benefactor. Odoo has no anniversary field.
      const family = getOdooFamily(record.id);
      const tagged = family?.members.filter((m) => m.isBeneficiary) ?? [];
      const people = tagged.length ? tagged : family?.members ?? [];
      for (const person of people) {
        const date = annualDate(person.birthday, year);
        if (!date || !date.startsWith(month)) continue;
        const event = profileEvent({
          registryId: record.id,
          personKey: `beneficiary:${person.name}:${date.slice(5)}`,
          personLabel: person.name,
          relation: "beneficiary",
          date,
          cities,
        });
        events.set(event.id, event);
      }
      const benefactorDate = annualDate(family?.benefactorBirthday ?? null, year);
      if (benefactorDate?.startsWith(month)) {
        const event = profileEvent({
          registryId: record.id,
          personKey: `benefactor:${record.benefactor}:${benefactorDate.slice(5)}`,
          personLabel: record.benefactor,
          relation: "benefactor",
          date: benefactorDate,
          cities,
        });
        events.set(event.id, event);
      }
      continue;
    }

    const hs = getHubSpotBirthdayForClient(record.id);
    const risk = getRiskAssessmentForClient(record.id);
    const internal = enrichment.get(record.id);
    const override = overrides[record.id] ?? {};
    const beneficiaries = [
      ...(hs?.beneficiaries ?? []),
      ...(risk?.beneficiaries ?? []),
    ].filter(
      (person, index, all) =>
        index ===
        all.findIndex(
          (candidate) =>
            safeId(candidate.name) === safeId(person.name) &&
            candidate.birthday === person.birthday
        )
    );

    for (const beneficiary of beneficiaries) {
      const date = annualDate(beneficiary.birthday, year);
      if (!date || !date.startsWith(month)) continue;
      const event = profileEvent({
        registryId: record.id,
        personKey: `beneficiary:${beneficiary.name}:${date.slice(5)}`,
        personLabel: beneficiary.name || record.beneficiary,
        relation: "beneficiary",
        date,
        cities,
      });
      events.set(event.id, event);
    }

    if (!beneficiaries.some((person) => Boolean(person.birthday))) {
      const birthday =
        override.beneficiaryBirthday ||
        internal?.beneficiaryBirthday ||
        risk?.beneficiaryBirthday ||
        hs?.beneficiaryBirthday;
      const date = annualDate(birthday, year);
      if (date?.startsWith(month)) {
        const event = profileEvent({
          registryId: record.id,
          personKey: `beneficiary:${record.beneficiary}:${date.slice(5)}`,
          personLabel: record.beneficiary,
          relation: "beneficiary",
          date,
          cities,
        });
        events.set(event.id, event);
      }
    }

    const benefactorDate = annualDate(
      override.benefactorBirthday ||
        internal?.benefactorBirthday ||
        risk?.benefactorBirthday ||
        hs?.benefactorBirthday,
      year
    );
    if (benefactorDate?.startsWith(month)) {
      const event = profileEvent({
        registryId: record.id,
        personKey: `benefactor:${record.benefactor}:${benefactorDate.slice(5)}`,
        personLabel: record.benefactor,
        relation: "benefactor",
        date: benefactorDate,
        cities,
      });
      events.set(event.id, event);
    }

    const anniversary = annualDate(
      override.anniversary || internal?.anniversary,
      year
    );
    if (anniversary?.startsWith(month)) {
      const event = profileEvent({
        registryId: record.id,
        personKey: `anniversary:${anniversary.slice(5)}`,
        personLabel: record.benefactor,
        relation: "family",
        date: anniversary,
        cities,
        kind: "anniversary",
      });
      events.set(event.id, event);
    }
  }
  return [...events.values()];
}

function holidayEvents(month: string): CelebrationEvent[] {
  const year = month.slice(0, 4);
  const rows =
    (holidaysJson as Record<
      string,
      Array<{
        date: string;
        title: string;
        categoryId: string;
        categoryLabel: string;
      }>
    >)[year] ?? [];
  return rows
    .filter((row) => row.date.startsWith(month))
    .map((row) => ({
      id: `holiday:${row.date}:${safeId(row.title)}`,
      source: "holiday" as const,
      kind: "holiday" as const,
      categoryId: row.categoryId,
      categoryLabel: row.categoryLabel,
      title: row.title,
      date: row.date,
      time: null,
      allDay: true,
      recurrence: "none" as const,
      registryIds: [],
      clientLabels: [],
      cities: ["Islamabad", "Karachi", "Lahore"] as CelebrationCity[],
      notes: "",
      status: "planned" as const,
      createdBy: "system" as const,
      createdAt: "",
      updatedAt: "",
      ticketLinks: {},
    }));
}

function categoryList(events: CelebrationEvent[]): CelebrationCategory[] {
  const categories = new Map(
    DEFAULT_CELEBRATION_CATEGORIES.map((category) => [category.id, category])
  );
  for (const event of events) {
    if (event.categoryId && event.categoryLabel) {
      categories.set(event.categoryId, {
        id: event.categoryId,
        label: event.categoryLabel,
      });
    }
  }
  return [...categories.values()];
}

function celebrationOwnerId(event: CelebrationEvent): string | undefined {
  const city = event.cities[0];
  const configured =
    city === "Lahore"
      ? process.env.HUBSPOT_OWNER_SEEMAB
      : city === "Karachi"
        ? process.env.HUBSPOT_OWNER_LABEBA
        : process.env.HUBSPOT_OWNER_LAIBA;
  return configured?.trim() || process.env.HUBSPOT_OWNER_LAIBA?.trim() || undefined;
}

export async function getCelebrationsMonth(
  month: string
): Promise<CelebrationsMonthPayload> {
  const cache =
    globalStore.__mohsynCelebrationsMonthCache ??
    (globalStore.__mohsynCelebrationsMonthCache = new Map());
  const hit = cache.get(month);
  if (hit && Date.now() - hit.loadedAt < MONTH_CACHE_TTL_MS) return hit.payload;

  const stored = await storedEvents();
  const overlays = new Map(
    stored
      .filter((event) => event.linkedGeneratedId)
      .map((event) => [event.linkedGeneratedId!, event])
  );
  const generated = [...generatedProfileEvents(month), ...holidayEvents(month)].map(
    (event) => {
      const overlay = overlays.get(event.id);
      return overlay
        ? {
            ...event,
            notes: overlay.notes,
            ticketLinks: overlay.ticketLinks,
            updatedAt: overlay.updatedAt,
          }
        : event;
    }
  );
  const targetYear = month.slice(0, 4);
  const manual = stored
    .filter((event) => {
      if (event.linkedGeneratedId) return false;
      if (event.recurrence === "annual") {
        return event.date.slice(5, 7) === month.slice(5, 7);
      }
      return event.date.startsWith(month);
    })
    .map((event) =>
      event.recurrence === "annual"
        ? { ...event, date: `${targetYear}-${event.date.slice(5)}` }
        : event
    );
  // A birthday someone already entered by hand wins over the Odoo-generated one.
  const manualBirthdays = manual.filter(isBirthdayEvent);
  const deduped = generated.filter(
    (event) =>
      !(
        event.source === "profile" &&
        event.kind === "birthday" &&
        manualBirthdays.some((m) => m.date.slice(5) === event.date.slice(5) && samePerson(m, event))
      )
  );
  const events = [...deduped, ...manual]
    .filter((event) => event.status !== "cancelled")
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        (a.time ?? "").localeCompare(b.time ?? "") ||
        a.title.localeCompare(b.title)
    );
  const clients = getSacredRegistry()
    .filter((record) => record.status !== "cancelled")
    .map((record) => ({
      id: record.id,
      label: record.benefactor,
      beneficiary: record.beneficiary,
      cities: citiesForRegistry(record),
    }))
    .filter((client) => client.cities.length)
    .sort((a, b) => a.label.localeCompare(b.label));
  const payload: CelebrationsMonthPayload = {
    month,
    events,
    clients,
    categories: categoryList(stored),
    storageMode: sheetStorageEnabled() ? "sheet" : "local",
    hubspotEnabled: Boolean(process.env.HUBSPOT_ACCESS_TOKEN?.trim()),
    generatedAt: new Date().toISOString(),
  };
  cache.set(month, { payload, loadedAt: Date.now() });
  return payload;
}

function categoryFor(input: CelebrationEventInput): CelebrationCategory {
  const known = DEFAULT_CELEBRATION_CATEGORIES.find(
    (category) => category.id === input.categoryId
  );
  if (known) return known;
  const label = input.categoryLabel?.trim();
  if (!label) throw new Error("A label is required for a custom category");
  const id = safeId(input.categoryId || label);
  if (!id) throw new Error("Invalid category");
  return { id: `custom-${id.replace(/^custom-/, "")}`, label: label.slice(0, 80) };
}

function makeManualEvent(input: CelebrationEventInput): CelebrationEvent {
  const registry = new Map(getSacredRegistry().map((record) => [record.id, record]));
  const records = [...new Set(input.registryIds ?? [])].map((id) => {
    const record = registry.get(id);
    if (!record) throw new Error(`Unknown client: ${id}`);
    return record;
  });
  const category = categoryFor(input);
  const now = new Date().toISOString();
  const cities = [
    ...new Set(
      records.flatMap((record) => citiesForRegistry(record))
    ),
  ];
  return {
    id: `celebration_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    source: "manual",
    kind: input.kind,
    categoryId: category.id,
    categoryLabel: category.label,
    title: input.title.trim() || category.label,
    date: input.date,
    time: input.time?.trim() || null,
    allDay: input.allDay ?? !input.time,
    recurrence: input.recurrence ?? "none",
    registryIds: records.map((record) => record.id),
    clientLabels: records.map((record) => record.benefactor),
    cities: cities.length ? cities : ["Islamabad", "Karachi", "Lahore"],
    notes: input.notes?.trim() ?? "",
    status: input.status ?? "planned",
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
    ticketLinks: {},
    linkedGeneratedId: null,
  };
}

async function addMissingTickets(
  event: CelebrationEvent
): Promise<CelebrationMutationResult> {
  const warnings: CelebrationMutationResult["warnings"] = [];
  // Same off-switch as the engagement calendar's auto-create — the business
  // moved to Odoo, so new tickets from calendar events must not go to HubSpot.
  if (!isHubSpotTicketCreateEnabled()) return { event, warnings };
  const registry = new Map(getSacredRegistry().map((record) => [record.id, record]));
  const missing = event.registryIds.filter(
    (registryId) => !event.ticketLinks[registryId] && registry.has(registryId)
  );
  const results = await Promise.all(
    missing.map(async (registryId) => {
      const record = registry.get(registryId)!;
      try {
        const ticket = await createHubSpotClientTicket(
          {
            subject: `${event.categoryLabel}: ${event.title}`,
            content: [
              "Created via Mohsyn Celebrations Calendar",
              `Celebration: ${event.title}`,
              `Date: ${event.date}${event.time ? ` at ${event.time}` : ""}`,
              `Coordinator: ${event.createdBy}`,
              event.notes ? `Notes: ${event.notes}` : "",
              `Celebration event id: ${event.linkedGeneratedId || event.id}`,
            ]
              .filter(Boolean)
              .join("\n"),
            category: "Engagement Call",
            subCategory: "Engagement Call",
            city: resolveScheduleCity(record),
            ownerId: celebrationOwnerId(event),
          },
          record
        );
        return { registryId, ticket };
      } catch (error) {
        return { registryId, error };
      }
    })
  );

  let changed = false;
  for (const result of results) {
    if ("error" in result) {
      warnings.push({
        registryId: result.registryId,
        message:
          result.error instanceof Error
            ? result.error.message
            : "HubSpot ticket failed",
      });
      continue;
    }
    if (!result.ticket) {
      warnings.push({
        registryId: result.registryId,
        message: "HubSpot is not configured",
      });
      continue;
    }
    event.ticketLinks[result.registryId] = {
      ticketId: result.ticket.id,
      url: hubSpotTicketUrl(result.ticket.id),
    };
    changed = true;
    if (result.ticket.contactWarning) {
      warnings.push({
        registryId: result.registryId,
        message: result.ticket.contactWarning,
      });
    }
  }
  if (changed) {
    event.updatedAt = new Date().toISOString();
    await replaceStored(event);
  }
  return { event, warnings };
}

export async function addCelebrationEvent(
  input: CelebrationEventInput
): Promise<CelebrationMutationResult> {
  const event = makeManualEvent(input);
  await appendStored(event);
  return addMissingTickets(event);
}

export interface CelebrationEventPatch {
  title?: string;
  notes?: string;
  date?: string;
  time?: string | null;
  allDay?: boolean;
  recurrence?: CelebrationEvent["recurrence"];
  status?: CelebrationEvent["status"];
  categoryId?: string;
  categoryLabel?: string;
  registryIds?: string[];
  updatedBy?: CelebrationUser;
}

export async function updateCelebrationEvent(
  id: string,
  patch: CelebrationEventPatch
): Promise<CelebrationMutationResult | null> {
  const all = await storedEvents();
  let existing = all.find(
    (event) => event.id === id || event.linkedGeneratedId === id
  );
  const generated = id.startsWith("profile:");
  if (!existing && generated) {
    const date = patch.date;
    if (!date) throw new Error("date is required when saving a generated event");
    const generatedEvent = (await getCelebrationsMonth(date.slice(0, 7))).events.find(
      (event) => event.id === id
    );
    if (!generatedEvent) return null;
    const now = new Date().toISOString();
    existing = {
      ...generatedEvent,
      id: `note:${id}`,
      source: "manual",
      linkedGeneratedId: id,
      createdAt: now,
      updatedAt: now,
    };
    await appendStored(existing);
  }
  if (!existing) return null;

  const registry = new Map(getSacredRegistry().map((record) => [record.id, record]));
  const records =
    patch.registryIds === undefined
      ? existing.registryIds.map((id) => registry.get(id)).filter(Boolean)
      : [...new Set(patch.registryIds)].map((id) => {
          const record = registry.get(id);
          if (!record) throw new Error(`Unknown client: ${id}`);
          return record;
        });
  const registryIds = records.map((record) => record!.id);
  const cities = [
    ...new Set(records.flatMap((record) => citiesForRegistry(record!))),
  ];

  const category =
    patch.categoryId !== undefined
      ? categoryFor({
          kind: existing.kind,
          categoryId: patch.categoryId,
          categoryLabel: patch.categoryLabel,
          title: existing.title,
          date: existing.date,
          createdBy: existing.createdBy === "system" ? "Team" : existing.createdBy,
        })
      : { id: existing.categoryId, label: existing.categoryLabel };
  const updated: CelebrationEvent = {
    ...existing,
    ticketLinks: Object.fromEntries(
      Object.entries(existing.ticketLinks).filter(([registryId]) =>
        registryIds.includes(registryId)
      )
    ),
    createdBy:
      existing.linkedGeneratedId && patch.updatedBy
        ? patch.updatedBy
        : existing.createdBy,
    title: patch.title?.trim() ?? existing.title,
    notes: patch.notes?.trim() ?? existing.notes,
    date: patch.date ?? existing.date,
    time:
      patch.time === undefined ? existing.time : patch.time?.trim() || null,
    allDay: patch.allDay ?? existing.allDay,
    recurrence: patch.recurrence ?? existing.recurrence,
    status: patch.status ?? existing.status,
    categoryId: category.id,
    categoryLabel: category.label,
    registryIds,
    clientLabels: records.map((record) => record!.benefactor),
    cities: cities.length ? cities : existing.cities,
    updatedAt: new Date().toISOString(),
  };
  if (!(await replaceStored(updated))) return null;
  const result =
    updated.notes && updated.registryIds.length
      ? await addMissingTickets(updated)
      : { event: updated, warnings: [] };
  if (updated.notes && updated.notes !== existing.notes) {
    for (const [registryId, link] of Object.entries(existing.ticketLinks)) {
      try {
        await appendHubSpotTicketNote(
          link.ticketId,
          `[Celebrations Calendar] Notes updated by ${updated.createdBy}\n${updated.notes}`
        );
      } catch (error) {
        result.warnings.push({
          registryId,
          message:
            error instanceof Error
              ? `Ticket note update failed: ${error.message}`
              : "Ticket note update failed",
        });
      }
    }
  }
  return result;
}

export async function deleteCelebrationEvent(id: string): Promise<boolean> {
  if (!id.startsWith("celebration_")) return false;
  if (sheetStorageEnabled()) {
    try {
      const deleted = await deleteCelebrationSheetEvent(id);
      if (deleted) invalidateMonthCache();
      return deleted;
    } catch (error) {
      enableLocalFallback(error);
    }
  }
  const events = localEvents();
  const index = events.findIndex((event) => event.id === id && !event.linkedGeneratedId);
  if (index < 0) return false;
  events.splice(index, 1);
  persistLocal(events);
  invalidateMonthCache();
  return true;
}
