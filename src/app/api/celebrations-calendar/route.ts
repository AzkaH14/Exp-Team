import { NextRequest, NextResponse } from "next/server";
import {
  addCelebrationEvent,
  deleteCelebrationEvent,
  getCelebrationsMonth,
  updateCelebrationEvent,
} from "@/lib/celebrations/calendar-store";
import { kickOffHubSpotProfileRefreshIfStale } from "@/lib/client-registry/refresh-hubspot-profile-cache";
import type {
  CelebrationKind,
  CelebrationRecurrence,
  CelebrationStatus,
} from "@/lib/types/celebrations-calendar";

export const dynamic = "force-dynamic";

const KINDS: CelebrationKind[] = [
  "birthday",
  "anniversary",
  "important_date",
  "holiday",
  "custom",
];
const RECURRENCES: CelebrationRecurrence[] = ["none", "annual"];
const STATUSES: CelebrationStatus[] = ["planned", "completed", "cancelled"];
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function validDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export async function GET(request: NextRequest) {
  const month =
    request.nextUrl.searchParams.get("month") ??
    new Date().toISOString().slice(0, 7);
  if (!MONTH_RE.test(month)) {
    return NextResponse.json({ error: "month must be YYYY-MM" }, { status: 400 });
  }
  kickOffHubSpotProfileRefreshIfStale();
  try {
    return NextResponse.json(await getCelebrationsMonth(month));
  } catch (error) {
    console.error("Celebrations calendar failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Calendar failed" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const date = String(body.date ?? "").trim();
  const time = body.time == null ? null : String(body.time).trim();
  if (!KINDS.includes(body.kind as CelebrationKind)) {
    return NextResponse.json({ error: "Invalid celebration kind" }, { status: 400 });
  }
  if (!validDate(date)) {
    return NextResponse.json({ error: "date must be a valid YYYY-MM-DD date" }, { status: 400 });
  }
  if (time && !TIME_RE.test(time)) {
    return NextResponse.json({ error: "time must be HH:MM" }, { status: 400 });
  }
  const categoryId = String(body.categoryId ?? "").trim();
  if (!categoryId || categoryId.length > 100) {
    return NextResponse.json({ error: "A valid categoryId is required" }, { status: 400 });
  }
  const registryIds = Array.isArray(body.registryIds)
    ? body.registryIds.map(String).map((id) => id.trim()).filter(Boolean)
    : [];

  try {
    const result = await addCelebrationEvent({
      kind: body.kind as CelebrationKind,
      categoryId,
      categoryLabel: typeof body.categoryLabel === "string" ? body.categoryLabel : undefined,
      title: String(body.title ?? "").slice(0, 160),
      date,
      time,
      allDay: body.allDay !== false,
      recurrence: RECURRENCES.includes(body.recurrence as CelebrationRecurrence)
        ? (body.recurrence as CelebrationRecurrence)
        : "none",
      registryIds,
      notes: typeof body.notes === "string" ? body.notes.slice(0, 5000) : "",
      status: STATUSES.includes(body.status as CelebrationStatus)
        ? (body.status as CelebrationStatus)
        : "planned",
      createdBy: "Team",
    });
    return NextResponse.json({ ok: true, ...result }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not create celebration" },
      { status: 400 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const id = String(body.id ?? "").trim();
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  if (body.date !== undefined && !validDate(String(body.date))) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }
  if (body.time && !TIME_RE.test(String(body.time))) {
    return NextResponse.json({ error: "Invalid time" }, { status: 400 });
  }
  if (body.recurrence !== undefined && !RECURRENCES.includes(body.recurrence as CelebrationRecurrence)) {
    return NextResponse.json({ error: "Invalid recurrence" }, { status: 400 });
  }
  if (body.status !== undefined && !STATUSES.includes(body.status as CelebrationStatus)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }
  const registryIds = Array.isArray(body.registryIds)
    ? body.registryIds.map(String).map((id) => id.trim()).filter(Boolean)
    : undefined;

  try {
    const result = await updateCelebrationEvent(id, {
      title: typeof body.title === "string" ? body.title.slice(0, 160) : undefined,
      notes: typeof body.notes === "string" ? body.notes.slice(0, 5000) : undefined,
      date: typeof body.date === "string" ? body.date : undefined,
      time: body.time === null ? null : typeof body.time === "string" ? body.time : undefined,
      allDay: typeof body.allDay === "boolean" ? body.allDay : undefined,
      recurrence: body.recurrence as CelebrationRecurrence | undefined,
      status: body.status as CelebrationStatus | undefined,
      categoryId: typeof body.categoryId === "string" ? body.categoryId : undefined,
      categoryLabel: typeof body.categoryLabel === "string" ? body.categoryLabel : undefined,
      registryIds,
      updatedBy: "Team",
    });
    if (!result) return NextResponse.json({ error: "Event not found" }, { status: 404 });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not update celebration" },
      { status: 400 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id")?.trim() ?? "";
  if (!id.startsWith("celebration_")) {
    return NextResponse.json(
      { error: "Generated celebrations cannot be deleted" },
      { status: 400 }
    );
  }
  const removed = await deleteCelebrationEvent(id);
  return removed
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: "Event not found" }, { status: 404 });
}
