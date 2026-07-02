import { headers } from "next/headers";
import { auth } from "@/auth";

/**
 * The authorization boundary helpers (KTD-2): every Server Action and Route
 * Handler that touches owned data resolves the session here — a full DB-backed
 * check — and passes the resolved user id into the domain/authorization layer.
 * The `proxy.ts` cookie gate is an optimistic first layer only, never the
 * authorization boundary (R66).
 */

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: string | null | undefined;
  /** Per-account Magpul mode (label dot-matrix constraint opt-in). */
  magpulMode: boolean;
};

/**
 * Shape of Better Auth's raw `session.user` for the fields we read. `role` and
 * `magpulMode` are dynamically-registered `additionalFields`, so they may be
 * absent at runtime — typed honestly as optional here so the defaulting in
 * `getCurrentUser` is type-checked rather than resting on an unsound cast.
 */
type RawSessionUser = {
  id: string;
  email: string;
  name: string;
  role?: string | null;
  magpulMode?: boolean | null;
};

/** Full DB-backed session, or null when missing/invalid. */
export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

/**
 * Resolve the authenticated user id, or null if unauthenticated. Callers reject
 * a null result before invoking any domain logic.
 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const session = await getSession();
  if (!session?.user) return null;
  const { id, email, name, role, magpulMode } = session.user as RawSessionUser;
  return { id, email, name, role, magpulMode: magpulMode ?? false };
}

/** True when the resolved user holds the admin role. */
export async function isAdmin(): Promise<boolean> {
  const user = await getCurrentUser();
  return user?.role === "admin";
}
