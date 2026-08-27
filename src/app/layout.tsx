import type { Metadata } from "next";
import { AppSidebar } from "@/components/dashboard/app-sidebar";
import { AutoHubSpotSync } from "@/components/dashboard/auto-hubspot-sync";
import { getSidebarBootstrap } from "@/lib/sidebar-bootstrap";
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
  // Keep layout light — do not load tickets.json or rebuild QoL here.
  const { period, syncSource, lastSyncedAt } = getSidebarBootstrap();

  return (
    <html lang="en">
      <body>
        <AutoHubSpotSync />
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
