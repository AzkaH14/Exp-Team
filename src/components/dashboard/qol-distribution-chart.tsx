"use client";

import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from "recharts";
import type { QoLDistributionBucket } from "@/lib/types/qol";

const COLORS: Record<string, string> = {
  critical: "#ef4444",
  "at-risk": "#f59e0b",
  stable: "#3b82f6",
  thriving: "#10b981",
};

interface QoLDistributionChartProps {
  data: QoLDistributionBucket[];
}

export function QoLDistributionChart({ data }: QoLDistributionChartProps) {
  const chartData = data.map((d) => ({
    name: d.label,
    value: d.count,
    band: d.band,
  }));

  return (
    <ResponsiveContainer width="100%" height={260}>
      <PieChart>
        <Pie
          data={chartData}
          cx="50%"
          cy="50%"
          innerRadius={60}
          outerRadius={90}
          paddingAngle={2}
          dataKey="value"
          nameKey="name"
        >
          {chartData.map((entry) => (
            <Cell key={entry.band} fill={COLORS[entry.band] ?? "#94a3b8"} />
          ))}
        </Pie>
        <Tooltip />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
}
