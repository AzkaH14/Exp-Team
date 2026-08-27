import type { QoLDimensionScore } from "@/lib/types/qol";
import { cn } from "@/lib/utils";
import { TrendingDown, TrendingUp, Minus } from "lucide-react";

const trendIcon = {
  up: TrendingUp,
  down: TrendingDown,
  stable: Minus,
};

interface QoLDimensionsProps {
  dimensions: QoLDimensionScore[];
}

export function QoLDimensions({ dimensions }: QoLDimensionsProps) {
  return (
    <div className="space-y-3">
      {dimensions.map((d) => {
        const Icon = trendIcon[d.trend];
        return (
          <div key={d.dimension} className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">{d.label}</span>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">{d.tickets} tickets</span>
                <Icon className={cn("h-3.5 w-3.5", d.trend === "down" ? "text-red-500" : d.trend === "up" ? "text-emerald-500" : "text-muted-foreground")} />
                <span className="font-semibold">{d.score}</span>
              </div>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${d.score}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
