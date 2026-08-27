import { redirect } from "next/navigation";

/** Legacy route — QoL overview is on the main Dashboard */
export default function HealthPage() {
  redirect("/");
}
