import { AppHeader } from "@/components/dashboard/app-header";
import { ClientsQoLView } from "@/components/dashboard/clients-qol-view";
import { getClientListSlim } from "@/lib/clients-query";

// ISR — was only dynamic transitively via the root layout's force-dynamic (removed).
export const revalidate = 900;

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
