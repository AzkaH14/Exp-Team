import { redirect } from "next/navigation";

/** Engagement Hub retired — underutilising + light prompts live on the calendar. */
export default function EngagementPage() {
  redirect("/engagement-calendar");
}
