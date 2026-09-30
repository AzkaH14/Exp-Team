import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getMergedProfileById, invalidateMergedClientProfilesCache } from "@/lib/client-registry/merge";
import { saveOverride } from "@/lib/client-registry/store";
import { upsertInterestsSection } from "@/lib/client-registry/odoo-overview";
import type { ClientProfileOverrides } from "@/lib/types/client-registry";
import { ensureSession } from "@/lib/ensure-session";
import {
  postPartnerNote,
  searchRead,
  str,
  updatePartnerFields,
} from "@/lib/integrations/odoo";
import { syncOdooRegistry } from "@/lib/integrations/odoo-registry";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  await ensureSession();
  const { id } = await params;
  const profile = getMergedProfileById(id);
  if (!profile) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }
  return NextResponse.json({ profile });
}

/** Body for an Odoo-backed family. Every field is optional — only changes are written. */
interface OdooPatchBody {
  updatedBy?: string;
  members?: Array<{ partnerId: number; name?: string; birthday?: string | null }>;
  interests?: string[];
  note?: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function patchOdooFamily(id: string, body: OdooPatchBody) {
  const profile = getMergedProfileById(id);
  if (!profile?.odoo) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }
  const family = profile.odoo;
  const updatedBy = (body.updatedBy ?? "team").slice(0, 60);
  const written: string[] = [];

  // Only contacts that belong to THIS family can be written.
  const memberById = new Map(family.members.map((m) => [m.partnerId, m]));
  for (const change of body.members ?? []) {
    const current = memberById.get(change.partnerId);
    if (!current) {
      return NextResponse.json(
        { error: `Contact ${change.partnerId} is not a member of this family` },
        { status: 400 }
      );
    }
    const patch: { name?: string; x_studio_date_of_birth?: string | false } = {};
    const name = change.name?.trim();
    if (name && name !== current.name) patch.name = name;
    if (change.birthday !== undefined) {
      const bday = change.birthday?.trim() || null;
      if (bday && !DATE_RE.test(bday)) {
        return NextResponse.json({ error: `Invalid date for ${current.name}` }, { status: 400 });
      }
      if (bday !== current.birthday) patch.x_studio_date_of_birth = bday ?? false;
    }
    if (Object.keys(patch).length) {
      await updatePartnerFields(change.partnerId, patch);
      written.push(`${current.name}: ${Object.keys(patch).join(", ")}`);
    }
  }

  if (body.interests) {
    const next = [...new Set(body.interests.map((s) => s.trim()).filter(Boolean))];
    if (next.join("\n") !== family.interests.join("\n")) {
      // Read the Family Overview fresh so a concurrent edit in Odoo is not clobbered.
      const [row] = await searchRead<{ id: number; comment?: string | false }>(
        "res.partner",
        [["id", "=", family.partnerId]],
        ["comment"],
        { limit: 1 }
      );
      const html = upsertInterestsSection(str(row?.comment), next);
      await updatePartnerFields(family.partnerId, { comment: html });
      written.push("Family Overview: Hobbies & Interests");
    }
  }

  const note = body.note?.trim();
  if (note) {
    const html = `<p>${escapeHtml(note).replace(/\n/g, "<br/>")}</p><p><em>— ${escapeHtml(
      updatedBy
    )} via Experience portal</em></p>`;
    await postPartnerNote(family.partnerId, html);
    written.push("Chatter note");
  }

  // Re-read from Odoo so the portal shows what Odoo actually stored.
  if (written.length) {
    const sync = await syncOdooRegistry();
    if (!sync.ok) console.warn("Odoo re-read after write failed:", sync.error);
    invalidateMergedClientProfilesCache();
    revalidatePath("/", "layout");
  }

  return NextResponse.json({ ok: true, written, profile: getMergedProfileById(id) });
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  await ensureSession();
  const { id } = await params;
  const existing = getMergedProfileById(id);
  if (!existing) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }

  if (existing.source === "odoo") {
    try {
      return await patchOdooFamily(id, (await request.json()) as OdooPatchBody);
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Odoo update failed" },
        { status: 502 }
      );
    }
  }

  // Legacy sheet registry: local overrides file.
  const body = (await request.json()) as ClientProfileOverrides & {
    updatedBy?: string;
  };
  const patch: ClientProfileOverrides = {
    benefactorBirthday: body.benefactorBirthday,
    beneficiaryBirthday: body.beneficiaryBirthday,
    anniversary: body.anniversary,
    hobbies: body.hobbies,
    interests: body.interests,
    engagementNotes: body.engagementNotes,
    beneficiaryName: body.beneficiaryName,
  };

  const updated = saveOverride(id, patch, body.updatedBy ?? "team");
  invalidateMergedClientProfilesCache();

  return NextResponse.json({
    ok: true,
    overrides: updated,
    profile: getMergedProfileById(id),
  });
}
