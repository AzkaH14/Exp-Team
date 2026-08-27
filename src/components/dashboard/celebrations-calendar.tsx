"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarPlus, ChevronLeft, ChevronRight, ExternalLink, Plus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type {
  CelebrationCity,
  CelebrationEvent,
  CelebrationKind,
  CelebrationRecurrence,
  CelebrationStatus,
  CelebrationsMonthPayload,
} from "@/lib/types/celebrations-calendar";

const CITIES = ["all", "Islamabad", "Karachi", "Lahore"] as const;
const KINDS: Array<{ id: CelebrationKind; label: string }> = [
  { id: "birthday", label: "Birthday" },
  { id: "anniversary", label: "Anniversary" },
  { id: "important_date", label: "Important date" },
  { id: "holiday", label: "Holiday" },
  { id: "custom", label: "Custom" },
];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const CITY_STYLES: Record<CelebrationCity, string> = {
  Islamabad: "border-sky-200 bg-sky-50 text-sky-800",
  Karachi: "border-emerald-200 bg-emerald-50 text-emerald-800",
  Lahore: "border-violet-200 bg-violet-50 text-violet-800",
};

type CityFilter = (typeof CITIES)[number];

interface FormState {
  event: CelebrationEvent | null;
  kind: CelebrationKind;
  categoryId: string;
  customCategoryLabel: string;
  title: string;
  date: string;
  time: string;
  allDay: boolean;
  recurrence: CelebrationRecurrence;
  registryIds: string[];
  notes: string;
  status: CelebrationStatus;
}

function monthShift(month: string, amount: number): string {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber - 1 + amount, 1))
    .toISOString()
    .slice(0, 7);
}

function monthLabel(month: string): string {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function monthDays(month: string): Array<string | null> {
  const [year, monthNumber] = month.split("-").map(Number);
  const first = new Date(Date.UTC(year, monthNumber - 1, 1));
  const leading = (first.getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const cells: Array<string | null> = Array.from({ length: leading }, () => null);
  for (let day = 1; day <= count; day += 1) {
    cells.push(`${month}-${String(day).padStart(2, "0")}`);
  }
  while (cells.length % 7) cells.push(null);
  return cells;
}

function eventTone(event: CelebrationEvent): string {
  if (event.kind === "birthday") return "border-pink-200 bg-pink-50 hover:bg-pink-100";
  if (event.kind === "anniversary") return "border-rose-200 bg-rose-50 hover:bg-rose-100";
  if (event.source === "holiday") return "border-amber-200 bg-amber-50 hover:bg-amber-100";
  return "border-border bg-background hover:bg-muted";
}

function blankForm(date: string): FormState {
  return {
    event: null,
    kind: "custom",
    categoryId: "custom",
    customCategoryLabel: "",
    title: "",
    date,
    time: "",
    allDay: true,
    recurrence: "none",
    registryIds: [],
    notes: "",
    status: "planned",
  };
}

export function CelebrationsCalendar({
  initial,
}: {
  initial: CelebrationsMonthPayload;
}) {
  const cache = useRef(new Map([[initial.month, initial]]));
  const inFlight = useRef(
    new Map<string, Promise<CelebrationsMonthPayload>>()
  );
  const activeMonth = useRef(initial.month);
  const [data, setData] = useState(initial);
  const [month, setMonth] = useState(initial.month);
  const [city, setCity] = useState<CityFilter>("all");
  const [form, setForm] = useState<FormState | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const fetchMonth = useCallback(async (target: string, foreground = false, force = false) => {
    if (!force && cache.current.has(target)) {
      if (foreground) setData(cache.current.get(target)!);
      return;
    }
    if (foreground) setLoading(true);
    try {
      let request = !force ? inFlight.current.get(target) : undefined;
      if (!request) {
        request = fetch(`/api/celebrations-calendar?month=${target}`)
          .then(async (response) => {
            if (!response.ok) throw new Error("Could not load celebrations");
            const payload = (await response.json()) as CelebrationsMonthPayload;
            cache.current.set(target, payload);
            return payload;
          })
          .finally(() => inFlight.current.delete(target));
        inFlight.current.set(target, request);
      }
      const payload = await request;
      if (foreground && activeMonth.current === target) setData(payload);
    } finally {
      if (foreground) setLoading(false);
    }
  }, []);

  useEffect(() => {
    activeMonth.current = month;
    const hit = cache.current.get(month);
    if (hit) setData(hit);
    void fetchMonth(month, true);
    void fetchMonth(monthShift(month, -1));
    void fetchMonth(monthShift(month, 1));
  }, [fetchMonth, month]);

  const visibleEvents = useMemo(
    () =>
      data.month === month
        ? data.events.filter(
            (event) => city === "all" || event.cities.includes(city as CelebrationCity)
          )
        : [],
    [city, data.events, data.month, month]
  );
  const byDate = useMemo(() => {
    const map = new Map<string, CelebrationEvent[]>();
    for (const event of visibleEvents) {
      map.set(event.date, [...(map.get(event.date) ?? []), event]);
    }
    return map;
  }, [visibleEvents]);
  const cells = useMemo(() => monthDays(month), [month]);

  function openEvent(event: CelebrationEvent) {
    setMessage(null);
    setForm({
      event,
      kind: event.kind,
      categoryId: event.categoryId,
      customCategoryLabel: "",
      title: event.title,
      date: event.date,
      time: event.time ?? "",
      allDay: event.allDay,
      recurrence: event.recurrence,
      registryIds: event.registryIds,
      notes: event.notes,
      status: event.status,
    });
  }

  function openAdd(date?: string) {
    setMessage(null);
    setForm(blankForm(date ?? `${month}-01`));
  }

  async function refreshCurrent() {
    cache.current.delete(month);
    await fetchMonth(month, true, true);
  }

  async function save() {
    if (!form) return;
    if (form.categoryId === "__new" && !form.customCategoryLabel.trim()) {
      setMessage("Enter a custom category label.");
      return;
    }
    setSaving(true);
    setMessage(null);
    const isEdit = Boolean(form.event);
    const generated = Boolean(form.event && form.event.source !== "manual");
    try {
      const response = await fetch("/api/celebrations-calendar", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isEdit
            ? {
                id: form.event!.id,
                date: form.date,
                notes: form.notes,
                ...(generated
                  ? {}
                  : {
                      title: form.title,
                      time: form.allDay ? null : form.time || null,
                      allDay: form.allDay,
                      recurrence: form.recurrence,
                      status: form.status,
                      categoryId:
                        form.categoryId === "__new"
                          ? form.customCategoryLabel
                          : form.categoryId,
                      categoryLabel:
                        form.categoryId === "__new"
                          ? form.customCategoryLabel
                          : undefined,
                      registryIds: form.registryIds,
                    }),
              }
            : {
                kind: form.kind,
                categoryId:
                  form.categoryId === "__new"
                    ? form.customCategoryLabel
                    : form.categoryId,
                categoryLabel:
                  form.categoryId === "__new" ? form.customCategoryLabel : undefined,
                title: form.title,
                date: form.date,
                time: form.allDay ? null : form.time || null,
                allDay: form.allDay,
                recurrence: form.recurrence,
                registryIds: form.registryIds,
                notes: form.notes,
              }
        ),
      });
      const result = (await response.json()) as {
        error?: string;
        warnings?: Array<{ message: string }>;
      };
      if (!response.ok) throw new Error(result.error ?? "Could not save");
      setForm(null);
      if (result.warnings?.length) {
        setMessage(`Saved. HubSpot: ${result.warnings.map((warning) => warning.message).join("; ")}`);
      }
      await refreshCurrent();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!form?.event || form.event.source !== "manual") return;
    if (!window.confirm(`Delete "${form.event.title}"?`)) return;
    const response = await fetch(
      `/api/celebrations-calendar?id=${encodeURIComponent(form.event.id)}`,
      { method: "DELETE" }
    );
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setMessage(body.error ?? "Could not delete");
      return;
    }
    setForm(null);
    await refreshCurrent();
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={data.storageMode === "sheet" ? "secondary" : "outline"}>
          {data.storageMode === "sheet"
            ? "Google Sheet storage"
            : "Local JSON fallback (not durable on Vercel)"}
        </Badge>
        <Badge variant={data.hubspotEnabled ? "secondary" : "outline"}>
          {data.hubspotEnabled ? "HubSpot tickets enabled" : "HubSpot tickets off"}
        </Badge>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {CITIES.map((value) => (
            <Button
              key={value}
              size="sm"
              variant={city === value ? "default" : "outline"}
              onClick={() => setCity(value)}
            >
              {value === "all" ? "All cities" : value}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button size="icon" variant="outline" onClick={() => setMonth(monthShift(month, -1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-40 text-center font-semibold">{monthLabel(month)}</div>
          <Button size="icon" variant="outline" onClick={() => setMonth(monthShift(month, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setMonth(today.slice(0, 7))}>
            Today
          </Button>
          <Button size="sm" onClick={() => openAdd()}>
            <CalendarPlus className="h-4 w-4" /> Add celebration
          </Button>
        </div>
      </div>

      {message && (
        <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm">{message}</p>
      )}
      {loading && <p className="text-sm text-muted-foreground">Loading month...</p>}

      <div className="hidden overflow-hidden rounded-lg border md:block">
        <div className="grid grid-cols-7 border-b bg-muted/40">
          {WEEKDAYS.map((day) => (
            <div key={day} className="px-2 py-2 text-center text-xs font-semibold text-muted-foreground">
              {day}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((date, index) => (
            <div
              key={date ?? `blank-${index}`}
              className={`min-h-32 border-b border-r p-1.5 ${!date ? "bg-muted/20" : ""}`}
              onDoubleClick={() => date && openAdd(date)}
            >
              {date && (
                <>
                  <button
                    className={`mb-1 flex h-7 w-7 items-center justify-center rounded-full text-xs ${
                      date === today ? "bg-primary font-semibold text-primary-foreground" : "hover:bg-muted"
                    }`}
                    onClick={() => openAdd(date)}
                    title="Add celebration"
                  >
                    {Number(date.slice(-2))}
                  </button>
                  <div className="space-y-1">
                    {(byDate.get(date) ?? []).map((event) => (
                      <EventButton key={event.id} event={event} onClick={() => openEvent(event)} />
                    ))}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-3 md:hidden">
        {visibleEvents.length ? (
          visibleEvents.map((event) => (
            <button key={event.id} className="block w-full text-left" onClick={() => openEvent(event)}>
              <Card className={eventTone(event)}>
                <CardContent className="p-3">
                  <p className="text-xs text-muted-foreground">
                    {new Date(`${event.date}T00:00:00Z`).toLocaleDateString("en-US", {
                      weekday: "short", month: "short", day: "numeric", timeZone: "UTC",
                    })}
                    {event.time ? ` - ${event.time}` : ""}
                  </p>
                  <p className="font-medium">{event.title}</p>
                  <EventTags event={event} />
                </CardContent>
              </Card>
            </button>
          ))
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">No celebrations this month.</p>
        )}
      </div>

      {form && (
        <EventDialog
          form={form}
          setForm={setForm}
          data={data}
          cityFilter={city}
          saving={saving}
          message={message}
          onSave={save}
          onDelete={remove}
          onClose={() => setForm(null)}
        />
      )}
    </div>
  );
}

function EventButton({ event, onClick }: { event: CelebrationEvent; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full rounded border px-1.5 py-1 text-left text-[11px] ${eventTone(event)}`}
      title={event.title}
    >
      <div className="truncate font-medium">{event.time ? `${event.time} ` : ""}{event.title}</div>
      <EventTags event={event} compact />
    </button>
  );
}

function EventTags({ event, compact = false }: { event: CelebrationEvent; compact?: boolean }) {
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      <span className={`${compact ? "text-[9px]" : "text-[10px]"} rounded bg-black/5 px-1 py-0.5`}>
        {event.categoryLabel}
      </span>
      {event.cities.map((city) => (
        <span
          key={city}
          className={`${compact ? "text-[9px]" : "text-[10px]"} rounded border px-1 py-0.5 ${CITY_STYLES[city]}`}
        >
          {city === "Islamabad" ? "ISB" : city === "Karachi" ? "KHI" : "LHR"}
        </span>
      ))}
    </div>
  );
}

function EventDialog({
  form,
  setForm,
  data,
  cityFilter,
  saving,
  message,
  onSave,
  onDelete,
  onClose,
}: {
  form: FormState;
  setForm: (form: FormState) => void;
  data: CelebrationsMonthPayload;
  cityFilter: CityFilter;
  saving: boolean;
  message: string | null;
  onSave: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const generated = Boolean(form.event && form.event.source !== "manual");
  const holiday = form.event?.source === "holiday";
  const [clientCity, setClientCity] = useState<CelebrationCity>(
    cityFilter === "all" ? "Islamabad" : cityFilter
  );
  const [clientSlots, setClientSlots] = useState<string[]>(
    form.registryIds.length ? form.registryIds : [""]
  );
  const cityClients = useMemo(
    () =>
      data.clients
        .filter((client) => client.cities.includes(clientCity))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [clientCity, data.clients]
  );

  useEffect(() => {
    if (cityFilter === "all") return;
    setClientCity(cityFilter);
  }, [cityFilter]);

  function syncRegistryIds(slots: string[]) {
    setClientSlots(slots);
    setForm({
      ...form,
      registryIds: [...new Set(slots.filter(Boolean))],
    });
  }

  function chooseClientCity(next: CelebrationCity) {
    setClientCity(next);
    const allowed = new Set(
      data.clients
        .filter((client) => client.cities.includes(next))
        .map((client) => client.id)
    );
    const nextSlots = clientSlots.map((id) =>
      id && allowed.has(id) ? id : ""
    );
    syncRegistryIds(nextSlots.length ? nextSlots : [""]);
  }

  function setSlot(index: number, value: string) {
    const next = [...clientSlots];
    next[index] = value;
    syncRegistryIds(next);
  }

  function addSlot() {
    syncRegistryIds([...clientSlots, ""]);
  }

  function removeSlot(index: number) {
    const next = clientSlots.filter((_, i) => i !== index);
    syncRegistryIds(next.length ? next : [""]);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <Card className="max-h-[92vh] w-full max-w-lg overflow-y-auto" onClick={(event) => event.stopPropagation()}>
        <CardContent className="space-y-4 p-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold">
                {form.event ? "Celebration details" : "New celebration"}
              </h3>
              {form.event && (
                <p className="text-xs capitalize text-muted-foreground">
                  {form.event.source} source - {form.event.recurrence}
                </p>
              )}
            </div>
            <Button size="icon" variant="ghost" onClick={onClose}><X className="h-4 w-4" /></Button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {!generated && (
              <>
                <Field label="Kind">
                  <select value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value as CelebrationKind })} className="input">
                    {KINDS.map((kind) => <option key={kind.id} value={kind.id}>{kind.label}</option>)}
                  </select>
                </Field>
                <Field label="Category">
                  <select value={form.categoryId} onChange={(event) => setForm({ ...form, categoryId: event.target.value })} className="input">
                    {data.categories.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}
                    <option value="__new">+ New category...</option>
                  </select>
                </Field>
                {form.categoryId === "__new" && (
                  <label className="col-span-2 text-xs font-medium">
                    Custom category label
                    <input value={form.customCategoryLabel} onChange={(event) => setForm({ ...form, customCategoryLabel: event.target.value })} className="input" maxLength={80} />
                  </label>
                )}
                <label className="col-span-2 text-xs font-medium">
                  Title
                  <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} className="input" maxLength={160} />
                </label>
              </>
            )}

            {generated && (
              <div className="col-span-2">
                <p className="text-lg font-semibold">{form.title}</p>
                {form.event && <EventTags event={form.event} />}
                {form.event?.clientLabels.length ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Client: {form.event.clientLabels.join(", ")}
                  </p>
                ) : null}
              </div>
            )}

            <Field label="Date">
              <input type="date" value={form.date} disabled={generated} onChange={(event) => setForm({ ...form, date: event.target.value })} className="input" />
            </Field>
            {!generated && (
              <Field label="Time">
                <input type="time" value={form.time} disabled={form.allDay} onChange={(event) => setForm({ ...form, time: event.target.value })} className="input" />
              </Field>
            )}

            {!generated && (
              <>
                <label className="flex items-center gap-2 text-xs font-medium">
                  <input type="checkbox" checked={form.allDay} onChange={(event) => setForm({ ...form, allDay: event.target.checked })} />
                  All day
                </label>
                <Field label="Recurrence">
                  <select value={form.recurrence} onChange={(event) => setForm({ ...form, recurrence: event.target.value as CelebrationRecurrence })} className="input">
                    <option value="none">Does not repeat</option>
                    <option value="annual">Annual</option>
                  </select>
                </Field>
                <div className="col-span-2 space-y-3">
                  <Field label="Client city">
                    <select
                      value={clientCity}
                      onChange={(event) =>
                        chooseClientCity(event.target.value as CelebrationCity)
                      }
                      className="input"
                    >
                      <option value="Islamabad">Islamabad</option>
                      <option value="Karachi">Karachi</option>
                      <option value="Lahore">Lahore</option>
                    </select>
                  </Field>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-medium">Client name</p>
                      <p className="text-xs text-muted-foreground">
                        {cityClients.length} {clientCity} clients
                      </p>
                    </div>
                    {clientSlots.map((selectedId, index) => {
                      const selectedElsewhere = new Set(
                        clientSlots.filter((id, i) => id && i !== index)
                      );
                      return (
                        <div key={`slot-${index}`} className="flex items-center gap-2">
                          <select
                            value={selectedId}
                            onChange={(event) => setSlot(index, event.target.value)}
                            className="input mt-0"
                          >
                            <option value="">choose...</option>
                            {cityClients.map((client) => (
                              <option
                                key={client.id}
                                value={client.id}
                                disabled={selectedElsewhere.has(client.id)}
                              >
                                {client.label} — {client.beneficiary}
                              </option>
                            ))}
                          </select>
                          {clientSlots.length > 1 && (
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              onClick={() => removeSlot(index)}
                              title="Remove client"
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      );
                    })}
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={addSlot}
                      disabled={
                        !cityClients.length ||
                        !clientSlots[clientSlots.length - 1] ||
                        clientSlots.filter(Boolean).length >= cityClients.length
                      }
                    >
                      <Plus className="h-4 w-4" /> Add client
                    </Button>
                    {!cityClients.length && (
                      <p className="text-xs text-muted-foreground">
                        No clients found for {clientCity}.
                      </p>
                    )}
                  </div>
                </div>
              </>
            )}

            {!holiday && (
              <label className="col-span-2 text-xs font-medium">
                Notes
                <textarea rows={4} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} className="input" placeholder={generated ? "Saving the first note creates one client-linked HubSpot ticket." : "Celebration details..."} />
              </label>
            )}

            {form.event && Object.entries(form.event.ticketLinks).length > 0 && (
              <div className="col-span-2 space-y-1 text-xs">
                <p className="font-medium">HubSpot tickets</p>
                {Object.entries(form.event.ticketLinks).map(([registryId, ticket]) => (
                  <p key={registryId}>
                    {data.clients.find((client) => client.id === registryId)?.label ?? registryId}:{" "}
                    {ticket.url ? (
                      <a href={ticket.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary underline">
                        MOH-{ticket.ticketId.slice(-5)} <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : `MOH-${ticket.ticketId.slice(-5)}`}
                  </p>
                ))}
              </div>
            )}
          </div>

          {message && <p className="text-xs text-muted-foreground">{message}</p>}
          <div className="flex justify-between gap-2">
            <div>
              {form.event?.source === "manual" && (
                <Button variant="destructive" size="sm" onClick={onDelete} disabled={saving}>Delete</Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
              {!holiday && (
                <Button size="sm" onClick={onSave} disabled={saving}>
                  {saving ? "Saving..." : "Save"}
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
      <style jsx>{`
        :global(.input) {
          margin-top: 0.25rem;
          width: 100%;
          border-radius: 0.375rem;
          border-width: 1px;
          background: hsl(var(--background));
          padding: 0.375rem 0.5rem;
          font-size: 0.875rem;
        }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="text-xs font-medium">{label}{children}</label>;
}
