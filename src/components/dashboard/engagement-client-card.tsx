"use client";

import { useState } from "react";
import Link from "next/link";
import { Phone, MessageCircle, MapPin, Mail, Sparkles } from "lucide-react";
import type { EngagementClient, EngagementSuggestion } from "@/lib/types/engagement";
import { recordLearnedAction } from "@/lib/engagement/learning";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const channelIcon = {
  call: Phone,
  whatsapp: MessageCircle,
  visit: MapPin,
  email: Mail,
};

interface EngagementClientCardProps {
  client: EngagementClient;
}

export function EngagementClientCard({ client }: EngagementClientCardProps) {
  const [customAction, setCustomAction] = useState("");
  const [recorded, setRecorded] = useState<string | null>(null);

  const handleRecord = (action: string, outcome = "logged") => {
    recordLearnedAction(client.client, action, outcome);
    setRecorded(action);
    setTimeout(() => setRecorded(null), 3000);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">
              <Link href={`/clients/${client.slug}`} className="hover:underline">
                {client.client}
              </Link>
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              {client.city} · Lead: {client.cityLead} · {client.tickets} tickets · QoL{" "}
              {client.qolOverall}
              {client.segment === "underutilising" && (
                <>
                  {" "}
                  ·{" "}
                  {client.daysSinceLastTicket === null
                    ? "no tickets on record"
                    : `${client.daysSinceLastTicket}d since last ticket`}
                </>
              )}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Badge variant="secondary">{client.segment}</Badge>
            {client.segment === "underutilising" && client.onOpsSheet === true && (
              <Badge variant="outline" className="text-[10px]">
                On ops sheet
              </Badge>
            )}
            {client.segment === "underutilising" && client.onOpsSheet === false && (
              <Badge variant="warning" className="text-[10px]">
                Not on ops sheet
              </Badge>
            )}
            {client.isPaused && <Badge variant="warning">Paused</Badge>}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground line-clamp-2">
          Top services: {client.topServices}
        </p>

        <div className="space-y-2">
          <p className="flex items-center gap-1 text-xs font-medium">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            Intelligence suggestions
          </p>
          {client.suggestions.map((s: EngagementSuggestion) => {
            const Icon = channelIcon[s.channel];
            return (
              <div
                key={s.id}
                className="rounded-md border p-3 text-sm"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{s.title}</span>
                  <div className="flex items-center gap-1">
                    <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                    <Badge
                      variant={s.priority === "high" ? "destructive" : "outline"}
                      className="text-[10px]"
                    >
                      {s.priority}
                    </Badge>
                  </div>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{s.rationale}</p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2 h-7 text-xs"
                  onClick={() => handleRecord(s.title, "suggestion applied")}
                >
                  Record & learn
                </Button>
              </div>
            );
          })}
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Custom action..."
            value={customAction}
            onChange={(e) => setCustomAction(e.target.value)}
            className="h-8 flex-1 rounded-md border bg-background px-2 text-xs"
          />
          <Button
            size="sm"
            disabled={!customAction.trim()}
            onClick={() => {
              handleRecord(customAction.trim(), "custom action");
              setCustomAction("");
            }}
          >
            Record
          </Button>
        </div>

        {recorded && (
          <p className="text-xs text-emerald-600">Recorded: {recorded}</p>
        )}
      </CardContent>
    </Card>
  );
}
