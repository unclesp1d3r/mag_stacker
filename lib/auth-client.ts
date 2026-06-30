"use client";

import { adminClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/**
 * Browser auth client (Better Auth). The `adminClient` plugin exposes the
 * operator account-management actions used by the admin screen (U13). Sign-in /
 * sign-out and session hooks come from the base client.
 */
export const authClient = createAuthClient({
  plugins: [adminClient()],
});

export const { signIn, signOut, useSession } = authClient;
