import { redirect } from "next/navigation";

/** Legacy route — client directory lives under Client QoL */
export default function UsersPage() {
  redirect("/clients");
}
