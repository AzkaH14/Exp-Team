"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TicketsPageResult } from "@/lib/types/ticket";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface TicketsTableProps {
  initial: TicketsPageResult;
}

const ATTENTION_VARIANT: Record<string, "destructive" | "default" | "secondary" | "outline"> = {
  critical: "destructive",
  high: "destructive",
  medium: "default",
  low: "secondary",
};

const QUALITY_VARIANT: Record<string, "destructive" | "default" | "secondary" | "outline"> = {
  complaint: "destructive",
  urgent_open: "destructive",
  stale: "default",
  on_track: "secondary",
  closed: "outline",
};

export function TicketsTable({ initial }: TicketsTableProps) {
  const [search, setSearch] = useState("");
  const [cityFilter, setCityFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [familyFilter, setFamilyFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [attentionFilter, setAttentionFilter] = useState("");
  const [qualityFilter, setQualityFilter] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<TicketsPageResult>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initialRef = useRef(initial);
  initialRef.current = initial;

  const fetchTickets = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        search,
        city: cityFilter,
        priority: priorityFilter,
        registryId: familyFilter,
        status: statusFilter,
        attention: attentionFilter,
        quality: qualityFilter,
      });
      const res = await fetch(`/api/tickets?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as TicketsPageResult;
      setResult(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load tickets");
    } finally {
      setLoading(false);
    }
  }, [
    page,
    search,
    cityFilter,
    priorityFilter,
    familyFilter,
    statusFilter,
    attentionFilter,
    qualityFilter,
  ]);

  useEffect(() => {
    const isDefaultView =
      page === 1 &&
      !search &&
      !cityFilter &&
      !priorityFilter &&
      !familyFilter &&
      !statusFilter &&
      !attentionFilter &&
      !qualityFilter;
    if (isDefaultView) {
      setResult(initialRef.current);
      setLoading(false);
      return;
    }
    fetchTickets();
  }, [
    fetchTickets,
    page,
    search,
    cityFilter,
    priorityFilter,
    familyFilter,
    statusFilter,
    attentionFilter,
    qualityFilter,
  ]);

  const summary = result.summary ?? {
    total: result.total,
    open: 0,
    urgentOpen: 0,
    complaintsOpen: 0,
    staleOpen: 0,
    avgDaysOpen: 0,
  };

  const families = result.families ?? [];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border bg-card p-3">
          <p className="text-xs text-muted-foreground">Open tickets</p>
          <p className="text-2xl font-semibold">{summary.open}</p>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <p className="text-xs text-muted-foreground">Avg days open</p>
          <p className="text-2xl font-semibold">{summary.avgDaysOpen}d</p>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <p className="text-xs text-muted-foreground">Urgent & open</p>
          <p className="text-2xl font-semibold text-destructive">{summary.urgentOpen}</p>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <p className="text-xs text-muted-foreground">Complaints open</p>
          <p className="text-2xl font-semibold text-destructive">{summary.complaintsOpen}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <input
          type="search"
          placeholder="Search tickets, family, client..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          className="h-9 min-w-[200px] flex-1 rounded-md border bg-background px-3 text-sm"
        />
        <select
          value={familyFilter}
          onChange={(e) => {
            setFamilyFilter(e.target.value);
            setPage(1);
          }}
          className="h-9 max-w-[200px] rounded-md border bg-background px-3 text-sm"
        >
          <option value="">All families</option>
          {(families.length ? families : []).map((f) => (
            <option key={f.registryId} value={f.registryId}>
              {f.label} ({f.city})
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
          className="h-9 rounded-md border bg-background px-3 text-sm"
        >
          <option value="">Open & closed</option>
          <option value="open">Open only</option>
          <option value="closed">Closed only</option>
        </select>
        <select
          value={attentionFilter}
          onChange={(e) => {
            setAttentionFilter(e.target.value);
            setPage(1);
          }}
          className="h-9 rounded-md border bg-background px-3 text-sm"
        >
          <option value="">All attention</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
        </select>
        <select
          value={qualityFilter}
          onChange={(e) => {
            setQualityFilter(e.target.value);
            setPage(1);
          }}
          className="h-9 rounded-md border bg-background px-3 text-sm"
        >
          <option value="">All quality</option>
          <option value="complaint">Complaints</option>
          <option value="urgent_open">Urgent open</option>
          <option value="stale">Stale (7d+)</option>
          <option value="on_track">On track</option>
        </select>
        <select
          value={cityFilter}
          onChange={(e) => {
            setCityFilter(e.target.value);
            setPage(1);
          }}
          className="h-9 rounded-md border bg-background px-3 text-sm"
        >
          <option value="">All cities</option>
          {(result?.cities ?? []).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          value={priorityFilter}
          onChange={(e) => {
            setPriorityFilter(e.target.value);
            setPage(1);
          }}
          className="h-9 rounded-md border bg-background px-3 text-sm"
        >
          <option value="">All priorities</option>
          <option value="urgent">Urgent</option>
          <option value="normal">Normal</option>
        </select>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Loading tickets...</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {result && (
        <>
          <p className="text-sm text-muted-foreground">
            {result.total.toLocaleString()} tickets
            {summary.staleOpen > 0 && (
              <span className="text-amber-700"> · {summary.staleOpen} open 7+ days</span>
            )}
          </p>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ticket</TableHead>
                <TableHead>Family</TableHead>
                <TableHead>Service</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Quality</TableHead>
                <TableHead>Attention</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.tickets.map((t) => {
                const isOpen = t.isOpen ?? !(t.closed ?? "").toString().trim();
                const daysOpenLabel = t.daysOpenLabel ?? (isOpen ? "—" : "Closed");
                const attention = t.attention ?? "low";
                const qualitySignal = t.qualitySignal ?? (isOpen ? "on_track" : "closed");
                const qualityLabel = t.qualityLabel ?? (isOpen ? "On track" : "Resolved");
                const attentionReasons = t.attentionReasons ?? [];

                return (
                <TableRow key={t.id}>
                  <TableCell>
                    <div className="font-mono text-xs">{t.ticketNumber}</div>
                    <div className="text-xs text-muted-foreground">{t.created}</div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">{t.familyLabel ?? t.client}</div>
                    <div className="text-xs text-muted-foreground">{t.city}</div>
                  </TableCell>
                  <TableCell className="max-w-[200px]">
                    <div className="truncate text-xs font-medium">{t.subCategory || t.categoryFull}</div>
                    <div className="truncate text-xs text-muted-foreground">{t.name}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={isOpen ? "default" : "outline"}>
                      {isOpen ? "Open" : "Closed"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs whitespace-nowrap">
                    {daysOpenLabel}
                    {!isOpen && t.closed ? (
                      <div className="text-muted-foreground">Closed {t.closed}</div>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Badge variant={QUALITY_VARIANT[qualitySignal] ?? "secondary"}>
                      {qualityLabel}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-[180px]">
                    <Badge variant={ATTENTION_VARIANT[attention] ?? "secondary"}>
                      {attention}
                    </Badge>
                    {attentionReasons[0] && (
                      <p className="mt-1 text-xs text-muted-foreground">{attentionReasons[0]}</p>
                    )}
                  </TableCell>
                </TableRow>
              );
              })}
            </TableBody>
          </Table>

          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              Page {result.page} of {result.totalPages}
            </span>
            <div className="flex gap-2">
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
          </div>
        </>
      )}
    </div>
  );
}
