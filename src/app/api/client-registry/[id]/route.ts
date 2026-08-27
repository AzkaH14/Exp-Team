import { NextRequest, NextResponse } from "next/server";
import { getMergedProfileById } from "@/lib/client-registry/merge";
import { saveOverride } from "@/lib/client-registry/store";
import type { ClientProfileOverrides } from "@/lib/types/client-registry";
import { ensureSession } from "@/lib/ensure-session";

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

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  await ensureSession();
  const { id } = await params;
  const body = (await request.json()) as ClientProfileOverrides & {
    updatedBy?: string;
  };

  const existing = getMergedProfileById(id);
  if (!existing) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }

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

  return NextResponse.json({
    ok: true,
    overrides: updated,
    profile: getMergedProfileById(id),
  });
}
