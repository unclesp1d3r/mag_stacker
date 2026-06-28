import { redirect } from "next/navigation";

/** Post-login landing → the primary inventory surface (F1). */
export default function AppHome() {
  redirect("/magazines");
}
