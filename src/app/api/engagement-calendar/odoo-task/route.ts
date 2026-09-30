import { NextRequest, NextResponse } from "next/server";
import { ensureSession } from "@/lib/ensure-session";
import { createOdooTaskForEvent } from "@/lib/engagement/calendar-store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * "Create ticket in Odoo" for one logged Engagement Calendar entry: creates a
 * Field Service task (category Experience, the entry's sub category) and links
 * it to the entry. Safe to call twice — the second call returns the same task.
 */
export async function POST(request: NextRequest) {
  await ensureSession();
  let body: { id?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const id = String(body.id ?? "").trim();
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  try {
    const { event, created } = await createOdooTaskForEvent(id);
    return NextResponse.json({ ok: true, created, event, odooTaskId: event.odooTaskId });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not create the Odoo task";
    return NextResponse.json(
      { error: message },
      { status: message === "Event not found" ? 404 : 502 }
    );
  }
}
