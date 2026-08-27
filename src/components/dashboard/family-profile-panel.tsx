"use client";

import Link from "next/link";
import type { FamilyProfileContext } from "@/lib/reports/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface FamilyProfilePanelProps {
  profile: FamilyProfileContext | null;
  loading?: boolean;
}

export function FamilyProfilePanel({ profile, loading }: FamilyProfilePanelProps) {
  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Family profile</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Loading profile…</p>
        </CardContent>
      </Card>
    );
  }

  if (!profile?.registryId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Family profile</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Select a family to view BIRA, traits, and engagement notes.
          </p>
        </CardContent>
      </Card>
    );
  }

  const hasTraits =
    profile.interests.length > 0 ||
    profile.engagementNotes.length > 0 ||
    profile.hobbies.length > 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="text-base">Family profile &amp; BIRA</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Internal notes + HubSpot profile notes + risk assessment
          </p>
        </div>
        <Badge variant="secondary">{profile.profileCompleteness}% complete</Badge>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div>
          <p className="font-medium">{profile.benefactor}</p>
          <p className="text-muted-foreground">
            {profile.city} · {profile.beneficiary}
          </p>
          <p className="text-xs text-muted-foreground capitalize">
            {profile.serviceTier.replace(/_/g, " ")} · {profile.status}
          </p>
        </div>

        {(profile.prefersLowTouch || profile.indoorOnly) && (
          <div className="flex flex-wrap gap-2">
            {profile.prefersLowTouch && (
              <Badge variant="outline">Low-touch preference</Badge>
            )}
            {profile.indoorOnly && <Badge variant="outline">Indoor only</Badge>}
          </div>
        )}

        {profile.hasBira && (
          <section>
            <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              BIRA — beneficiaries
            </h4>
            <ul className="space-y-1">
              {profile.biraBeneficiaries.map((b) => (
                <li key={b.name}>
                  <span className="font-medium">{b.name}</span>
                  {b.birthdayLabel && (
                    <span className="text-muted-foreground"> · {b.birthdayLabel}</span>
                  )}
                </li>
              ))}
            </ul>
            {profile.biraSourceFile && (
              <p className="mt-1 text-xs text-muted-foreground">{profile.biraSourceFile}</p>
            )}
          </section>
        )}

        {hasTraits && (
          <section>
            <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Beneficiary traits &amp; habits
            </h4>
            {profile.hobbies.length > 0 && (
              <p>
                <span className="font-medium">Hobbies:</span> {profile.hobbies.join(", ")}
              </p>
            )}
            {profile.interests.length > 0 && (
              <p>
                <span className="font-medium">Interests:</span> {profile.interests.join(", ")}
              </p>
            )}
            {profile.engagementNotes.length > 0 && (
              <ul className="mt-2 list-disc space-y-1 pl-4 text-muted-foreground">
                {profile.engagementNotes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            )}
          </section>
        )}

        {profile.generalOverview && (
          <section>
            <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Overview
            </h4>
            <p className="text-muted-foreground">{profile.generalOverview}</p>
          </section>
        )}

        {profile.medicalHighlights.length > 0 && (
          <section>
            <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Medical notes
            </h4>
            <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
              {profile.medicalHighlights.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </section>
        )}

        {!profile.hasBira && !profile.hasInternalProfile && (
          <p className="text-muted-foreground">
            No internal city profile or BIRA on file yet. Add via Client Profiles or import
            documents.
          </p>
        )}

        {profile.missingFields.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Missing: {profile.missingFields.join(", ")}
          </p>
        )}

        <Link
          href="/client-profiles"
          className="inline-block text-xs text-primary underline"
        >
          Open full client profiles →
        </Link>
      </CardContent>
    </Card>
  );
}
