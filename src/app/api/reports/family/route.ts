import { NextRequest, NextResponse } from "next/server";
import { canonicalRegistryId } from "@/lib/client-registry/registry-id-aliases";
import { ensureCachedSession } from "@/lib/data-source";
import {
  buildFamilyReport,
  defaultReportPeriod,
  listFamiliesForReports,
  parseReportPeriod,
} from "@/lib/reports/family-monthly-report";
import { renderFamilyReportHtml } from "@/lib/reports/family-report-html";
import {
  getCachedFamilyReport,
  invalidateFamilyReportCache,
  setCachedFamilyReport,
  type CachedFamilyReport,
} from "@/lib/reports/report-cache";
import { saveHealthReportOverride } from "@/lib/reports/report-overrides";
import type { HealthReportOverride } from "@/lib/reports/types";

export const dynamic = "force-dynamic";

function getOrBuildReport(
  registryId: string,
  periodKey: string,
  beneficiary: string | undefined,
  period = parseReportPeriod({ month: periodKey }) ??
    parseReportPeriod({
      startDate: periodKey.includes("_") ? periodKey.split("_")[0] : undefined,
      endDate: periodKey.includes("_") ? periodKey.split("_")[1] : undefined,
    })
): CachedFamilyReport | null {
  const canonicalId = canonicalRegistryId(registryId);
  const cached = getCachedFamilyReport(canonicalId, periodKey, beneficiary);
  if (cached) return cached;

  const resolvedPeriod =
    period ??
    (periodKey.match(/^\d{4}-\d{2}$/)
      ? parseReportPeriod({ month: periodKey })
      : null);

  if (!resolvedPeriod) return null;

  const report = buildFamilyReport(canonicalId, resolvedPeriod, beneficiary);
  if (!report) return null;

  const html = renderFamilyReportHtml(report);
  setCachedFamilyReport(canonicalId, periodKey, beneficiary, report, html);
  return { report, html };
}

function resolvePeriodFromRequest(searchParams: URLSearchParams) {
  const month = searchParams.get("month");
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");
  return (
    parseReportPeriod({ month, startDate, endDate }) ?? defaultReportPeriod()
  );
}

export async function GET(request: NextRequest) {
  ensureCachedSession();
  const { searchParams } = request.nextUrl;

  const period = resolvePeriodFromRequest(searchParams);

  if (searchParams.get("list") === "all") {
    return NextResponse.json({
      month: period.monthKey ?? period.cacheKey,
      period,
      families: listFamiliesForReports(period),
    });
  }

  if (searchParams.get("list") === "physio") {
    const { listPhysioSessionsForMonth, groupPhysioSessionsByWeek } = await import(
      "@/lib/reports/physio-sessions"
    );
    const month = period.monthKey ?? period.cacheKey.slice(0, 7);
    const sessions = listPhysioSessionsForMonth(month);
    const byWeek = Object.fromEntries(groupPhysioSessionsByWeek(sessions));
    return NextResponse.json({ month, sessions, byWeek, total: sessions.length });
  }

  const registryId = canonicalRegistryId(searchParams.get("registryId") ?? "");
  if (!registryId) {
    return NextResponse.json(
      { error: "registryId is required (or use list=all or list=physio)" },
      { status: 400 }
    );
  }

  const beneficiary = searchParams.get("beneficiary") ?? undefined;
  const format = searchParams.get("format") ?? "json";

  if (format === "notes") {
    const built = getOrBuildReport(registryId, period.cacheKey, beneficiary, period);
    if (!built) {
      return NextResponse.json({ error: "Family not found in registry" }, { status: 404 });
    }
    return NextResponse.json({ health: built.report.health });
  }

  const built = getOrBuildReport(registryId, period.cacheKey, beneficiary, period);
  if (!built) {
    return NextResponse.json({ error: "Family not found in registry" }, { status: 404 });
  }

  const { report, html } = built;

  if (format === "html") {
    return new NextResponse(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  if (format === "preview") {
    return NextResponse.json({ report, html });
  }

  return NextResponse.json(report);
}

export async function PATCH(request: NextRequest) {
  ensureCachedSession();
  const body = (await request.json()) as HealthReportOverride & {
    registryId: string;
    month: string;
    startDate?: string;
    endDate?: string;
  };

  const { registryId, month, startDate, endDate, ...patch } = body;
  if (!registryId) {
    return NextResponse.json({ error: "registryId is required" }, { status: 400 });
  }

  const period =
    parseReportPeriod({ month, startDate, endDate }) ??
    (month ? parseReportPeriod({ month }) : null);
  if (!period) {
    return NextResponse.json({ error: "Invalid report period" }, { status: 400 });
  }

  const saved = saveHealthReportOverride(canonicalRegistryId(registryId), period.cacheKey, patch);
  invalidateFamilyReportCache();
  const report = buildFamilyReport(canonicalRegistryId(registryId), period);

  return NextResponse.json({ ok: true, override: saved, report });
}

export async function PUT(request: NextRequest) {
  return PATCH(request);
}
