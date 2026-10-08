"use client";

import { useCallback, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  TOUCHBASE_CITIES,
  TOUCHBASE_STATUS_LABELS,
  type TouchbaseActivity,
  type TouchbaseCity,
  type TouchbaseCitySummary,
  type TouchbaseData,
  type TouchbaseRow,
  type TouchbaseStatus,
} from "@/lib/types/touchbase";
import { addOneMonth, callFor } from "@/lib/engagement/touchbase-shared";
import { odooTaskUrl } from "@/lib/utils";

type CityFilter = "all" | TouchbaseCity;
type StatusFilter = "all" | TouchbaseStatus;
type SortKey = "benefactor" | "city" | "status" | "callDate" | "nextDue";
interface SortState {
  key: SortKey;
  dir: "asc" | "desc";
}

/** Rows with no value for the sort column always go last, whichever direction. */
function sortValue(r: TouchbaseRow, key: SortKey): string {
  switch (key) {
    case "benefactor":
      return r.benefactor.toLowerCase();
    case "city":
      return String(TOUCHBASE_CITIES.indexOf(r.city));
    case "status":
      return String(STATUS_ORDER.indexOf(r.status));
    case "callDate":
      return callFor(r)?.date ?? "";
    case "nextDue":
      return callFor(r)?.nextDue ?? "";
  }
}

function compareRows(a: TouchbaseRow, b: TouchbaseRow, sort: SortState): number {
  const va = sortValue(a, sort.key);
  const vb = sortValue(b, sort.key);
  if (va !== vb) {
    if (!va) return 1;
    if (!vb) return -1;
    const c = va.localeCompare(vb);
    return sort.dir === "asc" ? c : -c;
  }
  // Ties: city order, then name — the same order as the sheet.
  return (
    TOUCHBASE_CITIES.indexOf(a.city) - TOUCHBASE_CITIES.indexOf(b.city) ||
    a.benefactor.localeCompare(b.benefactor)
  );
}

const STATUS_ORDER: TouchbaseStatus[] = ["pending", "done", "rescheduled", "not_reached"];

const STATUS_STYLE: Record<TouchbaseStatus, string> = {
  pending: "bg-muted text-muted-foreground border-transparent",
  done: "bg-emerald-500/15 text-emerald-700 border-transparent",
  rescheduled: "bg-sky-500/15 text-sky-700 border-transparent",
  not_reached: "bg-amber-500/15 text-amber-700 border-transparent",
};

const STATUS_DOT: Record<TouchbaseStatus, string> = {
  pending: "bg-slate-300",
  done: "bg-emerald-500",
  rescheduled: "bg-sky-500",
  not_reached: "bg-amber-500",
};

function todayKey(): string {
  return new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

function formatDate(dateKey: string): string {
  if (!dateKey) return "";
  const d = new Date(`${dateKey}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return dateKey;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

function coverageTone(pct: number): { bar: string; text: string } {
  if (pct >= 90) return { bar: "bg-emerald-500", text: "text-emerald-700" };
  if (pct >= 50) return { bar: "bg-amber-500", text: "text-amber-700" };
  return { bar: "bg-rose-500", text: "text-rose-700" };
}

function pct(n: number, d: number): number {
  return d > 0 ? Math.round((n / d) * 100) : 0;
}

function summarize(rows: TouchbaseRow[]): TouchbaseCitySummary[] {
  return TOUCHBASE_CITIES.map((city) => {
    const inCity = rows.filter((r) => r.city === city);
    const count = (s: TouchbaseStatus) => inCity.filter((r) => r.status === s).length;
    return {
      city,
      total: inCity.length,
      done: count("done"),
      rescheduled: count("rescheduled"),
      notReached: count("not_reached"),
      pending: count("pending"),
    };
  });
}

interface FormState {
  row: TouchbaseRow;
  status: TouchbaseStatus;
  callDate: string;
  attendee: string;
  note: string;
  nextDue: string;
}

function formFor(row: TouchbaseRow, status?: TouchbaseStatus): FormState {
  const e = row.entry;
  const next = status ?? e?.status ?? row.status;
  const auto = callFor(row);
  const callDate = e?.callDate || auto?.date || (next !== "pending" ? todayKey() : "");
  return {
    row,
    status: next,
    callDate,
    attendee: e?.attendee ?? auto?.attendee ?? "",
    note: e?.note ?? "",
    nextDue: e?.nextDue || (next === "done" && callDate ? addOneMonth(callDate) : ""),
  };
}

/** Storage + Odoo status, shown top-right in the page header. */
export function TouchbaseStatusBadges({ storageMode, odooLive }: Pick<TouchbaseData, "storageMode" | "odooLive">) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <Badge variant={storageMode === "sheet" ? "secondary" : "outline"}>
        {storageMode === "sheet" ? "Saved to Google Sheet" : "Local only (not saved)"}
      </Badge>
      <Badge variant={odooLive ? "success" : "outline"}>{odooLive ? "Odoo live" : "Odoo offline"}</Badge>
    </div>
  );
}

export function TouchbaseTracker({ initial }: { initial: TouchbaseData }) {
  const [data, setData] = useState<TouchbaseData>(initial);
  const [city, setCity] = useState<CityFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  // Most recent calls first; benefactors not yet called follow, by city and name.
  const [sort, setSort] = useState<SortState>({ key: "callDate", dir: "desc" });
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const loadMonth = useCallback(async (month: string) => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/touchbase?month=${month}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not load month");
      setData(json as TouchbaseData);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load month");
    } finally {
      setLoading(false);
    }
  }, []);

  const totals = useMemo(() => {
    const t = { total: 0, done: 0, rescheduled: 0, notReached: 0, pending: 0 };
    for (const c of data.cities) {
      t.total += c.total;
      t.done += c.done;
      t.rescheduled += c.rescheduled;
      t.notReached += c.notReached;
      t.pending += c.pending;
    }
    return t;
  }, [data.cities]);
  const attempted = totals.done + totals.rescheduled + totals.notReached;

  const cityRows = useMemo(
    () => (city === "all" ? data.rows : data.rows.filter((r) => r.city === city)),
    [data.rows, city]
  );

  const statusCounts = useMemo(() => {
    const counts: Record<StatusFilter, number> = { all: cityRows.length, pending: 0, done: 0, rescheduled: 0, not_reached: 0 };
    for (const r of cityRows) counts[r.status]++;
    return counts;
  }, [cityRows]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = cityRows.filter(
      (r) =>
        (status === "all" || r.status === status) &&
        (!q ||
          r.benefactor.toLowerCase().includes(q) ||
          (r.benefactorCode ?? "").toLowerCase().includes(q) ||
          (r.entry?.attendee ?? "").toLowerCase().includes(q) ||
          (r.entry?.note ?? "").toLowerCase().includes(q))
    );
    return filtered.sort((a, b) => compareRows(a, b, sort));
  }, [cityRows, status, query, sort]);

  const toggleSort = (key: SortKey) =>
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "callDate" || key === "nextDue" ? "desc" : "asc" }
    );

  const save = async (f: FormState) => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/touchbase", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          month: data.month,
          registryId: f.row.registryId,
          city: f.row.city,
          status: f.status,
          callDate: f.callDate,
          attendee: f.attendee,
          note: f.note,
          nextDue: f.nextDue,
          updatedBy: f.attendee,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not save");
      setData((prev) => {
        const rows = prev.rows.map((r) =>
          r.registryId === f.row.registryId
            ? { ...r, entry: json.entry, status: json.entry.status, statusSource: "logged" as const }
            : r
        );
        const attendees = f.attendee && !prev.attendees.includes(f.attendee)
          ? [...prev.attendees, f.attendee]
          : prev.attendees;
        return { ...prev, rows, cities: summarize(rows), attendees };
      });
      setForm(null);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  };

  const isCurrentMonth = data.month === todayKey().slice(0, 7);

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-3">
          <SummaryCard label="Benefactors (scope)" value={totals.total} hint="Active + Gratis, six cities" />
          <SummaryCard
            label="Done"
            value={totals.done}
            hint={`${pct(totals.done, totals.total)}% coverage in ${data.monthLabel}`}
            tone={coverageTone(pct(totals.done, totals.total)).text}
          />
          <SummaryCard
            label="Attempted"
            value={attempted}
            hint={`${totals.rescheduled} rescheduled · ${totals.notReached} not reached`}
          />
          <SummaryCard label="Pending" value={totals.pending} hint="No touch yet this month" />
        </div>
      </div>

      {/* City coverage cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        {data.cities.map((c) => {
          const active = city === c.city;
          const coverage = pct(c.done, c.total);
          const tone = coverageTone(coverage);
          return (
            <button
              key={c.city}
              onClick={() => setCity(active ? "all" : c.city)}
              className={`rounded-lg border p-4 text-left transition-colors ${
                active ? "border-primary bg-primary/5" : "bg-card hover:bg-muted/50"
              } ${c.total === 0 ? "opacity-60" : ""}`}
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold">{c.city}</span>
                {c.total > 0 && <span className={`text-xs font-semibold ${tone.text}`}>{coverage}%</span>}
              </div>
              <p className="mt-1 text-2xl font-bold">{c.total}</p>
              <p className="text-xs text-muted-foreground">benefactors</p>
              <div className="mt-3 flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div className={`h-full ${tone.bar}`} style={{ width: `${coverage}%` }} />
                <div className="h-full bg-sky-400" style={{ width: `${pct(c.rescheduled, c.total)}%` }} />
                <div className="h-full bg-amber-300" style={{ width: `${pct(c.notReached, c.total)}%` }} />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {c.total === 0
                  ? "No benefactors in Odoo yet"
                  : [
                      `${c.done} of ${c.total} done`,
                      `${c.pending} pending`,
                      c.rescheduled ? `${c.rescheduled} rescheduled` : "",
                      c.notReached ? `${c.notReached} not reached` : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
              </p>
            </button>
          );
        })}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {city === "all" ? (
          <p className="text-xs text-muted-foreground">Showing all cities — click a city card to filter</p>
        ) : (
          <button
            onClick={() => setCity("all")}
            className="inline-flex items-center gap-2 rounded-full border border-primary bg-primary/10 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/15"
          >
            Showing {city}
            <span aria-label="Clear city filter">✕</span>
          </button>
        )}
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => loadMonth(shiftMonth(data.month, -1))}>
            ← Prev
          </Button>
          <span className="min-w-[130px] text-center text-sm font-medium">{data.monthLabel}</span>
          <Button variant="outline" size="sm" onClick={() => loadMonth(shiftMonth(data.month, 1))}>
            Next →
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={isCurrentMonth}
            onClick={() => loadMonth(todayKey().slice(0, 7))}
          >
            This month
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {(["all", ...STATUS_ORDER] as StatusFilter[]).map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                status === s ? "border-primary bg-primary/10 text-primary" : "bg-card text-muted-foreground hover:bg-muted"
              }`}
            >
              {s !== "all" && <span className={`h-2 w-2 rounded-full ${STATUS_DOT[s]}`} />}
              {s === "all" ? "All" : TOUCHBASE_STATUS_LABELS[s]}
              <span className="text-muted-foreground">{statusCounts[s]}</span>
            </button>
          ))}
        </div>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search benefactor, ID, attendee, note…"
          className="w-full max-w-xs rounded-md border bg-background px-3 py-1.5 text-sm"
        />
      </div>

      {loading && <p className="text-sm text-muted-foreground">Loading {data.monthLabel}…</p>}
      {loadError && (
        <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{loadError}</p>
      )}
      {data.sheetError && (
        <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          Google Sheet sync failed — {data.sheetError.slice(0, 200)}
        </p>
      )}
      {data.storageMode === "memory" && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Google Sheet not connected — updates are kept on this server only. Share the Experience Calendar sheet with the
          service account to save them to the “Benefactor Tracker” tab.
        </p>
      )}

      {/* Tracker table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-xs font-medium text-muted-foreground">
                  <th className="w-10 px-3 py-2.5">#</th>
                  <SortHeader label="Benefactor" k="benefactor" sort={sort} onSort={toggleSort} />
                  <SortHeader label="City" k="city" sort={sort} onSort={toggleSort} />
                  <SortHeader label="Status" k="status" sort={sort} onSort={toggleSort} />
                  <SortHeader label="Date of call" k="callDate" sort={sort} onSort={toggleSort} />
                  <th className="px-3 py-2.5">Attendee</th>
                  <th className="px-3 py-2.5">Note</th>
                  <SortHeader label="Next due" k="nextDue" sort={sort} onSort={toggleSort} />
                </tr>
              </thead>
              <tbody>
                {visible.map((r, i) => (
                  <tr
                    key={r.registryId}
                    onClick={() => {
                      setSaveError(null);
                      setForm(formFor(r));
                    }}
                    className="cursor-pointer border-b align-top transition-colors last:border-0 hover:bg-muted/40"
                  >
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">{i + 1}</td>
                    <td className="px-3 py-2.5">
                      <div className="font-medium">{r.benefactor}</div>
                      {r.benefactorCode && (
                        <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">{r.benefactorCode}</div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">{r.city}</td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLE[r.status]}`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[r.status]}`} />
                        {TOUCHBASE_STATUS_LABELS[r.status]}
                      </span>
                      {r.statusSource === "auto" && (
                        <div className="mt-0.5 text-[10px] text-muted-foreground">from Odoo / calendar</div>
                      )}
                    </td>
                    <CallCells row={r} />
                    <td className="max-w-[320px] px-3 py-2.5">
                      {r.entry?.note ? (
                        <p className="line-clamp-2 text-xs text-muted-foreground" title={r.entry.note}>
                          {r.entry.note}
                        </p>
                      ) : (
                        <Dash />
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5">{formatDate(callFor(r)?.nextDue ?? "") || <Dash />}</td>
                  </tr>
                ))}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-3 py-10 text-center text-sm text-muted-foreground">
                      No benefactors match these filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Done = a conversation took place. Attempted = Done + Rescheduled + Not reached. Coverage = Done ÷ benefactors —
        green 90%+, amber 50–89%, red below 50%. Rows without a logged entry turn Done automatically when a completed
        Engagement Call / Visit or City Owner Visit exists in Odoo or the calendar this month.
      </p>

      {form && (
        <EntryModal
          form={form}
          setForm={setForm}
          attendees={data.attendees}
          odooUrl={data.odooUrl}
          monthLabel={data.monthLabel}
          saving={saving}
          error={saveError}
          onClose={() => setForm(null)}
          onSave={() => save(form)}
        />
      )}
    </div>
  );
}

function SortHeader({
  label,
  k,
  sort,
  onSort,
}: {
  label: string;
  k: SortKey;
  sort: SortState;
  onSort: (k: SortKey) => void;
}) {
  const active = sort.key === k;
  return (
    <th className="px-3 py-2.5" aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button
        onClick={() => onSort(k)}
        className={`inline-flex items-center gap-1 hover:text-foreground ${active ? "text-foreground" : ""}`}
      >
        {label}
        <span className={active ? "" : "opacity-30"}>{active && sort.dir === "asc" ? "↑" : "↓"}</span>
      </button>
    </th>
  );
}

function Dash() {
  return <span className="text-muted-foreground/50">—</span>;
}

function CallCells({ row }: { row: TouchbaseRow }) {
  const call = callFor(row);
  const hint = call?.auto ? <div className="text-[10px] text-muted-foreground">from Odoo</div> : null;
  return (
    <>
      <td className="whitespace-nowrap px-3 py-2.5">
        {call?.date ? (
          <>
            {formatDate(call.date)}
            {hint}
          </>
        ) : (
          <Dash />
        )}
      </td>
      <td className="px-3 py-2.5">{call?.attendee || <Dash />}</td>
    </>
  );
}

function SummaryCard({ label, value, hint, tone }: { label: string; value: number; hint?: string; tone?: string }) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-2xl font-bold ${tone ?? ""}`}>{value}</p>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function EntryModal({
  form,
  setForm,
  attendees,
  odooUrl,
  monthLabel,
  saving,
  error,
  onClose,
  onSave,
}: {
  form: FormState;
  setForm: (f: FormState) => void;
  attendees: string[];
  odooUrl: string | null;
  monthLabel: string;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: () => void;
}) {
  const { row } = form;

  const setStatus = (s: TouchbaseStatus) => {
    const callDate = form.callDate || (s !== "pending" ? todayKey() : "");
    setForm({
      ...form,
      status: s,
      callDate,
      nextDue: form.nextDue || (s === "done" && callDate ? addOneMonth(callDate) : ""),
    });
  };

  const applyActivity = (a: TouchbaseActivity) =>
    setForm({
      ...form,
      status: a.done && a.touch ? "done" : form.status,
      callDate: a.date || form.callDate,
      attendee: form.attendee || a.people[0] || "",
      note: form.note || a.title,
      nextDue: form.nextDue || (a.date ? addOneMonth(a.date) : ""),
    });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <Card className="max-h-[90vh] w-full max-w-lg overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <CardContent className="space-y-4 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold">{row.benefactor}</h3>
              <p className="text-xs text-muted-foreground">
                {[row.benefactorCode, row.city, monthLabel].filter(Boolean).join(" · ")}
                {row.odooPartnerId && odooUrl && (
                  <>
                    {" · "}
                    <a
                      href={`${odooUrl}/odoo/contacts/${row.odooPartnerId}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary hover:underline"
                    >
                      Odoo contact
                    </a>
                  </>
                )}
              </p>
            </div>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
              ✕
            </button>
          </div>

          <div>
            <p className="mb-1.5 text-xs font-medium">Status</p>
            <div className="grid grid-cols-4 gap-1.5">
              {STATUS_ORDER.map((s) => (
                <button
                  key={s}
                  onClick={() => setStatus(s)}
                  className={`rounded-md border px-2 py-1.5 text-xs font-medium transition-colors ${
                    form.status === s ? `${STATUS_STYLE[s]} ring-2 ring-primary/30` : "bg-background hover:bg-muted"
                  }`}
                >
                  {TOUCHBASE_STATUS_LABELS[s]}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs font-medium">
              Date of call
              <input
                type="date"
                value={form.callDate}
                onChange={(e) => setForm({ ...form, callDate: e.target.value })}
                className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              />
            </label>
            <label className="text-xs font-medium">
              Attendee
              <input
                list="touchbase-attendees"
                value={form.attendee}
                onChange={(e) => setForm({ ...form, attendee: e.target.value })}
                placeholder="Who made the call"
                className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              />
              <datalist id="touchbase-attendees">
                {attendees.map((a) => (
                  <option key={a} value={a} />
                ))}
              </datalist>
            </label>
            <label className="col-span-2 text-xs font-medium">
              Note
              <textarea
                rows={4}
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
                placeholder="What was discussed, follow-ups, requests…"
                className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              />
            </label>
            <label className="text-xs font-medium">
              Next touchbase due
              <input
                type="date"
                value={form.nextDue}
                onChange={(e) => setForm({ ...form, nextDue: e.target.value })}
                className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              />
            </label>
            <div className="flex items-end">
              <Button
                variant="ghost"
                size="sm"
                disabled={!form.callDate}
                onClick={() => setForm({ ...form, nextDue: addOneMonth(form.callDate) })}
              >
                +1 month from call
              </Button>
            </div>
          </div>

          {row.activities.length > 0 && (
            <div className="rounded-md border bg-muted/30 p-3">
              <p className="mb-2 text-xs font-medium">Logged elsewhere this month</p>
              <ul className="space-y-1.5">
                {row.activities.map((a) => {
                  return (
                    <li key={a.id} className="flex items-center justify-between gap-2 text-xs">
                      <span className="min-w-0">
                        <Badge variant={a.done ? "success" : "outline"} className="mr-1.5 text-[10px]">
                          {a.source === "odoo" ? "Odoo" : "Calendar"} · {a.stage || "—"}
                        </Badge>
                        {a.odooTaskId && odooUrl ? (
                          <a
                            href={odooTaskUrl(odooUrl, a.odooTaskId)}
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary hover:underline"
                          >
                            {a.title}
                          </a>
                        ) : (
                          a.title
                        )}
                        <span className="text-muted-foreground">
                          {" "}
                          · {formatDate(a.date)}
                          {a.people.length ? ` · ${a.people.join(", ")}` : ""}
                        </span>
                      </span>
                      <Button variant="outline" size="sm" className="h-6 px-2 text-[11px]" onClick={() => applyActivity(a)}>
                        Use
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {error && <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={onSave} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
