import { NextRequest, NextResponse } from "next/server";
import { ensureSession } from "@/lib/ensure-session";
import { warmSession } from "@/lib/data-source";
import {
  getEngagementCalendarData,
  parseWeekParam,
} from "@/lib/engagement/calendar-data";
import {
  addEvent,
  deleteEvent,
  updateEvent,
} from "@/lib/engagement/calendar-store";
import { findExperienceSubcategory } from "@/lib/integrations/odoo-engagement";
import { isOdooRegistryEnabled } from "@/lib/integrations/odoo-registry";
import type {
  EngagementEventType,
  EngagementEventStatus,
} from "@/lib/types/engagement-calendar";

export const dynamic = "force-dynamic";

const VALID_CITIES = ["all", "Islamabad", "Karachi", "Lahore"];
const VALID_TYPES: EngagementEventType[] = [
  "experience",
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
const TIME_RE = /^\d{2}:\d{2}$/;

/** Validate the required start/end date+time window. Returns an error message or null. */
function validateSchedule(body: Record<string, unknown>): string | null {
  const date = String(body.date ?? "").trim();
  const time = String(body.time ?? "").trim();
  const endDate = String(body.endDate ?? "").trim();
  const endTime = String(body.endTime ?? "").trim();
  if (!DATE_RE.test(date)) return "Start date is required (YYYY-MM-DD)";
  if (!TIME_RE.test(time)) return "Start time is required (HH:MM)";
  if (!DATE_RE.test(endDate)) return "End date is required (YYYY-MM-DD)";
  if (!TIME_RE.test(endTime)) return "End time is required (HH:MM)";
  if (`${endDate}T${endTime}` < `${date}T${time}`) return "End must not be before start";
  return null;
}

/**
 * "experience" entries must name a real Odoo Experience sub category.
 * Returns the resolved fields, or an error message.
 */
async function resolveExperienceType(
  type: EngagementEventType | undefined,
  rawId: unknown
): Promise<{ odooSubcategoryId: number | null; odooSubcategoryName: string | null } | { error: string } | null> {
  if (type !== "experience") return null;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) return { error: "Pick a type (Odoo sub category)" };
  const sub = await findExperienceSubcategory(id);
  if (!sub) return { error: "That type is not an Odoo Experience sub category" };
  return { odooSubcategoryId: sub.id, odooSubcategoryName: sub.name };
}

function normalizeCity(raw: string | null): string {
  const city = raw ?? "all";
  return VALID_CITIES.includes(city) ? city : "all";
}

export async function GET(request: NextRequest) {
  // Warm this instance (cold → pulls the live Odoo delta, then cached) so week
  // and city navigation returns the same figures the page rendered with,
  // instead of the frozen baseline when the request lands on a cold instance.
  await warmSession();
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
  const scheduleError = validateSchedule(body);
  if (scheduleError) {
    return NextResponse.json({ error: scheduleError }, { status: 400 });
  }
  if (isOdooRegistryEnabled() && type !== "experience") {
    return NextResponse.json(
      { error: "New entries must use an Odoo Experience type" },
      { status: 400 }
    );
  }
  const experience = await resolveExperienceType(type, body.odooSubcategoryId);
  if (experience && "error" in experience) {
    return NextResponse.json({ error: experience.error }, { status: 400 });
  }

  try {
    const { event, hubspotWarning } = await addEvent({
      registryId,
      type,
      ...(experience ?? {}),
      title: typeof body.title === "string" ? body.title : undefined,
      notes: typeof body.notes === "string" ? body.notes : undefined,
      date,
      time: typeof body.time === "string" ? body.time : null,
      endDate: typeof body.endDate === "string" ? body.endDate : null,
      endTime: typeof body.endTime === "string" ? body.endTime : null,
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
  // A full form save carries the schedule; a quick status/complete patch does not.
  if (body.date !== undefined) {
    const scheduleError = validateSchedule(body);
    if (scheduleError) {
      return NextResponse.json({ error: scheduleError }, { status: 400 });
    }
  }

  const experience = await resolveExperienceType(
    body.type as EngagementEventType | undefined,
    body.odooSubcategoryId
  );
  if (experience && "error" in experience) {
    return NextResponse.json({ error: experience.error }, { status: 400 });
  }

  const updated = await updateEvent(id, {
    type: body.type as EngagementEventType | undefined,
    ...(experience ?? {}),
    title: typeof body.title === "string" ? body.title : undefined,
    notes: typeof body.notes === "string" ? body.notes : undefined,
    date: typeof body.date === "string" ? body.date : undefined,
    time: body.time === null ? null : typeof body.time === "string" ? body.time : undefined,
    endDate: body.endDate === null ? null : typeof body.endDate === "string" ? body.endDate : undefined,
    endTime: body.endTime === null ? null : typeof body.endTime === "string" ? body.endTime : undefined,
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
