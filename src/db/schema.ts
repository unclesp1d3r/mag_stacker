/**
 * Drizzle schema root.
 *
 * - Auth tables (user, session, account, verification, rateLimit) are generated
 *   by the Better Auth CLI into `auth-schema.ts` and re-exported here so they
 *   participate in the same Drizzle client and migration workflow (KTD-6).
 * - Inventory tables (firearms, magazines, the compatibility join, the
 *   polymorphic grant table, and the idempotency store) are added in U3.
 *
 * Regenerate auth tables with:
 *   bun x @better-auth/cli@latest generate --output src/db/auth-schema.ts -y
 */

export * from "./auth-schema";
