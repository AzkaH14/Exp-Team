import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { QoLUrgentClient } from "@/lib/types/qol";
import { QoLGauge } from "./qol-gauge";

interface QoLUrgentAttentionProps {
  clients: QoLUrgentClient[];
}

export function QoLUrgentAttention({ clients }: QoLUrgentAttentionProps) {
  if (clients.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            QoL Urgent Attention
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No clients require urgent attention.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          QoL Urgent Attention
          <Badge variant="warning">{clients.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {clients.map((c) => (
            <Link
              key={c.slug}
              href={`/clients/${c.slug}`}
              className="flex items-center gap-4 rounded-lg border p-3 transition-colors hover:bg-muted/50"
            >
              <div className="relative">
                <QoLGauge score={c.overall} band={c.band} size="sm" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{c.client}</p>
                <p className="text-xs text-muted-foreground">
                  {c.city} · {c.ticketCount} tickets
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {c.urgentFlags.slice(0, 2).map((f) => (
                    <Badge key={f} variant="outline" className="text-[10px]">
                      {f}
                    </Badge>
                  ))}
                </div>
              </div>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
