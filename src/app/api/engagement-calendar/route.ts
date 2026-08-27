import { NextRequest, NextResponse } from "next/server";
import { ensureSession } from "@/lib/ensure-session";
import {
  getEngagementCalendarData,
  parseWeekParam,
} from "@/lib/engagement/calendar-data";
import {
  addEvent,
  deleteEvent,
  updateEvent,
} from "@/lib/engagement/calendar-store";
import type {
  EngagementEventType,
  EngagementEventStatus,
} from "@/lib/types/engagement-calendar";

export const dynamic = "force-dynamic";

const VALID_CITIES = ["all", "Islamabad", "Karachi", "Lahore"];
const VALID_TYPES: EngagementEventType[] = [
  "doctor_call",
  "psychologist_call",
  "checkin_call",
  "visit",
  "outing",
  "other",
];
const VALID_STATUS: EngagementEventStatus[] = [
  "planned",
  "completed",
  "rescheduled",
  "cancelled",
];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeCity(raw: string | null): string {
  const city = raw ?? "all";
  return VALID_CITIES.includes(city) ? city : "all";
}

export async function GET(request: NextRequest) {
  await ensureSession();
  const { searchParams } = request.nextUrl;
  const city = normalizeCity(searchParams.get("city"));
  const weekRef = parseWeekParam(searchParams.get("week"));

  try {
    return NextResponse.json(await getEngagementCalendarData(city, weekRef));
  } catch (e) {
    console.error("Engagement calendar failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Calendar failed" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  await ensureSession();
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const registryId = String(body.registryId ?? "").trim();
  const type = body.type as EngagementEventType;
  const date = String(body.date ?? "").trim();

  if (!registryId) {
    return NextResponse.json({ error: "registryId is required" }, { status: 400 });
  }
  if (!VALID_TYPES.includes(type)) {
    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  }
  if (!DATE_RE.test(date)) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }

  try {
    const { event, hubspotWarning } = await addEvent({
      registryId,
      type,
      title: typeof body.title === "string" ? body.title : undefined,
      notes: typeof body.notes === "string" ? body.notes : undefined,
      date,
      time: typeof body.time === "string" ? body.time : null,
      status: VALID_STATUS.includes(body.status as EngagementEventStatus)
        ? (body.status as EngagementEventStatus)
        : undefined,
      createdBy: typeof body.createdBy === "string" ? body.createdBy : undefined,
      assignedDoctor:
        body.assignedDoctor === null
          ? null
          : typeof body.assignedDoctor === "string"
            ? body.assignedDoctor
            : undefined,
    });
    return NextResponse.json({ ok: true, event, hubspotWarning }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not add event" },
      { status: 400 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  await ensureSession();
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const id = String(body.id ?? "").trim();
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  if (body.type !== undefined && !VALID_TYPES.includes(body.type as EngagementEventType)) {
    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  }
  if (body.status !== undefined && !VALID_STATUS.includes(body.status as EngagementEventStatus)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }
  if (body.date !== undefined && !DATE_RE.test(String(body.date))) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }

  const updated = await updateEvent(id, {
    type: body.type as EngagementEventType | undefined,
    title: typeof body.title === "string" ? body.title : undefined,
    notes: typeof body.notes === "string" ? body.notes : undefined,
    date: typeof body.date === "string" ? body.date : undefined,
    time: body.time === null ? null : typeof body.time === "string" ? body.time : undefined,
    status: body.status as EngagementEventStatus | undefined,
    assignedDoctor:
      body.assignedDoctor === null
        ? null
        : typeof body.assignedDoctor === "string"
          ? body.assignedDoctor
          : undefined,
  });

  if (!updated) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, event: updated });
}

export async function DELETE(request: NextRequest) {
  await ensureSession();
  const id = request.nextUrl.searchParams.get("id")?.trim();
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  const removed = await deleteEvent(id);
  if (!removed) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
