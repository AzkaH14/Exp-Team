"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
}

export function ClientRegistryHub({ initial }: { initial: RegistryResponse }) {
  const [data, setData] = useState(initial);
  const [filter, setFilter] = useState<"all" | "incomplete" | "hubspot_new" | "paused" | "suspect">("all");
  const [editing, setEditing] = useState<MergedClientProfile | null>(null);
  const [loadingEdit, setLoadingEdit] = useState(false);
  const [editor, setEditor] = useState(EDITORS[0]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    beneficiaryBirthday: "",
    interests: "",
    engagementNotes: "",
    beneficiaryName: "",
  });

  const filtered = useMemo(() => {
    return data.profiles.filter((p) => {
      if (filter === "incomplete") return p.profileCompleteness < 100;
      if (filter === "hubspot_new") return p.signupDate === null && p.hubspotTicketCount > 0;
      if (filter === "paused")
        return p.status === "pause" || p.status === "gratis" || p.status === "cancelled";
      if (filter === "suspect")
        return data.reconcile.rows.some(
          (r) => r.registryId === p.id && r.isTestSuspect
        );
      return true;
    });
  }, [data, filter]);

  const openEdit = async (p: ClientProfileListItem) => {
    setLoadingEdit(true);
    try {
      const res = await fetch(`/api/client-registry/${p.id}`);
      if (!res.ok) throw new Error("Failed to load profile");
      const body = (await res.json()) as { profile: MergedClientProfile };
      const full = body.profile;
      setEditing(full);
      setForm({
        beneficiaryBirthday: full.resolvedBeneficiaryBirthday ?? "",
        interests: (full.overrides.interests ?? full.enrichment?.interests ?? []).join(", "),
        engagementNotes: full.overrides.engagementNotes ?? "",
        beneficiaryName: full.beneficiary === "—" ? "" : full.beneficiary,
      });
    } catch (e) {
      console.error(e);
      // Fallback: open with list row fields so edit still works without notes
      setEditing(p as unknown as MergedClientProfile);
      setForm({
        beneficiaryBirthday: p.resolvedBeneficiaryBirthday ?? "",
        interests: (p.overrides.interests ?? p.enrichment?.interests ?? []).join(", "),
        engagementNotes: p.overrides.engagementNotes ?? "",
        beneficiaryName: p.beneficiary === "—" ? "" : p.beneficiary,
      });
    } finally {
      setLoadingEdit(false);
    }
  };

  const save = useCallback(async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/client-registry/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          updatedBy: editor,
          beneficiaryBirthday: form.beneficiaryBirthday || null,
          interests: form.interests
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          engagementNotes: form.engagementNotes || undefined,
          beneficiaryName: form.beneficiaryName || undefined,
        }),
      });
      if (!res.ok) throw new Error("Save failed");
      const refresh = await fetch("/api/client-registry");
      setData((await refresh.json()) as RegistryResponse);
      setEditing(null);
    } finally {
      setSaving(false);
    }
  }, [editing, editor, form]);

  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setEditing(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing]);

  const { summary } = data.reconcile;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Sacred registry</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{summary.sacredTotal}</p>
            <p className="text-xs text-muted-foreground">
              {summary.sacredActive} active · {summary.sacredPause} pause ·{" "}
              {summary.sacredCancelled} cancelled · {summary.sacredGratis} gratis
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">HubSpot matched</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{summary.matched}</p>
            <p className="text-xs text-muted-foreground">
              of {summary.hubspotUniqueClients} HubSpot names
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Needs profile</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{summary.hubspotOnly}</p>
            <p className="text-xs text-muted-foreground">New HubSpot-only contacts</p>
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
          <CardTitle className="text-base">HubSpot reconciliation</CardTitle>
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
        {(
          [
            ["all", "All clients"],
            ["incomplete", "Missing info"],
            ["hubspot_new", "HubSpot new"],
            ["paused", "Paused / cancelled"],
            ["suspect", "Review suspects"],
          ] as const
        ).map(([id, label]) => (
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
          {filtered.map((p) => (
            <TableRow key={p.id}>
              <TableCell className="font-medium">{p.benefactor}</TableCell>
              <TableCell className="max-w-[160px] truncate text-xs">
                {p.beneficiary}
                {p.hubspotNotes?.beneficiaryNames &&
                p.hubspotNotes.beneficiaryNames.length > 0 &&
                p.hubspotNotes.beneficiaryNames.join(" / ") !== p.beneficiary ? (
                  <span className="mt-0.5 block text-[10px] text-muted-foreground">
                    {p.hubspotNotes.beneficiaryNames.join(" · ")}
                  </span>
                ) : null}
              </TableCell>
              <TableCell>{p.city}</TableCell>
              <TableCell>
                <Badge
                  variant={
                    p.status === "pause"
                      ? "warning"
                      : p.status === "cancelled"
                        ? "destructive"
                        : p.status === "gratis"
                          ? "secondary"
                          : "success"
                  }
                >
                  {p.status}
                </Badge>
              </TableCell>
              <TableCell className="text-xs">
                {p.resolvedBeneficiaryBirthday ? (
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
              </TableCell>
              <TableCell>{p.hubspotTicketCount}</TableCell>
              <TableCell>
                <Badge variant={p.profileCompleteness === 100 ? "success" : "warning"}>
                  {p.profileCompleteness}%
                </Badge>
              </TableCell>
              <TableCell className="max-w-[120px] truncate text-xs text-muted-foreground">
                {p.hubspotNotes?.noteCount ? (
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
          ))}
        </TableBody>
      </Table>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <Card className="max-h-[90vh] w-full max-w-lg overflow-y-auto">
            <CardHeader>
              <CardTitle className="text-base">Edit profile — {editing.benefactor}</CardTitle>
              <p className="text-xs text-muted-foreground">
                Beneficiary (parent) details for Laiba, Labeba &amp; Seemab — Mohsyn serves the
                beneficiaries, not the benefactor contact
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
                  onChange={(e) =>
                    setForm((f) => ({ ...f, beneficiaryBirthday: e.target.value }))
                  }
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
                  {editing.hubspotNotes.beneficiaryNames &&
                    editing.hubspotNotes.beneficiaryNames.length > 0 && (
                      <p className="mt-1 text-[11px]">
                        Beneficiaries:{" "}
                        <span className="text-foreground">
                          {editing.hubspotNotes.beneficiaryNames.join(" · ")}
                        </span>
                      </p>
                    )}
                  <ul className="mt-1 max-h-56 space-y-2 overflow-y-auto">
                    {editing.hubspotNotes.notes.map((note) => (
                      <li key={note.id} className="whitespace-pre-wrap rounded border bg-white/70 p-2">
                        <div className="mb-1 flex flex-wrap items-center gap-1">
                          <Badge
                            variant={note.source === "meeting" ? "secondary" : "outline"}
                            className="text-[10px]"
                          >
                            {note.source === "meeting" ? "Meeting" : "Customer note"}
                          </Badge>
                          {note.title ? (
                            <span className="text-[11px] font-medium text-foreground">
                              {note.title}
                            </span>
                          ) : null}
                        </div>
                        {note.body}
                        {note.createdAt && (
                          <span className="mt-1 block text-[10px] text-muted-foreground">
                            {new Date(note.createdAt).toLocaleDateString("en-GB", {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            })}
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
                  onChange={(e) =>
                    setForm((f) => ({ ...f, engagementNotes: e.target.value }))
                  }
                />
              </label>
              {editing.enrichment?.generalOverview && (
                <p className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
                  <strong>Overview:</strong> {editing.enrichment.generalOverview}
                </p>
              )}
              {editing.enrichment?.medicalHighlights &&
                editing.enrichment.medicalHighlights.length > 0 && (
                <div className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
                  <strong>Medical highlights:</strong>
                  <ul className="mt-1 list-disc pl-4">
                    {editing.enrichment.medicalHighlights.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                </div>
              )}
              {editing.resolvedEngagementNotes.length > 0 &&
                !editing.hubspotNotes?.notes.length &&
                !editing.enrichment?.engagementNotes?.length && (
                <div className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
                  <strong>Engagement notes:</strong>
                  <ul className="mt-1 list-disc space-y-1 pl-4">
                    {editing.resolvedEngagementNotes.map((note) => (
                      <li key={note} className="whitespace-pre-wrap">
                        {note}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {editing.enrichment?.engagementNotes &&
                editing.enrichment.engagementNotes.length > 0 && (
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
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
                <Button onClick={() => void save()} disabled={saving}>
                  {saving ? "Saving…" : "Save"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
