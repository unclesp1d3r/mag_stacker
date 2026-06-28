/**
 * Drizzle schema root.
 *
 * Tables are added in U3 (core inventory: firearms, magazines, the
 * compatibility join, the polymorphic grant table, and the idempotency store)
 * and by the Better Auth CLI generator in U2 (user/session/account tables).
 * This file is intentionally empty at the platform-foundation stage so the
 * client, migration workflow, and test harness can be wired and proven first.
 */

export {};
