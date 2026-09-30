import { NextResponse } from "next/server";
import { syncSacredRegistryFromSheet } from "@/lib/client-registry/sheet-sync";
import { isGoogleSheetsConfigured } from "@/lib/integrations/google-sheets";
import { isOdooRegistryEnabled, syncOdooRegistry } from "@/lib/integrations/odoo-registry";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Refresh the client registry — from Odoo by default, or the legacy sacred sheet. */
export async function POST() {
  if (isOdooRegistryEnabled()) {
    const result = await syncOdooRegistry();
    if (result.ok) revalidatePath("/", "layout");
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  }

  if (!isGoogleSheetsConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Google Sheets not configured. Add GOOGLE_SHEETS_PUBLISH_CSV_URL (or service account) to .env.local.",
        setup: {
          sheetUrl:
            "https://docs.google.com/spreadsheets/d/1pTj0G-cXt30Vx2A_qiLwIA9M2rQ4tqZPe60AGnUwcis",
          steps: [
            "Option B (recommended): File → Share → Publish to web → CSV",
            "Set GOOGLE_SHEETS_PUBLISH_CSV_URL in .env.local",
            "Or: service account JSON + share sheet with service account email",
            "Click Sync again",
          ],
        },
      },
      { status: 400 }
    );
  }

  const result = await syncSacredRegistryFromSheet({
    // Default on — set SACRED_AUTO_ADD_HUBSPOT=false to disable
    autoAddHubSpot: process.env.SACRED_AUTO_ADD_HUBSPOT?.trim() !== "false",
  });
  // ISR is now on: force an immediate refresh across the app rather than waiting for the 900s window.
  if (result.ok) revalidatePath("/", "layout");
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

export async function GET() {
  if (isOdooRegistryEnabled()) {
    return NextResponse.json({ configured: true, source: "odoo" });
  }
  return NextResponse.json({
    configured: isGoogleSheetsConfigured(),
    source: "sheet",
    sheetId: process.env.GOOGLE_SHEETS_ID ?? "1pTj0G-cXt30Vx2A_qiLwIA9M2rQ4tqZPe60AGnUwcis",
    autoAddHubSpot: process.env.SACRED_AUTO_ADD_HUBSPOT?.trim() !== "false",
  });
}
