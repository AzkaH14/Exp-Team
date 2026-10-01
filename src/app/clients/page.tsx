import { AppHeader } from "@/components/dashboard/app-header";
import { ClientsQoLView } from "@/components/dashboard/clients-qol-view";
import { getClientListSlim } from "@/lib/clients-query";

// Dynamic, not ISR: live data sits in each serverless instance's memory, and an
// ISR copy rendered on a cold instance would serve the frozen baseline for up to
// 15 min. The root layout's warmSession() keeps this cheap (per-instance cache).
export const dynamic = "force-dynamic";

export default function ClientsPage() {
  const clients = getClientListSlim();

  return (
    <>
      <AppHeader
        title="Client QoL"
        description="Quality of Life scores across all clients — filter by city"
      />
      <ClientsQoLView clients={clients} />
    </>
  );
}
