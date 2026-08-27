"use client";

import { cn } from "@/lib/utils";
import type { QoLScore } from "@/lib/types/qol";

const bandColors: Record<QoLScore["band"], string> = {
  critical: "text-red-500",
  "at-risk": "text-amber-500",
  stable: "text-blue-500",
  thriving: "text-emerald-500",
};

interface QoLGaugeProps {
  score: number;
  band: QoLScore["band"];
  size?: "sm" | "md" | "lg";
  label?: string;
}

export function QoLGauge({ score, band, size = "md", label }: QoLGaugeProps) {
  const dim = size === "sm" ? 64 : size === "lg" ? 120 : 88;
  const stroke = size === "sm" ? 6 : size === "lg" ? 10 : 8;
  const radius = (dim - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative flex items-center justify-center" style={{ width: dim, height: dim }}>
      <svg width={dim} height={dim} className="-rotate-90">
        <circle
          cx={dim / 2}
          cy={dim / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          className="text-muted/30"
        />
        <circle
          cx={dim / 2}
          cy={dim / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className={cn(bandColors[band], "transition-all duration-700")}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={cn("font-bold", size === "lg" ? "text-2xl" : size === "sm" ? "text-sm" : "text-xl", bandColors[band])}>
          {score}
        </span>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{band}</span>
      </div>
      </div>
      {label && <span className="text-xs text-muted-foreground">{label}</span>}
    </div>
  );
}
