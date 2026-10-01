import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AppHeader } from "@/components/dashboard/app-header";
import { QoLGauge } from "@/components/dashboard/qol-gauge";
import { QoLDimensions } from "@/components/dashboard/qol-dimensions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getClientProfileBySlug } from "@/lib/client-profiles";
import { getTicketsByClient } from "@/lib/tickets-data";

// Dynamic, not ISR: live data sits in each serverless instance's memory, and an
// ISR copy rendered on a cold instance would serve the frozen baseline for up to
// 15 min. The root layout's warmSession() keeps this cheap (per-instance cache).
export const dynamic = "force-dynamic";

interface ClientProfilePageProps {
  params: Promise<{ slug: string }>;
}

export default async function ClientProfilePage({ params }: ClientProfilePageProps) {
  const { slug } = await params;
  const profile = getClientProfileBySlug(slug);

  if (!profile) notFound();

  const recentTickets = getTicketsByClient(profile.client).slice(0, 8);

  return (
    <>
      <Link
        href="/clients"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Client QoL
      </Link>

      <AppHeader
        title={profile.client}
        description={`${profile.city} · ${profile.tickets} tickets · ${profile.email ?? "No email"}`}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="flex flex-col items-center justify-center p-6">
          <div className="relative flex items-center justify-center">
            <QoLGauge
              score={profile.qol.overall}
              band={profile.qol.band}
              size="lg"
            />
          </div>
          {profile.qol.urgentFlags.length > 0 && (
            <div className="mt-4 flex flex-wrap justify-center gap-1">
              {profile.qol.urgentFlags.map((f) => (
                <Badge key={f} variant="warning">
                  {f}
                </Badge>
              ))}
            </div>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">QoL Dimensions</CardTitle>
          </CardHeader>
          <CardContent>
            <QoLDimensions dimensions={profile.qol.dimensions} />
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Prediction</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              <span className="text-muted-foreground">Next month forecast:</span>{" "}
              <strong>{profile.qol.prediction.nextMonthTickets} tickets</strong>
            </p>
            <p>
              <span className="text-muted-foreground">Risk level:</span>{" "}
              <Badge
                variant={
                  profile.qol.prediction.riskLevel === "high"
                    ? "destructive"
                    : profile.qol.prediction.riskLevel === "medium"
                      ? "warning"
                      : "success"
                }
              >
                {profile.qol.prediction.riskLevel}
              </Badge>
            </p>
            <p className="text-muted-foreground">{profile.qol.prediction.narrative}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top Services</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{profile.topServices}</p>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Recent Tickets</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm">
            {recentTickets.map((t) => (
              <li key={t.id} className="flex justify-between border-b pb-2 last:border-0">
                <span>
                  {t.ticketNumber} — {t.subCategory}
                </span>
                <span className="text-muted-foreground">{t.created}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}
