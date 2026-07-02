import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { admin } from "better-auth/plugins";
import { db } from "@/src/db/client";
import * as schema from "@/src/db/schema";

/**
 * Better Auth instance — email+password with DB-backed sessions, operator-only
 * account management, and rate-limited auth endpoints (KTD-6, no Redis).
 *
 * - `disableSignUp` closes the public sign-up path; accounts are created by an
 *   operator through the `admin` plugin (R7). The first admin is bootstrapped
 *   by `scripts/seed-admin.ts`, which calls the trusted server-side
 *   `auth.api.createUser` (server `auth.api.*` calls bypass the admin-session
 *   check, so it works on an empty database).
 * - The `admin` plugin uses an explicit admin-role configuration rather than
 *   relying on library defaults.
 * - `rateLimit` is stored in the database (no Redis), enabled in all modes,
 *   with a stricter rule on `/sign-in/email` to bound credential stuffing (R7a).
 * - `nextCookies()` MUST be the last plugin so Set-Cookie headers from Server
 *   Actions are applied.
 */
export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema }),
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
  },
  user: {
    additionalFields: {
      // Per-account opt-in for the PMAG dot-matrix label constraint (default
      // off). `input: false` keeps it out of account-creation input; it is
      // updated server-side by the settings toggle. Surfaces on the session.
      magpulMode: {
        type: "boolean",
        required: false,
        defaultValue: false,
        input: false,
      },
    },
  },
  rateLimit: {
    enabled: true,
    storage: "database",
    window: 60,
    max: 100,
    customRules: {
      // Stricter limit on credential sign-in to bound brute-force attempts.
      "/sign-in/email": { window: 60, max: 5 },
    },
  },
  plugins: [
    admin({ defaultRole: "user", adminRoles: ["admin"] }),
    nextCookies(),
  ],
});

export type Auth = typeof auth;
