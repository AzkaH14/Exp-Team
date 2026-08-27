"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  FamilyMonthlyReport,
  FamilyProfileContext,
  FamilyReportListItem,
  HealthReportOverride,
} from "@/lib/reports/types";
import type { ReportPeriodInput } from "@/lib/reports/report-period";
import { appendPeriodToSearchParams } from "@/lib/reports/report-period";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FamilyProfilePanel } from "@/components/dashboard/family-profile-panel";
import { ExternalLink, Printer } from "lucide-react";

interface FamilyReportsHubProps {
  initialPeriod: ReportPeriodInput;
  initialFamilies: FamilyReportListItem[];
}

const PREVIEW_DEBOUNCE_MS = 300;

function healthToOverride(
  health: FamilyMonthlyReport["health"] | undefined
): HealthReportOverride {
  return {
    subjectName: health?.subjectName,
    physiotherapist: health?.physiotherapist,
    fieldDoctor: health?.fieldDoctor,
    seniorConsultant: health?.seniorConsultant,
    wellnessCounsellor: health?.wellnessCounsellor,
    overallTrend: health?.overallTrend,
    careSchedule: health?.careSchedule,
    recommendedFocus: health?.recommendedFocus,
    domainScores: health?.domainScores,
  };
}

export function FamilyReportsHub({
  initialPeriod,
  initialFamilies,
}: FamilyReportsHubProps) {
  const [periodMode, setPeriodMode] = useState<ReportPeriodInput["mode"]>(initialPeriod.mode);
  const [month, setMonth] = useState(initialPeriod.month ?? "");
  const [startDate, setStartDate] = useState(initialPeriod.startDate ?? "");
  const [endDate, setEndDate] = useState(initialPeriod.endDate ?? "");
  const periodInput: ReportPeriodInput = useMemo(() => {
    if (periodMode === "month") {
      return { mode: "month", month };
    }
    if (periodMode === "week") {
      return { mode: "week", startDate };
    }
    return { mode: "range", startDate, endDate };
  }, [periodMode, month, startDate, endDate]);
  const [families, setFamilies] = useState(initialFamilies);
  const [registryId, setRegistryId] = useState(initialFamilies[0]?.registryId ?? "");
  const [beneficiary, setBeneficiary] = useState("");
  const [listLoading, setListLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(
    Boolean(initialFamilies[0]?.registryId)
  );
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewBlobUrl, setPreviewBlobUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [override, setOverride] = useState<HealthReportOverride>({});
  const [profile, setProfile] = useState<FamilyProfileContext | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const previewRequestId = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  const selected = useMemo(
    () => families.find((f) => f.registryId === registryId),
    [families, registryId]
  );

  const beneficiaryOptions = useMemo(() => {
    if (!selected?.beneficiary || selected.beneficiary === "TBC") return [];
    return selected.beneficiary
      .split(/\s*(?:\/|&|,|;|\band\b)\s*/i)
      .map((p) => p.trim())
      .filter(Boolean);
  }, [selected]);

  const htmlOpenUrl = useMemo(() => {
    if (!registryId) return null;
    const params = new URLSearchParams({ registryId, format: "html" });
    appendPeriodToSearchParams(params, periodInput);
    if (beneficiary.trim()) params.set("beneficiary", beneficiary.trim());
    return `/api/reports/family?${params}`;
  }, [registryId, periodInput, beneficiary]);

  const revokeBlobUrl = useCallback((url: string | null) => {
    if (url) URL.revokeObjectURL(url);
  }, []);

  const setBlobPreview = useCallback(
    (html: string) => {
      const blob = new Blob([html], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      revokeBlobUrl(blobUrlRef.current);
      blobUrlRef.current = url;
      setPreviewBlobUrl(url);
    },
    [revokeBlobUrl]
  );

  const fetchPreview = useCallback(
    async (familyId: string, period: ReportPeriodInput, ben: string) => {
      const requestId = ++previewRequestId.current;
      setPreviewLoading(true);
      setPreviewError(null);

      try {
        const params = new URLSearchParams({
          registryId: familyId,
          format: "preview",
        });
        appendPeriodToSearchParams(params, period);
        if (ben.trim()) params.set("beneficiary", ben.trim());

        const res = await fetch(`/api/reports/family?${params}`);
        if (!res.ok) throw new Error("Failed to load preview");
        if (requestId !== previewRequestId.current) return;

        const data = (await res.json()) as {
          report: FamilyMonthlyReport;
          html: string;
        };
        if (requestId !== previewRequestId.current) return;

        setOverride(healthToOverride(data.report.health));
        setProfile(data.report.profile ?? null);
        setBlobPreview(data.html);
      } catch {
        if (requestId !== previewRequestId.current) return;
        setPreviewError("Could not load report preview. Try Sync now, then refresh.");
      } finally {
        if (requestId === previewRequestId.current) {
          setPreviewLoading(false);
        }
      }
    },
    [setBlobPreview]
  );

  const fetchFamilies = useCallback(
    async (period: ReportPeriodInput) => {
      setListLoading(true);
      try {
        const params = new URLSearchParams({ list: "all" });
        appendPeriodToSearchParams(params, period);
        const res = await fetch(`/api/reports/family?${params}`);
        if (!res.ok) return;
        const data = (await res.json()) as { families: FamilyReportListItem[] };
        setFamilies(data.families);
        if (!data.families.some((f) => f.registryId === registryId)) {
          setRegistryId(data.families[0]?.registryId ?? "");
        }
      } finally {
        setListLoading(false);
      }
    },
    [registryId]
  );

  useEffect(() => {
    const periodKey = JSON.stringify(periodInput);
    if (periodKey === JSON.stringify(initialPeriod)) return;
    void fetchFamilies(periodInput);
  }, [periodInput, fetchFamilies, initialPeriod]);

  useEffect(() => {
    if (!registryId) {
      revokeBlobUrl(blobUrlRef.current);
      blobUrlRef.current = null;
      setPreviewBlobUrl(null);
      setPreviewLoading(false);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      void fetchPreview(registryId, periodInput, beneficiary);
    }, PREVIEW_DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [registryId, periodInput, beneficiary, fetchPreview, revokeBlobUrl]);

  useEffect(() => {
    return () => {
      revokeBlobUrl(blobUrlRef.current);
      blobUrlRef.current = null;
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [revokeBlobUrl]);

  const saveClinicalNotes = async () => {
    if (!registryId) return;
    setSaving(true);
    try {
      const res = await fetch("/api/reports/family", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          registryId,
          month: periodInput.month,
          startDate: periodInput.startDate,
          endDate: periodInput.endDate,
          ...override,
          updatedBy: "Care team",
        }),
      });
      if (!res.ok) return;
      await fetchPreview(registryId, periodInput, beneficiary);
    } finally {
      setSaving(false);
    }
  };

  const handlePrint = () => {
    const win = iframeRef.current?.contentWindow;
    if (win) win.print();
  };

  const handleOpenPdf = () => {
    if (!htmlOpenUrl) return;
    window.open(htmlOpenUrl, "_blank", "noopener,noreferrer");
  };

  const loading = listLoading || previewLoading;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Report settings</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <label className="space-y-1.5 text-sm">
            <span className="font-medium text-muted-foreground">Report period</span>
            <select
              value={periodMode}
              onChange={(e) =>
                setPeriodMode(e.target.value as ReportPeriodInput["mode"])
              }
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
            >
              <option value="month">Monthly</option>
              <option value="week">Weekly</option>
              <option value="range">Custom date range</option>
            </select>
          </label>

          {periodMode === "month" ? (
            <label className="space-y-1.5 text-sm">
              <span className="font-medium text-muted-foreground">Month</span>
              <input
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
              />
            </label>
          ) : periodMode === "week" ? (
            <label className="space-y-1.5 text-sm">
              <span className="font-medium text-muted-foreground">Week starting</span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
              />
            </label>
          ) : (
            <>
              <label className="space-y-1.5 text-sm">
                <span className="font-medium text-muted-foreground">From</span>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                />
              </label>
              <label className="space-y-1.5 text-sm">
                <span className="font-medium text-muted-foreground">To</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                />
              </label>
            </>
          )}

          <label className="space-y-1.5 text-sm">
            <span className="font-medium text-muted-foreground">Family</span>
            <select
              value={registryId}
              onChange={(e) => {
                setRegistryId(e.target.value);
                setBeneficiary("");
              }}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
            >
              {families.length === 0 && (
                <option value="">No families with tickets</option>
              )}
              {families.map((f) => (
                <option key={f.registryId} value={f.registryId}>
                  {f.benefactor}
                  {f.beneficiary && f.beneficiary !== "TBC" ? ` — ${f.beneficiary}` : ""}
                  {" "}({f.ticketCount} tickets)
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1.5 text-sm">
            <span className="font-medium text-muted-foreground">
              Beneficiary focus (optional)
            </span>
            {beneficiaryOptions.length > 0 ? (
              <select
                value={beneficiary}
                onChange={(e) => setBeneficiary(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
              >
                <option value="">Whole family</option>
                {beneficiaryOptions.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={beneficiary}
                onChange={(e) => setBeneficiary(e.target.value)}
                placeholder="e.g. Shehnaz"
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
              />
            )}
          </label>

          <div className="flex items-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handlePrint}
              disabled={!previewBlobUrl || loading}
            >
              <Printer className="mr-1.5 h-4 w-4" />
              Print
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleOpenPdf}
              disabled={!htmlOpenUrl || loading}
            >
              <ExternalLink className="mr-1.5 h-4 w-4" />
              Open PDF
            </Button>
          </div>
        </CardContent>
      </Card>

      {selected && (
        <p className="text-sm text-muted-foreground">
          {selected.benefactor} · {selected.city}
          {selected.beneficiary !== "TBC" && ` · ${selected.beneficiary}`}
          {loading && " · Loading…"}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <FamilyProfilePanel profile={profile} loading={previewLoading && !profile} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Clinical notes (physio / consultant)</CardTitle>
          <p className="text-xs text-muted-foreground">
            Part I medical report — domain scores, session milestones, and focus areas
          </p>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-xs font-medium text-muted-foreground">
            Report subject (beneficiary)
            <input
              className="flex h-9 w-full rounded-md border px-2 text-sm"
              value={override.subjectName ?? ""}
              onChange={(e) =>
                setOverride((o) => ({ ...o, subjectName: e.target.value }))
              }
              placeholder="e.g. Ms. Shehnaz"
            />
          </label>
          <label className="space-y-1 text-xs font-medium text-muted-foreground">
            Overall trend
            <input
              className="flex h-9 w-full rounded-md border px-2 text-sm"
              value={override.overallTrend ?? ""}
              onChange={(e) =>
                setOverride((o) => ({ ...o, overallTrend: e.target.value }))
              }
              placeholder="e.g. Positive trajectory"
            />
          </label>
          <label className="space-y-1 text-xs font-medium text-muted-foreground">
            Physiotherapist
            <input
              className="flex h-9 w-full rounded-md border px-2 text-sm"
              value={override.physiotherapist ?? ""}
              onChange={(e) =>
                setOverride((o) => ({ ...o, physiotherapist: e.target.value }))
              }
              placeholder="Auto by city if blank"
            />
          </label>
          <label className="space-y-1 text-xs font-medium text-muted-foreground">
            Field doctor
            <input
              className="flex h-9 w-full rounded-md border px-2 text-sm"
              value={override.fieldDoctor ?? ""}
              onChange={(e) =>
                setOverride((o) => ({ ...o, fieldDoctor: e.target.value }))
              }
              placeholder="Auto by city if blank"
            />
          </label>
          <label className="space-y-1 text-xs font-medium text-muted-foreground">
            Senior consultants
            <input
              className="flex h-9 w-full rounded-md border px-2 text-sm"
              value={override.seniorConsultant ?? ""}
              onChange={(e) =>
                setOverride((o) => ({ ...o, seniorConsultant: e.target.value }))
              }
              placeholder="Dr Wajeeha · Dr Javeria"
            />
          </label>
          <label className="space-y-1 text-xs font-medium text-muted-foreground">
            Wellness counsellor
            <input
              className="flex h-9 w-full rounded-md border px-2 text-sm"
              value={override.wellnessCounsellor ?? ""}
              onChange={(e) =>
                setOverride((o) => ({ ...o, wellnessCounsellor: e.target.value }))
              }
              placeholder="Dr Farwa"
            />
          </label>
          <label className="space-y-1 text-xs font-medium text-muted-foreground md:col-span-2">
            Care schedule
            <textarea
              className="w-full rounded-md border px-2 py-1.5 text-sm"
              rows={2}
              value={override.careSchedule ?? ""}
              onChange={(e) =>
                setOverride((o) => ({ ...o, careSchedule: e.target.value }))
              }
            />
          </label>
          <label className="space-y-1 text-xs font-medium text-muted-foreground md:col-span-2">
            Recommended focus (one per line)
            <textarea
              className="w-full rounded-md border px-2 py-1.5 text-sm"
              rows={4}
              value={(override.recommendedFocus ?? []).join("\n")}
              onChange={(e) =>
                setOverride((o) => ({
                  ...o,
                  recommendedFocus: e.target.value
                    .split("\n")
                    .map((s) => s.trim())
                    .filter(Boolean),
                }))
              }
            />
          </label>
          <div className="md:col-span-2">
            <Button type="button" size="sm" onClick={() => void saveClinicalNotes()} disabled={saving}>
              {saving ? "Saving…" : "Save clinical notes"}
            </Button>
            <p className="mt-2 text-xs text-muted-foreground">
              Care team defaults by city: Islamabad — Isha Ajmal / Dr Abdullah; Lahore — Linta Ajmal /
              Dr Danish; Karachi — Iqra Memon / Abdul Aziz. Seniors: Dr Wajeeha &amp; Dr Javeria.
              Wellness: Dr Farwa. Instacare (EMR) will supply doctor analysis when connected.
            </p>
          </div>
        </CardContent>
      </Card>
      </div>

      {previewError && (
        <div className="space-y-1">
          <p className="text-sm text-destructive">{previewError}</p>
          {htmlOpenUrl && (
            <p className="text-sm">
              <a
                href={htmlOpenUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline"
              >
                If preview doesn&apos;t load, open report directly
              </a>
            </p>
          )}
        </div>
      )}

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {registryId && periodInput ? (
            <div className="relative">
              {previewLoading && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80 text-sm text-muted-foreground">
                  Loading report…
                </div>
              )}
              {previewBlobUrl ? (
                <iframe
                  ref={iframeRef}
                  src={previewBlobUrl}
                  title="Family report preview"
                  className="h-[min(80vh,900px)] w-full border-0 bg-white"
                />
              ) : !previewLoading ? (
                <p className="p-8 text-center text-sm text-muted-foreground">
                  Select a family to preview the monthly report.
                </p>
              ) : null}
            </div>
          ) : (
            <p className="p-8 text-center text-sm text-muted-foreground">
              Select a family to preview the monthly report.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
