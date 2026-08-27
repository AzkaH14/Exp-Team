"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  EngagementCity,
  EngagementPageResult,
  EngagementSegment,
} from "@/lib/types/engagement";
import { ENGAGEMENT_CITIES, CITY_LEADS } from "@/lib/engagement/team";
import { EngagementClientCard } from "./engagement-client-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const SEGMENTS: { id: EngagementSegment; label: string; description: string }[] = [
  {
    id: "underutilising",
    label: "Underutilising",
    description: `28-day non-utilizers (ops sheet)`,
  },
  { id: "top", label: "Top Clients", description: "Top 15 by volume" },
  { id: "mid", label: "Mid-tier", description: "Everyone else" },
];

interface EngagementHubProps {
  initial: EngagementPageResult;
}

export function EngagementHub({ initial }: EngagementHubProps) {
  const [segment, setSegment] = useState<EngagementSegment>(initial.segment);
  const [city, setCity] = useState<EngagementCity>(initial.city);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<EngagementPageResult>(initial);
  const [loading, setLoading] = useState(false);
  const skipFirstFetch = useRef(true);

  const fetchPage = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        segment,
        city,
        page: String(page),
      });
      const res = await fetch(`/api/engagement?${params}`);
      if (!res.ok) throw new Error("Failed to load");
      const data = (await res.json()) as EngagementPageResult;
      setResult(data);
    } catch {
      // keep last good page on error
    } finally {
      setLoading(false);
    }
  }, [segment, city, page]);

  useEffect(() => {
    if (skipFirstFetch.current) {
      skipFirstFetch.current = false;
      return;
    }
    void fetchPage();
  }, [fetchPage, segment, city, page]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {SEGMENTS.map((s) => (
          <Button
            key={s.id}
            variant={segment === s.id ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setSegment(s.id);
              setPage(1);
            }}
          >
            {s.label}
            <Badge variant="secondary" className="ml-1 text-[10px]">
              {s.description}
            </Badge>
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant={city === "all" ? "default" : "outline"}
          size="sm"
          onClick={() => {
            setCity("all");
            setPage(1);
          }}
        >
          All Cities
        </Button>
        {ENGAGEMENT_CITIES.map((c) => (
          <Button
            key={c}
            variant={city === c ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setCity(c);
              setPage(1);
            }}
          >
            {c} — {CITY_LEADS[c]}
          </Button>
        ))}
      </div>

      {result.segment === "underutilising" && result.underutilisingCrossCheck?.configured && (
        <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-muted-foreground">
          Ops sheet cross-check (28-day non-utilizers): {result.underutilisingCrossCheck.sheetCount}{" "}
          on sheet · {result.underutilisingCrossCheck.matched} matched ·{" "}
          {result.underutilisingCrossCheck.hubspotOnly} HubSpot-only (may be sync delay) ·{" "}
          {result.underutilisingCrossCheck.sheetOnly} sheet-only
          {result.underutilisingCrossCheck.error && (
            <> · Sheet fetch warning: {result.underutilisingCrossCheck.error}</>
          )}
        </p>
      )}

      {loading && <p className="text-sm text-muted-foreground">Loading...</p>}

      {!loading && result.clients.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No active clients in this segment for {city === "all" ? "all cities" : city}. Paused and
          gratis clients are excluded from outreach lists.
        </p>
      )}

      {result && result.clients.length > 0 && (
        <>
          <p className="text-sm text-muted-foreground">
            {result.total} clients · Page {result.page} of {result.totalPages}
          </p>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {result.clients.map((c) => (
              <EngagementClientCard key={c.slug} client={c} />
            ))}
          </div>
          <div className="flex justify-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={result.page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={result.page >= result.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
