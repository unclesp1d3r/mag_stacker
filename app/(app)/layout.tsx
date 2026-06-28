import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getCurrentUser } from "@/src/auth/session";
import { AppShell } from "./app-shell";

/**
 * Gated layout (U13). Resolves the full DB-backed session — the real
 * authorization boundary (R66) — and redirects unauthenticated requests to
 * login. The proxy.ts cookie gate is only an optimistic first layer.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return <AppShell user={user}>{children}</AppShell>;
}
