import { NextResponse } from "next/server";
import { auditHubSpotVsRegistry } from "@/lib/client-registry/audit";
import { ensureSession } from "@/lib/ensure-session";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** HubSpot benefactors not in sacred registry + registry-only active clients */
export async function GET() {
  await ensureSession();
  const audit = await auditHubSpotVsRegistry();
  return NextResponse.json(audit);
}
