"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  HeartPulse,
  Bell,
  Settings,
  BookUser,
  FileText,
  CalendarDays,
  PhoneCall,
} from "lucide-react";
import { cn, formatSyncTime } from "@/lib/utils";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/clients", label: "Client QoL", icon: HeartPulse },
  { href: "/engagement-calendar", label: "Engagement Calendar", icon: CalendarDays },
  { href: "/touchbase", label: "Touchbase Tracker", icon: PhoneCall },
  { href: "/celebrations-calendar", label: "Celebrations Calendar", icon: CalendarDays },
  { href: "/client-profiles", label: "Client Profiles", icon: BookUser },
  { href: "/family-reports", label: "Family Reports", icon: FileText },
  { href: "/alerts", label: "Alerts", icon: Bell },
  { href: "/settings", label: "Integrations", icon: Settings },
];

interface AppSidebarProps {
  period: string;
  syncSource: "odoo" | "hubspot" | "static";
  lastSyncedAt: string | null;
}

export function AppSidebar({ period, syncSource, lastSyncedAt }: AppSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    for (const item of navItems) {
      if (item.href !== pathname) router.prefetch(item.href);
    }
  }, [pathname, router]);

  return (
    <aside className="flex h-screen w-60 shrink-0 flex-col border-r bg-card">
      <div className="flex h-14 items-center border-b px-4">
        <span className="text-lg font-bold tracking-tight text-primary">Mohsyn</span>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {navItems.map((item) => {
          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch
              onMouseEnter={() => router.prefetch(item.href)}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t p-4 text-xs text-muted-foreground">
        <p className="font-medium text-foreground">{period}</p>
        <p className="mt-0.5">
          {syncSource === "odoo"
            ? lastSyncedAt
              ? "Odoo live"
              : "HubSpot history"
            : syncSource === "hubspot"
              ? lastSyncedAt
                ? "HubSpot live"
                : "HubSpot snapshot"
              : "Static fallback"}
          {lastSyncedAt && (
            <>
              <br />
              Synced {formatSyncTime(lastSyncedAt)}
            </>
          )}
        </p>
      </div>
    </aside>
  );
}
