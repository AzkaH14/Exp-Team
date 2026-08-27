import { NextResponse } from "next/server";
import { getClientListSlim } from "@/lib/clients-query";

export const dynamic = "force-dynamic";

/** Reads precomputed session cache — no HubSpot call */
export async function GET() {
  return NextResponse.json({ clients: getClientListSlim() });
}
