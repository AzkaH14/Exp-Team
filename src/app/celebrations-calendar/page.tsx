import { AppHeader } from "@/components/dashboard/app-header";
import { CelebrationsCalendar } from "@/components/dashboard/celebrations-calendar";
import { getCelebrationsMonth } from "@/lib/celebrations/calendar-store";
import { kickOffHubSpotProfileRefreshIfStale } from "@/lib/client-registry/refresh-hubspot-profile-cache";

export const dynamic = "force-dynamic";

export default async function CelebrationsCalendarPage() {
  const month = new Date().toISOString().slice(0, 7);
  const initial = await getCelebrationsMonth(month);
  kickOffHubSpotProfileRefreshIfStale();

  return (
    <>
      <AppHeader
        title="Celebrations Calendar"
        description="Birthdays, anniversaries, holidays, and special moments across every city"
      />
      <CelebrationsCalendar initial={initial} />
    </>
  );
}
