import { NextResponse } from "next/server";
import { warmSession } from "@/lib/data-source";
import { getDashboardLiveSnapshot } from "@/lib/data-provider";
import { getTicketInsightNotesMeta } from "@/lib/ticket-insight-notes";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Manual sacred sheet + HubSpot re-sync */
export async function POST() {
  const meta = await warmSession({ force: true, syncSheet: true });
  // ISR is now on: force an immediate refresh across the app rather than waiting for the 900s window.
  if (!meta.error) revalidatePath("/", "layout");
  return NextResponse.json({
    ok: !meta.error,
    sync: meta,
    ticketNotes: getTicketInsightNotesMeta(),
    dashboard: getDashboardLiveSnapshot(),
  });
}
