import { NextResponse } from "next/server";
import { getLiveTickets, warmSession } from "@/lib/data-source";
import {
  attachInsightNotesToTickets,
  syncTicketInsightNotes,
} from "@/lib/integrations/hubspot-ticket-notes-sync";
import { isHubSpotActivityFetchConfigured } from "@/lib/integrations/hubspot-activity-fetch";
import { setTicketInsightNotesCache } from "@/lib/ticket-insight-notes";
import { invalidateFamilyReportCache } from "@/lib/reports/report-cache";
import { invalidateReportTicketIndex } from "@/lib/reports/ticket-index";
import { invalidateTicketsQueryCache } from "@/lib/tickets-query";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Pull insight notes from each ticket's HubSpot activity timeline */
export async function POST(request: Request) {
  if (!isHubSpotActivityFetchConfigured()) {
    return NextResponse.json(
      { ok: false, error: "HUBSPOT_ACCESS_TOKEN not configured" },
      { status: 400 }
    );
  }

  const url = new URL(request.url);
  const refreshTickets = url.searchParams.get("refreshTickets") === "1";

  if (refreshTickets) {
    await warmSession({ force: true });
  }

  const tickets = getLiveTickets();
  if (!tickets.length) {
    return NextResponse.json(
      { ok: false, error: "No tickets loaded — run HubSpot sync first" },
      { status: 400 }
    );
  }

  try {
    const { byTicketId, summary } = await syncTicketInsightNotes(tickets);
    setTicketInsightNotesCache(byTicketId);
    attachInsightNotesToTickets(tickets, byTicketId);
    invalidateFamilyReportCache();
    invalidateReportTicketIndex();
    invalidateTicketsQueryCache();

    // ISR is now on: force an immediate refresh across the app rather than waiting for the 900s window.
    revalidatePath("/", "layout");
    return NextResponse.json({
      ok: true,
      summary,
      syncedAt: new Date().toISOString(),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Ticket notes sync failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET() {
  const { getTicketInsightNotesMeta } = await import("@/lib/ticket-insight-notes");
  return NextResponse.json(getTicketInsightNotesMeta());
}
