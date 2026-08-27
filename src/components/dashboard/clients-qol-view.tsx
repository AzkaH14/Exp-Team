"use client";

import { useMemo, useState } from "react";
import type { ClientQoLListItem } from "@/lib/types/client-list";
import { ClientsQoLTable } from "./clients-qol-table";
import { Button } from "@/components/ui/button";

const CITIES = ["all", "Islamabad", "Karachi", "Lahore", "Lodhran", "Gujranwala", "Faisalabad", "Other"] as const;

interface ClientsQoLViewProps {
  clients: ClientQoLListItem[];
}

export function ClientsQoLView({ clients }: ClientsQoLViewProps) {
  const [city, setCity] = useState<string>("all");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return clients
      .filter((p) => {
        if (city === "all") return true;
        if (city === "Other")
          return !["Islamabad", "Karachi", "Lahore", "Lodhran", "Gujranwala", "Faisalabad"].includes(
            p.city
          );
        return p.city === city;
      })
      .filter(
        (p) =>
          !q ||
          p.client.toLowerCase().includes(q) ||
          p.city.toLowerCase().includes(q)
      )
      .sort((a, b) => a.overall - b.overall);
  }, [clients, city, search]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {CITIES.map((c) => (
          <Button
            key={c}
            variant={city === c ? "default" : "outline"}
            size="sm"
            onClick={() => setCity(c)}
          >
            {c === "all" ? "All Cities" : c}
          </Button>
        ))}
      </div>
      <input
        type="search"
        placeholder="Search clients..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="h-9 w-full max-w-sm rounded-md border bg-background px-3 text-sm"
      />
      <p className="text-sm text-muted-foreground">{filtered.length} clients</p>
      <ClientsQoLTable profiles={filtered} />
    </div>
  );
}
