"use client";

import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import type {
  ClientProfileListItem,
  ClientReconcileRow,
  ClientRegistrySummary,
  MergedClientProfile,
} from "@/lib/types/client-registry";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const EDITORS = ["Laiba", "Labeba", "Seemab"];

interface RegistryResponse {
  profiles: ClientProfileListItem[];
  reconcile: { rows: ClientReconcileRow[]; summary: ClientRegistrySummary };
  sacredSummary: Record<string, unknown>;
  /** Odoo base URL for "Open in Odoo" links (not a secret). */
  odooUrl?: string | null;
}

type Filter = "all" | "incomplete" | "hubspot_new" | "no_beneficiary" | "paused" | "suspect";

interface MemberForm {
  partnerId: number;
  name: string;
  relationship: string;
  birthday: string;
}

function statusVariant(status: string) {
  return status === "pause"
    ? "warning"
    : status === "cancelled"
      ? "destructive"
      : status === "gratis"
        ? "secondary"
        : "success";
}

function formatNoteDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function ClientRegistryHub({ initial }: { initial: RegistryResponse }) {
  const [data, setData] = useState(initial);
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<MergedClientProfile | null>(null);
  const [loadingEdit, setLoadingEdit] = useState(false);
  const [editor, setEditor] = useState(EDITORS[0]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [form, setForm] = useState({
    beneficiaryBirthday: "",
    interests: "",
    engagementNotes: "",
    beneficiaryName: "",
  });
  const [members, setMembers] = useState<MemberForm[]>([]);
  const [newNote, setNewNote] = useState("");

  const isOdoo = data.profiles.some((p) => p.source === "odoo");
  const odooUrl = data.odooUrl ?? initial.odooUrl ?? null;
  const contactLink = (partnerId: number) =>
    odooUrl ? `${odooUrl}/odoo/contacts/${partnerId}` : null;

  const filtered = useMemo(() => {
    return data.profiles.filter((p) => {
      if (filter === "incomplete") return p.profileCompleteness < 100;
      if (filter === "hubspot_new") return p.signupDate === null && p.hubspotTicketCount > 0;
      if (filter === "no_beneficiary") return (p.odoo?.members.length ?? 0) === 0;
      if (filter === "paused")
        return p.status === "pause" || p.status === "gratis" || p.status === "cancelled";
      if (filter === "suspect")
        return data.reconcile.rows.some(
          (r) => r.registryId === p.id && r.isTestSuspect
        );
      return true;
    });
  }, [data, filter]);

  const loadForm = (full: MergedClientProfile) => {
    setForm({
      beneficiaryBirthday: full.resolvedBeneficiaryBirthday ?? "",
      interests: (
        full.odoo?.interests ??
        full.overrides.interests ??
        full.enrichment?.interests ??
        []
      ).join(", "),
      engagementNotes: full.overrides.engagementNotes ?? "",
      beneficiaryName: full.beneficiary === "—" ? "" : full.beneficiary,
    });
    setMembers(
      (full.odoo?.members ?? []).map((m) => ({
        partnerId: m.partnerId,
        name: m.name,
        relationship: m.relationship,
        birthday: m.birthday ?? "",
      }))
    );
    setNewNote("");
    setSaveError(null);
  };

  const openEdit = async (p: ClientProfileListItem) => {
    setLoadingEdit(true);
    try {
      const res = await fetch(`/api/client-registry/${p.id}`);
      if (!res.ok) throw new Error("Failed to load profile");
      const body = (await res.json()) as { profile: MergedClientProfile };
      setEditing(body.profile);
      loadForm(body.profile);
    } catch (e) {
      console.error(e);
      if (isOdoo) {
        // Odoo edits need the full family record — never write from a partial row.
        setSaveError("Could not load this family from the portal. Try again.");
        return;
      }
      const partial = p as unknown as MergedClientProfile;
      setEditing(partial);
      loadForm(partial);
    } finally {
      setLoadingEdit(false);
    }
  };

  const save = useCallback(async () => {
    if (!editing) return;
    setSaving(true);
    setSaveError(null);
    try {
      const payload = editing.odoo
        ? {
            updatedBy: editor,
            members: members.map((m) => ({
              partnerId: m.partnerId,
              name: m.name,
              birthday: m.birthday || null,
            })),
            interests: form.interests
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
            note: newNote || undefined,
          }
        : {
            updatedBy: editor,
            beneficiaryBirthday: form.beneficiaryBirthday || null,
            interests: form.interests
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
            engagementNotes: form.engagementNotes || undefined,
            beneficiaryName: form.beneficiaryName || undefined,
          };
      const res = await fetch(`/api/client-registry/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "Save failed");
      }
      const refresh = await fetch("/api/client-registry");
      setData((await refresh.json()) as RegistryResponse);
      setEditing(null);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [editing, editor, form, members, newNote]);

  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setEditing(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing]);

  const { summary } = data.reconcile;
  const withoutBeneficiary = data.profiles.filter((p) => (p.odoo?.members.length ?? 0) === 0).length;

  const filters: ReadonlyArray<readonly [Filter, string]> = isOdoo
    ? [
        ["all", "All clients"],
        ["incomplete", "Missing info"],
        ["no_beneficiary", "No beneficiary in Odoo"],
        ["paused", "Paused / churned"],
        ["suspect", "Review suspects"],
      ]
    : [
        ["all", "All clients"],
        ["incomplete", "Missing info"],
        ["hubspot_new", "HubSpot new"],
        ["paused", "Paused / cancelled"],
        ["suspect", "Review suspects"],
      ];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              {isOdoo ? "Odoo benefactors" : "Sacred registry"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{summary.sacredTotal}</p>
            <p className="text-xs text-muted-foreground">
              {summary.sacredActive} active · {summary.sacredPause} pause ·{" "}
              {summary.sacredCancelled} {isOdoo ? "churned" : "cancelled"} ·{" "}
              {summary.sacredGratis} gratis
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              {isOdoo ? "Ticket-matched" : "HubSpot matched"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{summary.matched}</p>
            <p className="text-xs text-muted-foreground">
              of {summary.hubspotUniqueClients} {isOdoo ? "ticket client names" : "HubSpot names"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              {isOdoo ? "No beneficiary linked" : "Needs profile"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{isOdoo ? withoutBeneficiary : summary.hubspotOnly}</p>
            <p className="text-xs text-muted-foreground">
              {isOdoo ? "Add family relations on the Odoo contact" : "New HubSpot-only contacts"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Review / test suspects</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-amber-600">{summary.testSuspects}</p>
            <p className="text-xs text-muted-foreground">Excluded from metrics if test-like</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {isOdoo ? "Ticket reconciliation" : "HubSpot reconciliation"}
          </CardTitle>
        </CardHeader>
        <CardContent className="max-h-48 overflow-y-auto">
          <ul className="space-y-1 text-xs text-muted-foreground">
            {data.reconcile.rows
              .filter((r) => r.isTestSuspect || r.status === "hubspot_only")
              .slice(0, 12)
              .map((r, i) => (
                <li key={i}>
                  <Badge variant={r.isTestSuspect ? "destructive" : "warning"} className="mr-2">
                    {r.status}
                  </Badge>
                  {r.hubspotName ?? r.benefactor} — {r.notes || r.hubspotTickets + " tickets"}
                </li>
              ))}
          </ul>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        {filters.map(([id, label]) => (
          <Button
            key={id}
            size="sm"
            variant={filter === id ? "default" : "outline"}
            onClick={() => setFilter(id)}
          >
            {label}
          </Button>
        ))}
      </div>

      {saveError && !editing && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {saveError}
        </p>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Benefactor</TableHead>
            <TableHead>Beneficiary</TableHead>
            <TableHead>City</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Beneficiary birthday</TableHead>
            <TableHead>Tickets</TableHead>
            <TableHead>Profile</TableHead>
            <TableHead>Notes</TableHead>
            <TableHead>Missing</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((p) => {
            const odooMembers = p.odoo?.members ?? [];
            const tagged = odooMembers.filter((m) => m.isBeneficiary);
            const beneficiaries = tagged.length ? tagged : odooMembers;
            const withBirthday = beneficiaries.filter((m) => m.birthday).length;
            return (
              <TableRow key={p.id}>
                <TableCell className="font-medium">
                  {p.benefactor}
                  {p.benefactorCode ? (
                    <span className="mt-0.5 block text-[10px] font-normal text-muted-foreground">
                      {p.benefactorCode}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="max-w-[200px] text-xs">
                  {p.odoo ? (
                    beneficiaries.length ? (
                      beneficiaries.map((m) => (
                        <span key={m.partnerId} className="block truncate">
                          {m.name}
                          <span className="ml-1 text-[10px] text-muted-foreground">
                            {m.relationship}
                          </span>
                        </span>
                      ))
                    ) : (
                      <span className="text-muted-foreground">Not linked in Odoo</span>
                    )
                  ) : (
                    <span className="block truncate">
                      {p.beneficiary}
                      {p.hubspotNotes?.beneficiaryNames &&
                      p.hubspotNotes.beneficiaryNames.length > 0 &&
                      p.hubspotNotes.beneficiaryNames.join(" / ") !== p.beneficiary ? (
                        <span className="mt-0.5 block text-[10px] text-muted-foreground">
                          {p.hubspotNotes.beneficiaryNames.join(" · ")}
                        </span>
                      ) : null}
                    </span>
                  )}
                </TableCell>
                <TableCell>{p.city}</TableCell>
                <TableCell>
                  <Badge variant={statusVariant(p.status)}>
                    {isOdoo && p.status === "cancelled" ? "churned" : p.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs">
                  {p.odoo ? (
                    beneficiaries.length ? (
                      beneficiaries.map((m) => (
                        <span key={m.partnerId} className="block">
                          {m.birthday ? m.birthday.slice(5) : "—"}
                        </span>
                      ))
                    ) : (
                      "—"
                    )
                  ) : p.resolvedBeneficiaryBirthday ? (
                    <span>
                      {p.resolvedBeneficiaryBirthday.slice(5)}
                      {p.hubspot &&
                      !p.overrides.beneficiaryBirthday &&
                      !p.riskAssessment?.beneficiaryBirthday &&
                      p.hubspot.beneficiaryBirthday ? (
                        <span className="ml-1 text-muted-foreground">(HS)</span>
                      ) : null}
                      {p.riskAssessment &&
                      !p.overrides.beneficiaryBirthday &&
                      p.riskAssessment.beneficiaryBirthday ? (
                        <span className="ml-1 text-muted-foreground">(doc)</span>
                      ) : null}
                    </span>
                  ) : (
                    "—"
                  )}
                  {p.odoo && beneficiaries.length > 1 ? (
                    <span className="block text-[10px] text-muted-foreground">
                      {withBirthday} of {beneficiaries.length}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell>{p.hubspotTicketCount}</TableCell>
                <TableCell>
                  <Badge variant={p.profileCompleteness === 100 ? "success" : "warning"}>
                    {p.profileCompleteness}%
                  </Badge>
                </TableCell>
                <TableCell className="max-w-[140px] truncate text-xs text-muted-foreground">
                  {p.odoo ? (
                    p.odoo.noteCount || p.odoo.hasOverview ? (
                      <span>
                        {p.odoo.hasOverview ? "Overview" : ""}
                        {p.odoo.hasOverview && p.odoo.noteCount ? " · " : ""}
                        {p.odoo.noteCount ? `${p.odoo.noteCount} notes` : ""}
                      </span>
                    ) : (
                      "—"
                    )
                  ) : p.hubspotNotes?.noteCount ? (
                    <span>
                      {p.hubspotNotes.noteCount} HubSpot
                      {p.hubspotNotes.meetingCount
                        ? ` · ${p.hubspotNotes.meetingCount} mtg`
                        : ""}
                    </span>
                  ) : p.enrichmentNoteCount ? (
                    <span>{p.enrichmentNoteCount} doc</span>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground">
                  {p.missingFields.join(", ") || "—"}
                </TableCell>
                <TableCell>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={loadingEdit}
                    onClick={() => void openEdit(p)}
                  >
                    Edit
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <Card className="max-h-[90vh] w-full max-w-lg overflow-y-auto">
            <CardHeader>
              <CardTitle className="text-base">Edit profile — {editing.benefactor}</CardTitle>
              <p className="text-xs text-muted-foreground">
                {editing.odoo ? (
                  <>
                    Saves straight to Odoo.
                    {editing.benefactorCode ? ` ${editing.benefactorCode} · ` : " "}
                    {contactLink(editing.odoo.partnerId) ? (
                      <a
                        className="underline"
                        href={contactLink(editing.odoo.partnerId)!}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open in Odoo
                      </a>
                    ) : null}
                  </>
                ) : (
                  <>
                    Beneficiary (parent) details for Laiba, Labeba &amp; Seemab — Mohsyn serves the
                    beneficiaries, not the benefactor contact
                  </>
                )}
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <label className="block text-xs font-medium">
                Updated by
                <select
                  className="mt-1 w-full rounded-md border px-2 py-1.5 text-sm"
                  value={editor}
                  onChange={(e) => setEditor(e.target.value)}
                >
                  {EDITORS.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>

              {editing.odoo ? (
                <>
                  {members.length === 0 ? (
                    <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
                      No family members are linked to this contact in Odoo. Add them under Family
                      Relations on the Odoo contact, then Sync.
                    </p>
                  ) : (
                    members.map((m, i) => (
                      <div key={m.partnerId} className="rounded-md border p-2">
                        <p className="mb-1 text-[11px] font-medium text-muted-foreground">
                          {m.relationship}
                          {contactLink(m.partnerId) ? (
                            <a
                              className="ml-2 underline"
                              href={contactLink(m.partnerId)!}
                              target="_blank"
                              rel="noreferrer"
                            >
                              contact
                            </a>
                          ) : null}
                        </p>
                        <div className="grid grid-cols-2 gap-2">
                          <label className="block text-xs font-medium">
                            Name
                            <input
                              className="mt-1 w-full rounded-md border px-2 py-1.5 text-sm"
                              value={m.name}
                              onChange={(e) =>
                                setMembers((all) =>
                                  all.map((x, j) => (j === i ? { ...x, name: e.target.value } : x))
                                )
                              }
                            />
                          </label>
                          <label className="block text-xs font-medium">
                            Date of birth
                            <input
                              type="date"
                              className="mt-1 w-full rounded-md border px-2 py-1.5 text-sm"
                              value={m.birthday}
                              onChange={(e) =>
                                setMembers((all) =>
                                  all.map((x, j) =>
                                    j === i ? { ...x, birthday: e.target.value } : x
                                  )
                                )
                              }
                            />
                          </label>
                        </div>
                      </div>
                    ))
                  )}
                  <label className="block text-xs font-medium">
                    Hobbies &amp; interests (comma-separated)
                    <input
                      className="mt-1 w-full rounded-md border px-2 py-1.5 text-sm"
                      placeholder="art, theatre, coffee outings"
                      value={form.interests}
                      onChange={(e) => setForm((f) => ({ ...f, interests: e.target.value }))}
                    />
                    <span className="mt-0.5 block text-[10px] font-normal text-muted-foreground">
                      Saved as the “Hobbies &amp; Interests” section of the Family Overview.
                    </span>
                  </label>
                  <label className="block text-xs font-medium">
                    Add a note to the Odoo chatter
                    <textarea
                      className="mt-1 w-full rounded-md border px-2 py-1.5 text-sm"
                      rows={3}
                      value={newNote}
                      onChange={(e) => setNewNote(e.target.value)}
                    />
                  </label>

                  {editing.odoo.overviewSections.length > 0 && (
                    <div className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
                      <p className="font-medium text-foreground">Family Overview (Odoo)</p>
                      <div className="mt-1 max-h-64 space-y-2 overflow-y-auto">
                        {editing.odoo.overviewSections.map((s, i) => (
                          <div key={`${s.heading}-${i}`}>
                            <p className="font-medium text-foreground">{s.heading}</p>
                            <p className="whitespace-pre-wrap">{s.body}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {editing.odoo.notes.length > 0 && (
                    <div className="rounded-md border border-blue-200 bg-blue-50/60 p-2 text-xs text-muted-foreground">
                      <p className="font-medium text-foreground">Chatter notes (Odoo)</p>
                      <ul className="mt-1 max-h-56 space-y-2 overflow-y-auto">
                        {editing.odoo.notes.map((note) => (
                          <li
                            key={note.id}
                            className="whitespace-pre-wrap rounded border bg-white/70 p-2"
                          >
                            {note.body}
                            <span className="mt-1 block text-[10px] text-muted-foreground">
                              {[note.author, formatNoteDate(note.createdAt)]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              ) : (
                <LegacyEditFields editing={editing} form={form} setForm={setForm} />
              )}

              {saveError && (
                <p className="rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-800">
                  {saveError}
                </p>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
                <Button onClick={() => void save()} disabled={saving}>
                  {saving ? "Saving…" : editing.odoo ? "Save to Odoo" : "Save"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

/** Legacy sheet-registry editor (MOHSYN_REGISTRY_SOURCE=sheet): local overrides file. */
function LegacyEditFields({
  editing,
  form,
  setForm,
}: {
  editing: MergedClientProfile;
  form: { beneficiaryBirthday: string; interests: string; engagementNotes: string; beneficiaryName: string };
  setForm: Dispatch<
    SetStateAction<{
      beneficiaryBirthday: string;
      interests: string;
      engagementNotes: string;
      beneficiaryName: string;
    }>
  >;
}) {
  return (
    <>
      <label className="block text-xs font-medium">
        Beneficiary name
        <input
          className="mt-1 w-full rounded-md border px-2 py-1.5 text-sm"
          value={form.beneficiaryName}
          onChange={(e) => setForm((f) => ({ ...f, beneficiaryName: e.target.value }))}
        />
      </label>
      <label className="block text-xs font-medium">
        Beneficiary birthday (YYYY-MM-DD)
        <input
          type="date"
          className="mt-1 w-full rounded-md border px-2 py-1.5 text-sm"
          value={form.beneficiaryBirthday}
          onChange={(e) => setForm((f) => ({ ...f, beneficiaryBirthday: e.target.value }))}
        />
      </label>
      {editing.riskAssessment && editing.riskAssessment.beneficiaries.length > 0 && (
        <div className="rounded-md border bg-muted/40 p-2 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">From risk assessment docs</p>
          <ul className="mt-1 space-y-0.5">
            {editing.riskAssessment.beneficiaries.map((b) => (
              <li key={b.name}>
                {b.name}
                {b.birthday ? ` — ${b.birthday}` : " — no birthday"}
              </li>
            ))}
          </ul>
        </div>
      )}
      {editing.hubspot && editing.hubspot.beneficiaries.length > 0 && (
        <div className="rounded-md border bg-muted/40 p-2 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">From HubSpot</p>
          <ul className="mt-1 space-y-0.5">
            {editing.hubspot.beneficiaries.map((b) => (
              <li key={`hs-${b.name}`}>
                {b.name}
                {b.birthday ? ` — ${b.birthday}` : " — no birthday"}
                {b.relationship ? ` (${b.relationship})` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
      <label className="block text-xs font-medium">
        Beneficiary interests (comma-separated)
        <input
          className="mt-1 w-full rounded-md border px-2 py-1.5 text-sm"
          placeholder="art, theatre, coffee outings"
          value={form.interests}
          onChange={(e) => setForm((f) => ({ ...f, interests: e.target.value }))}
        />
      </label>
      {editing.hubspotNotes && editing.hubspotNotes.notes.length > 0 && (
        <div className="rounded-md border border-blue-200 bg-blue-50/60 p-2 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">From HubSpot</p>
          <ul className="mt-1 max-h-56 space-y-2 overflow-y-auto">
            {editing.hubspotNotes.notes.map((note) => (
              <li key={note.id} className="whitespace-pre-wrap rounded border bg-white/70 p-2">
                {note.title ? (
                  <span className="mb-1 block text-[11px] font-medium text-foreground">
                    {note.title}
                  </span>
                ) : null}
                {note.body}
                {note.createdAt && (
                  <span className="mt-1 block text-[10px] text-muted-foreground">
                    {formatNoteDate(note.createdAt)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      <label className="block text-xs font-medium">
        Engagement notes (manual override)
        <textarea
          className="mt-1 w-full rounded-md border px-2 py-1.5 text-sm"
          rows={3}
          value={form.engagementNotes}
          onChange={(e) => setForm((f) => ({ ...f, engagementNotes: e.target.value }))}
        />
      </label>
      {editing.enrichment?.generalOverview && (
        <p className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
          <strong>Overview:</strong> {editing.enrichment.generalOverview}
        </p>
      )}
      {editing.enrichment?.medicalHighlights && editing.enrichment.medicalHighlights.length > 0 && (
        <div className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
          <strong>Medical highlights:</strong>
          <ul className="mt-1 list-disc pl-4">
            {editing.enrichment.medicalHighlights.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      )}
      {editing.enrichment?.engagementNotes && editing.enrichment.engagementNotes.length > 0 && (
        <div className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
          <strong>From internal doc:</strong>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {editing.enrichment.engagementNotes.map((note) => (
              <li key={note} className="whitespace-pre-wrap">
                {note}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
