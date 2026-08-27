"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ENGAGEMENT_EVENT_STATUS_LABELS,
  ENGAGEMENT_EVENT_TYPE_LABELS,
  type EngagementCalendarData,
  type EngagementEvent,
  type EngagementEventStatus,
  type EngagementEventType,
} from "@/lib/types/engagement-calendar";
import { defaultDoctorForCity, listDoctorsForPicker } from "@/lib/engagement/doctors";

const CITIES = ["all", "Islamabad", "Lahore", "Karachi"] as const;
type CityFilter = (typeof CITIES)[number];

const LEADS = ["Laiba", "Seemab", "Labeba"] as const;
type Lead = (typeof LEADS)[number];

const LEAD_CITY: Record<Lead, string> = {
  Laiba: "Islamabad",
  Seemab: "Lahore",
  Labeba: "Karachi",
};

const EVENT_TYPES: EngagementEventType[] = [
  "checkin_call",
  "visit",
  "doctor_call",
  "psychologist_call",
  "outing",
  "other",
];

const TYPE_VARIANT: Record<EngagementEventType, "default" | "secondary" | "outline" | "destructive"> = {
  doctor_call: "destructive",
  psychologist_call: "destructive",
  checkin_call: "secondary",
  visit: "default",
  outing: "outline",
  other: "outline",
};

const STATUS_VARIANT: Record<EngagementEventStatus, "default" | "secondary" | "outline" | "destructive"> = {
  planned: "default",
  completed: "secondary",
  rescheduled: "outline",
  cancelled: "destructive",
};

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function addDays(dateKey: string, n: number): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  const next = new Date(d.getTime() + n * DAY_MS);
  return next.toISOString().slice(0, 10);
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatDayLabel(dateKey: string): string {
  return new Date(`${dateKey}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function formatRange(start: string, end: string): string {
  const s = new Date(`${start}T00:00:00Z`);
  const e = new Date(`${end}T00:00:00Z`);
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", timeZone: "UTC" };
  return `${s.toLocaleDateString("en-US", opts)} – ${e.toLocaleDateString("en-US", opts)}`;
}

interface FormState {
  id: string | null;
  registryId: string;
  clientLabel: string;
  clientCity: string;
  type: EngagementEventType;
  date: string;
  time: string;
  title: string;
  notes: string;
  status: EngagementEventStatus;
  assignedDoctor: string;
  hubspotTicketId: string | null;
}

interface EngagementCalendarProps {
  initial: EngagementCalendarData;
}

export function EngagementCalendar({ initial }: EngagementCalendarProps) {
  const [city, setCity] = useState<CityFilter>("all");
  const [week, setWeek] = useState<string>(initial.weekStart);
  const [data, setData] = useState<EngagementCalendarData>(initial);
  const [loading, setLoading] = useState(false);
  const [actingAs, setActingAs] = useState<Lead | "">("");
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const skipFirstFetch = useRef(true);

  useEffect(() => {
    const saved = window.localStorage.getItem("mohsyn.calendar.actingAs");
    if (saved && (LEADS as readonly string[]).includes(saved)) {
      setActingAs(saved as Lead);
      setCity(LEAD_CITY[saved as Lead] as CityFilter);
    }
  }, []);

  const fetchData = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    try {
      const params = new URLSearchParams({ city, week });
      const res = await fetch(`/api/engagement-calendar?${params}`);
      if (!res.ok) throw new Error("Failed to load");
      setData((await res.json()) as EngagementCalendarData);
    } catch {
      // keep last good data
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, [city, week]);

  useEffect(() => {
    if (skipFirstFetch.current) {
      skipFirstFetch.current = false;
      return;
    }
    void fetchData();
  }, [fetchData]);

  function chooseIdentity(lead: Lead | "") {
    setActingAs(lead);
    if (lead) {
      window.localStorage.setItem("mohsyn.calendar.actingAs", lead);
      setCity(LEAD_CITY[lead] as CityFilter);
    } else {
      window.localStorage.removeItem("mohsyn.calendar.actingAs");
    }
  }

  const leadCity = actingAs ? LEAD_CITY[actingAs] : null;

  const defaultDate = useMemo(() => {
    const t = todayKey();
    if (t >= data.weekStart && t <= data.weekEnd) return t;
    return data.weekStart;
  }, [data.weekStart, data.weekEnd]);

  function openAdd(client: { registryId: string; label: string; city: string }) {
    setError(null);
    setForm({
      id: null,
      registryId: client.registryId,
      clientLabel: client.label,
      clientCity: client.city,
      type: "checkin_call",
      date: defaultDate,
      time: "",
      title: "",
      notes: "",
      status: "planned",
      assignedDoctor: defaultDoctorForCity(client.city),
      hubspotTicketId: null,
    });
  }

  function openEdit(event: EngagementEvent) {
    setError(null);
    setForm({
      id: event.id,
      registryId: event.registryId,
      clientLabel: event.clientLabel,
      clientCity: event.city,
      type: event.type,
      date: event.date,
      time: event.time ?? "",
      title: event.title,
      notes: event.notes,
      status: event.status,
      assignedDoctor: event.assignedDoctor ?? defaultDoctorForCity(event.city),
      hubspotTicketId: event.hubspotTicketId,
    });
  }

  async function submitForm() {
    if (!form) return;
    if (!actingAs) {
      setError("Pick who you are (top right) before adding entries.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const isEdit = Boolean(form.id);
      const res = await fetch("/api/engagement-calendar", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: form.id ?? undefined,
          registryId: form.registryId,
          type: form.type,
          date: form.date,
          time: form.time || null,
          title: form.title,
          notes: form.notes,
          status: form.status,
          createdBy: actingAs,
          assignedDoctor:
            form.type === "psychologist_call"
              ? form.assignedDoctor || "Dr Farwa"
              : form.type === "doctor_call"
                ? form.assignedDoctor || null
                : null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Could not save");
      }
      const body = (await res.json()) as { hubspotWarning?: string };
      if (body.hubspotWarning) {
        setError(`Saved to calendar, but HubSpot: ${body.hubspotWarning}`);
      } else {
        setForm(null);
      }
      void fetchData({ silent: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  async function quickPatch(event: EngagementEvent, status: EngagementEventStatus) {
    await fetch("/api/engagement-calendar", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: event.id, status }),
    });
    void fetchData({ silent: true });
  }

  async function removeEvent(event: EngagementEvent) {
    if (!window.confirm(`Delete this ${ENGAGEMENT_EVENT_TYPE_LABELS[event.type]} for ${event.clientLabel}?`)) {
      return;
    }
    await fetch(`/api/engagement-calendar?id=${encodeURIComponent(event.id)}`, {
      method: "DELETE",
    });
    if (form?.id === event.id) setForm(null);
    void fetchData({ silent: true });
  }

  const weekDays = useMemo(
    () => WEEKDAYS.map((_, i) => addDays(data.weekStart, i)),
    [data.weekStart]
  );
  const eventsByDay = useMemo(() => {
    const map = new Map<string, EngagementEvent[]>();
    for (const e of data.weekEvents) {
      const list = map.get(e.date) ?? [];
      list.push(e);
      map.set(e.date, list);
    }
    return map;
  }, [data.weekEvents]);

  const canAddFor = (client: { city: string; scheduleCity: string }) =>
    Boolean(leadCity) &&
    (client.scheduleCity === leadCity ||
      client.city.split(" / ").includes(leadCity!));

  return (
    <div className="space-y-6">
      {/* Identity + summary */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-3">
          <SummaryCard label="Clients (scope)" value={data.summary.totalClients} />
          <SummaryCard
            label="Underutilising"
            value={data.summary.underutilisingCount}
            hint="28+ days since last ticket or calendar touch"
          />
          <SummaryCard
            label="Interactions yesterday"
            value={data.summary.interactionsYesterday}
            hint={`${data.summary.eventsYesterday} logged · ${data.summary.ticketsYesterday} HubSpot`}
          />
          <SummaryCard
            label="Clients with open tickets"
            value={data.summary.totalOpenTickets}
            hint="Open HubSpot tickets in scope"
          />
        </div>
        <div className="flex items-center gap-3 text-sm">
          <Badge variant={data.storageMode === "sheet" ? "secondary" : "outline"}>
            {data.storageMode === "sheet" ? "Saved to Google Sheet" : "Local only (not saved)"}
          </Badge>
          {data.hubspotAutoCreate && (
            <Badge variant="outline" className="text-[10px]">
              + HubSpot ticket on save
            </Badge>
          )}
          <span className="text-muted-foreground">Acting as</span>
          <select
            className="rounded-md border bg-background px-2 py-1.5 text-sm"
            value={actingAs}
            onChange={(e) => chooseIdentity(e.target.value as Lead | "")}
          >
            <option value="">Select…</option>
            {LEADS.map((l) => (
              <option key={l} value={l}>
                {l} · {LEAD_CITY[l]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* City summary cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        {data.cities.map((c) => {
          const active = city === c.city;
          const coverage =
            c.totalClients > 0
              ? Math.round((c.touchedThisMonth / c.totalClients) * 100)
              : 0;
          return (
            <button
              key={c.city}
              onClick={() => setCity(active ? "all" : (c.city as CityFilter))}
              className={`rounded-lg border p-4 text-left transition-colors ${
                active ? "border-primary bg-primary/5" : "bg-card hover:bg-muted/50"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold">{c.city}</span>
                <Badge variant="secondary">{c.lead}</Badge>
              </div>
              <p className="mt-1 text-2xl font-bold">{c.totalClients}</p>
              <p className="text-xs text-muted-foreground">clients this city</p>
              <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full ${coverage >= 100 ? "bg-emerald-500" : "bg-primary"}`}
                  style={{ width: `${coverage}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {c.touchedThisMonth}/{c.totalClients} touched in {data.monthLabel} ·{" "}
                {c.untouchedThisMonth} left · {c.clientsWithOpenTickets} open
              </p>
            </button>
          );
        })}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {CITIES.map((c) => (
            <Button
              key={c}
              variant={city === c ? "default" : "outline"}
              size="sm"
              onClick={() => setCity(c)}
            >
              {c === "all" ? "All cities" : c}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setWeek(addDays(data.weekStart, -7))}>
            ← Prev
          </Button>
          <span className="min-w-[130px] text-center text-sm font-medium">
            {formatRange(data.weekStart, data.weekEnd)}
          </span>
          <Button variant="outline" size="sm" onClick={() => setWeek(addDays(data.weekStart, 7))}>
            Next →
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setWeek(todayKey())}>
            This week
          </Button>
        </div>
      </div>

      {!actingAs && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Select who you are (top right) to add or edit calendar entries. Laiba → Islamabad,
          Seemab → Lahore, Labeba → Karachi.
        </p>
      )}

      {data.observanceBanner && (
        <p className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
          Upcoming: {data.observanceBanner}
        </p>
      )}

      {!data.hubspotAutoCreate && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          HubSpot auto-tickets are off. Set{" "}
          <code className="rounded bg-amber-100 px-1">HUBSPOT_AUTO_CREATE_ENGAGEMENT_TICKETS=true</code>{" "}
          on Vercel (and owner IDs) so new calendar entries create tickets.
        </p>
      )}

      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {/* Week schedule */}
      <div>
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
          This week&rsquo;s schedule
        </h2>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {weekDays.map((day) => {
            const dayEvents = eventsByDay.get(day) ?? [];
            const isToday = day === todayKey();
            return (
              <Card key={day} className={isToday ? "border-primary" : undefined}>
                <CardContent className="p-3">
                  <p className="mb-2 text-xs font-semibold">
                    {formatDayLabel(day)}
                    {isToday && <span className="ml-1 text-primary">• today</span>}
                  </p>
                  {dayEvents.length === 0 ? (
                    <p className="text-xs text-muted-foreground">—</p>
                  ) : (
                    <div className="space-y-2">
                      {dayEvents.map((e) => (
                        <button
                          key={e.id}
                          onClick={() => openEdit(e)}
                          className="w-full rounded-md border bg-background p-2 text-left hover:bg-muted/50"
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="truncate text-xs font-medium">{e.clientLabel}</span>
                            {e.time && (
                              <span className="shrink-0 text-[10px] text-muted-foreground">
                                {e.time}
                              </span>
                            )}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-1">
                            <Badge variant={TYPE_VARIANT[e.type]} className="text-[10px]">
                              {ENGAGEMENT_EVENT_TYPE_LABELS[e.type]}
                            </Badge>
                            {e.status !== "planned" && (
                              <Badge variant={STATUS_VARIANT[e.status]} className="text-[10px]">
                                {ENGAGEMENT_EVENT_STATUS_LABELS[e.status]}
                              </Badge>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Client coverage */}
      <div>
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
          Client coverage {city !== "all" && `— ${city}`}
        </h2>
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Client</th>
                <th className="px-3 py-2 font-medium">City / Lead</th>
                <th className="px-3 py-2 font-medium">Last touch</th>
                <th className="px-3 py-2 font-medium">This month</th>
                <th className="px-3 py-2 font-medium">Open</th>
                <th className="px-3 py-2 font-medium">This week</th>
                <th className="px-3 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {data.clients.map((c) => (
                <tr
                  key={c.registryId}
                  className={
                    c.underutilising
                      ? "border-t bg-amber-50/70"
                      : "border-t"
                  }
                >
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium">{c.label}</span>
                      {c.underutilising && (
                        <Badge variant="destructive" className="text-[10px]">
                          Underutilising
                        </Badge>
                      )}
                      {c.status !== "active" && (
                        <Badge variant="outline" className="text-[10px] capitalize">
                          {c.status}
                        </Badge>
                      )}
                    </div>
                    {c.beneficiary && c.beneficiary !== "TBC" && (
                      <div className="text-xs text-muted-foreground">{c.beneficiary}</div>
                    )}
                    {c.prompt && (
                      <div className="mt-0.5 text-[11px] text-amber-800">{c.prompt}</div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {c.city}
                    <span className="text-muted-foreground"> · {c.lead}</span>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {c.lastTouch ? (
                      <>
                        {c.daysSinceTouch}d ago
                        <span className="text-muted-foreground"> · {c.lastTouchSource}</span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">never</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {c.touchedThisMonth ? (
                      <Badge variant="secondary">Touched</Badge>
                    ) : (
                      <Badge variant="destructive">Pending</Badge>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {c.openTicketCount > 0 ? (
                      <Badge variant="outline">{c.openTicketCount}</Badge>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {c.weekEvents.length === 0 ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : (
                        c.weekEvents.map((e) => (
                          <button
                            key={e.id}
                            onClick={() => openEdit(e)}
                            title={`${ENGAGEMENT_EVENT_TYPE_LABELS[e.type]} · ${formatDayLabel(e.date)}`}
                          >
                            <Badge variant={TYPE_VARIANT[e.type]} className="text-[10px]">
                              {formatDayLabel(e.date).split(",")[0]}
                            </Badge>
                          </button>
                        ))
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!canAddFor(c)}
                      title={
                        canAddFor(c)
                          ? "Add entry"
                          : `Only ${c.lead} can add for ${c.city}`
                      }
                      onClick={() =>
                        openAdd({
                          registryId: c.registryId,
                          label: c.label,
                          city: c.scheduleCity,
                        })
                      }
                    >
                      + Add
                    </Button>
                  </td>
                </tr>
              ))}
              {data.clients.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-sm text-muted-foreground">
                    No active clients in this view.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {form && (
        <EventModal
          form={form}
          setForm={setForm}
          hubspotAutoCreate={data.hubspotAutoCreate}
          hubSpotPortalId={data.hubSpotPortalId}
          onSubmit={submitForm}
          onClose={() => setForm(null)}
          onDelete={form.id ? () => removeEvent({ ...form, id: form.id! } as unknown as EngagementEvent) : undefined}
          onComplete={
            form.id && form.status !== "completed"
              ? () => quickPatch({ ...form, id: form.id! } as unknown as EngagementEvent, "completed")
              : undefined
          }
          saving={saving}
          error={error}
        />
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-bold">{value}</p>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function EventModal({
  form,
  setForm,
  hubspotAutoCreate,
  hubSpotPortalId,
  onSubmit,
  onClose,
  onDelete,
  onComplete,
  saving,
  error,
}: {
  form: FormState;
  setForm: (f: FormState) => void;
  hubspotAutoCreate: boolean;
  hubSpotPortalId: string | null;
  onSubmit: () => void;
  onClose: () => void;
  onDelete?: () => void;
  onComplete?: () => void;
  saving: boolean;
  error: string | null;
}) {
  const doctors = listDoctorsForPicker(form.clientCity);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <Card className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <CardContent className="space-y-4 p-5">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">
              {form.id ? "Edit entry" : "New entry"} · {form.clientLabel}
            </h3>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
              ✕
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="col-span-2 text-xs font-medium">
              Type
              <select
                className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                value={form.type}
                onChange={(e) => {
                  const type = e.target.value as EngagementEventType;
                  setForm({
                    ...form,
                    type,
                    assignedDoctor:
                      type === "psychologist_call"
                        ? "Dr Farwa"
                        : type === "doctor_call"
                          ? form.assignedDoctor || defaultDoctorForCity(form.clientCity)
                          : "",
                  });
                }}
              >
                {EVENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {ENGAGEMENT_EVENT_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </label>

            {form.type === "doctor_call" && (
              <label className="col-span-2 text-xs font-medium">
                Assign doctor
                <select
                  className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                  value={form.assignedDoctor}
                  onChange={(e) => setForm({ ...form, assignedDoctor: e.target.value })}
                >
                  {doctors.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
                {hubspotAutoCreate && (
                  <span className="mt-1 block text-[11px] text-muted-foreground">
                    HubSpot ticket goes to Dr Wajeeha&rsquo;s bucket; doctor name saved on ticket
                  </span>
                )}
              </label>
            )}

            {form.type === "psychologist_call" && hubspotAutoCreate && (
              <p className="col-span-2 text-[11px] text-muted-foreground">
                HubSpot ticket goes to Dr Farwa&rsquo;s bucket (Psychologist Call).
              </p>
            )}

            {(form.type === "checkin_call" ||
              form.type === "visit" ||
              form.type === "outing" ||
              form.type === "other") &&
              hubspotAutoCreate && (
                <p className="col-span-2 text-[11px] text-muted-foreground">
                  HubSpot ticket stays in Laiba&rsquo;s bucket until completed.
                </p>
              )}

            <label className="text-xs font-medium">
              Date
              <input
                type="date"
                className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
              />
            </label>

            <label className="text-xs font-medium">
              Time (optional)
              <input
                type="time"
                className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                value={form.time}
                onChange={(e) => setForm({ ...form, time: e.target.value })}
              />
            </label>

            <label className="col-span-2 text-xs font-medium">
              Title (optional)
              <input
                type="text"
                placeholder="e.g. Monthly wellness check-in"
                className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </label>

            <label className="col-span-2 text-xs font-medium">
              Notes
              <textarea
                rows={3}
                placeholder="Details of the visit / call…"
                className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </label>

            {form.id && (
              <label className="col-span-2 text-xs font-medium">
                Status
                <select
                  className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                  value={form.status}
                  onChange={(e) =>
                    setForm({ ...form, status: e.target.value as EngagementEventStatus })
                  }
                >
                  {(Object.keys(ENGAGEMENT_EVENT_STATUS_LABELS) as EngagementEventStatus[]).map(
                    (s) => (
                      <option key={s} value={s}>
                        {ENGAGEMENT_EVENT_STATUS_LABELS[s]}
                      </option>
                    )
                  )}
                </select>
              </label>
            )}

            {form.hubspotTicketId && (
              <p className="col-span-2 text-xs text-muted-foreground">
                HubSpot ticket linked:{" "}
                {hubSpotPortalId ? (
                  <a
                    href={`https://app.hubspot.com/contacts/${hubSpotPortalId}/ticket/${form.hubspotTicketId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline"
                  >
                    MOH-{form.hubspotTicketId.slice(-5)}
                  </a>
                ) : (
                  <>MOH-{form.hubspotTicketId.slice(-5)}</>
                )}
              </p>
            )}
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="flex items-center justify-between gap-2">
            <div className="flex gap-2">
              {onDelete && (
                <Button variant="destructive" size="sm" onClick={onDelete} disabled={saving}>
                  Delete
                </Button>
              )}
              {onComplete && (
                <Button variant="secondary" size="sm" onClick={onComplete} disabled={saving}>
                  Mark done
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>
                Cancel
              </Button>
              <Button size="sm" onClick={onSubmit} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
