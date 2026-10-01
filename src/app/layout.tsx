import type { Metadata } from "next";
import { AppSidebar } from "@/components/dashboard/app-sidebar";
import { AutoHubSpotSync } from "@/components/dashboard/auto-hubspot-sync";
import { getSidebarBootstrap } from "@/lib/sidebar-bootstrap";
import { PHASE_PRODUCTION_BUILD } from "next/constants";
import { warmSession } from "@/lib/data-source";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mohsyn Dashboard",
  description: "Client utilization, QoL, engagement, and operations",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Warm this serverless instance before reading its sync state. On a cold or
  // stale instance this blocks ~1-2s to pull the live Odoo delta (then cached
  // ~12min); on a warm instance it is an instant cache reuse. This is what
  // makes the board show the same figures on every tab move instead of
  // flickering back to the frozen pre-cutover baseline on a cold instance.
  // Skipped during `next build`, which statically prerenders the few non-data
  // pages (404, health) — those must never call Odoo at build time.
  if (process.env.NEXT_PHASE !== PHASE_PRODUCTION_BUILD) await warmSession();
  const { period, syncSource, lastSyncedAt, live } = getSidebarBootstrap();

  return (
    <html lang="en">
      <body>
        <AutoHubSpotSync cold={!live} />
        <div className="flex min-h-screen">
          <AppSidebar
            period={period}
            syncSource={syncSource}
            lastSyncedAt={lastSyncedAt}
          />
          <main className="min-w-0 flex-1 overflow-auto p-6">{children}</main>
        </div>
      </body>
    </html>
  );
}
