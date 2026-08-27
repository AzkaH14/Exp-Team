import { NextRequest, NextResponse } from "next/server";
import { getEngagementClientsPage } from "@/lib/engagement/client-suggestions";
import { refreshUnderutilisingSheetCache } from "@/lib/engagement/underutilising-sheet";
import { ensureSession } from "@/lib/ensure-session";
import { isUnderutilisingSheetConfigured } from "@/lib/integrations/google-sheets";
import type { EngagementCity, EngagementSegment } from "@/lib/types/engagement";

export const dynamic = "force-dynamic";

const VALID_SEGMENTS: EngagementSegment[] = ["underutilising", "top", "mid"];
const VALID_CITIES: EngagementCity[] = ["all", "Islamabad", "Karachi", "Lahore"];

/** Reads precomputed session cache — no HubSpot call */
export async function GET(request: NextRequest) {
  await ensureSession();
  const { searchParams } = request.nextUrl;
  const segment = (searchParams.get("segment") ?? "underutilising") as EngagementSegment;
  const city = (searchParams.get("city") ?? "all") as EngagementCity;
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);

  if (!VALID_SEGMENTS.includes(segment)) {
    return NextResponse.json({ error: "Invalid segment" }, { status: 400 });
  }
  if (!VALID_CITIES.includes(city)) {
    return NextResponse.json({ error: "Invalid city" }, { status: 400 });
  }

  if (segment === "underutilising" && isUnderutilisingSheetConfigured()) {
    try {
      await refreshUnderutilisingSheetCache();
    } catch (e) {
      console.warn("Underutilising sheet refresh failed:", e);
    }
  }

  try {
    return NextResponse.json(getEngagementClientsPage(segment, city, page));
  } catch (e) {
    console.error("Engagement page failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Engagement failed" },
      { status: 500 }
    );
  }
}
