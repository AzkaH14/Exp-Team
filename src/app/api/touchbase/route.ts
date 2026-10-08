import { NextRequest, NextResponse } from "next/server";
import { ensureSession } from "@/lib/ensure-session";
import { getSacredRegistry } from "@/lib/client-registry/store";
import {
  getTouchbaseData,
  parseMonthParam,
  saveTouchbaseEntry,
} from "@/lib/engagement/touchbase-data";
import type { TouchbaseEntry, TouchbaseStatus } from "@/lib/types/touchbase";

export const dynamic = "force-dynamic";

const VALID_STATUS: TouchbaseStatus[] = ["pending", "done", "rescheduled", "not_reached"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function GET(request: NextRequest) {
  await ensureSession();
  const month = parseMonthParam(request.nextUrl.searchParams.get("month"));
  try {
    return NextResponse.json(await getTouchbaseData(month));
  } catch (e) {
    console.error("Touchbase tracker failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Tracker failed" },
      { status: 500 }
    );
  }
}

/** Upsert the month's entry for one benefactor. */
export async function PUT(request: NextRequest) {
  await ensureSession();
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const text = (k: string) => (typeof body[k] === "string" ? (body[k] as string).trim() : "");
  const month = text("month");
  const registryId = text("registryId");
  const status = text("status") as TouchbaseStatus;
  const callDate = text("callDate");
  const nextDue = text("nextDue");

  if (!MONTH_RE.test(month)) return NextResponse.json({ error: "month must be YYYY-MM" }, { status: 400 });
  if (!VALID_STATUS.includes(status)) return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  if (callDate && !DATE_RE.test(callDate)) return NextResponse.json({ error: "Date of call must be YYYY-MM-DD" }, { status: 400 });
  if (nextDue && !DATE_RE.test(nextDue)) return NextResponse.json({ error: "Next touchbase due must be YYYY-MM-DD" }, { status: 400 });
  if (status === "done" && !callDate) return NextResponse.json({ error: "Add the date of the call" }, { status: 400 });

  const record = getSacredRegistry().find((r) => r.id === registryId);
  if (!record) return NextResponse.json({ error: "Unknown benefactor" }, { status: 400 });

  const entry: TouchbaseEntry = {
    key: `${month}|${record.id}`,
    month,
    registryId: record.id,
    benefactorCode: record.benefactorCode ?? "",
    benefactor: record.benefactor,
    city: text("city") || record.city,
    status,
    callDate,
    attendee: text("attendee"),
    note: text("note"),
    nextDue,
    updatedBy: text("updatedBy") || text("attendee") || "team",
    updatedAt: new Date().toISOString(),
  };

  try {
    return NextResponse.json({ ok: true, entry: await saveTouchbaseEntry(entry) });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not save" },
      { status: 500 }
    );
  }
}
