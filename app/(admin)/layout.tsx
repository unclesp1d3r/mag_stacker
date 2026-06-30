import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getCurrentUser } from "@/src/auth/session";
import { AppShell } from "../(app)/app-shell";

/** Admin-only gate (U13). Non-admins are bounced to the inventory. */
export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/magazines");
  return <AppShell user={user}>{children}</AppShell>;
}
