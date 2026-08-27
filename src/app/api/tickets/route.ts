import { NextRequest, NextResponse } from "next/server";
import { getTicketsPage } from "@/lib/tickets-query";

export const dynamic = "force-dynamic";

/** Reads precomputed session cache — no HubSpot call */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const search = searchParams.get("search") ?? "";
  const city = searchParams.get("city") ?? "";
  const priority = searchParams.get("priority") ?? "";
  const registryId = searchParams.get("registryId") ?? "";
  const status = searchParams.get("status") ?? "";
  const attention = searchParams.get("attention") ?? "";
  const quality = searchParams.get("quality") ?? "";

  return NextResponse.json(
    getTicketsPage(page, search, city, priority, registryId, status, attention, quality)
  );
}
