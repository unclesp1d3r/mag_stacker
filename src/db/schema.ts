/**
 * Drizzle schema root.
 *
 * - Auth tables (user, session, account, verification, rateLimit) are generated
 *   by the Better Auth CLI into `auth-schema.ts` and re-exported here so they
 *   participate in the same Drizzle client and migration workflow (KTD-6).
 * - Inventory tables (firearms, magazines, the compatibility join, the
 *   polymorphic grant table, and the idempotency store) live in
 *   `inventory-schema.ts` (U3).
 * - The operator audit trail (backup export/restore events) lives in
 *   `operator-audit-schema.ts` (U3 — encryption-at-rest backups plan).
 *
 * Regenerate auth tables with:
 *   bun x @better-auth/cli@latest generate --output src/db/auth-schema.ts -y
 */

export * from "./auth-schema";
export * from "./inventory-schema";
export * from "./operator-audit-schema";
