"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DashboardLiveSnapshot } from "@/lib/types/dashboard";

const CITY_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#94a3b8"];

interface DashboardChartsProps {
  monthly: DashboardLiveSnapshot["monthly"];
  cities: DashboardLiveSnapshot["cities"];
  categories: DashboardLiveSnapshot["categories"];
  topSubServices: DashboardLiveSnapshot["topSubServices"];
}

function shortCategory(name: string) {
  return name
    .replace("Errand Services/Non-emergency services", "Errand / Non-emergency")
    .replace("Medical Errands (non-emergency)", "Medical Errands")
    .replace("Internal Information Request", "Internal Info");
}

export function DashboardCharts({
  monthly,
  cities,
  categories,
  topSubServices,
}: DashboardChartsProps) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Monthly Volume</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={monthly}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="tickets" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">City Distribution</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie
                data={cities}
                dataKey="tickets"
                nameKey="city"
                cx="50%"
                cy="50%"
                innerRadius={50}
                outerRadius={80}
              >
                {cities.map((_, i) => (
                  <Cell key={i} fill={CITY_COLORS[i % CITY_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Top Categories</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart
              data={categories.map((c) => ({
                ...c,
                short: shortCategory(c.category),
              }))}
              layout="vertical"
              margin={{ left: 8 }}
            >
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis dataKey="short" type="category" width={120} tick={{ fontSize: 10 }} />
              <Tooltip />
              <Bar dataKey="tickets" fill="#10b981" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Top Sub-services</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={topSubServices.slice(0, 8)} layout="vertical" margin={{ left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis dataKey="subService" type="category" width={140} tick={{ fontSize: 9 }} />
              <Tooltip />
              <Bar dataKey="tickets" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}
