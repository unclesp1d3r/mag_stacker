import { expect } from "bun:test";

/**
 * Asserts a thenable rejects. Drizzle/pg query builders are thenables, not
 * Promises, so bun's `.rejects` matcher is unreliable on them — use this helper
 * for direct DB calls (see memory: bun-test-rejects-drizzle-thenable).
 *
 * Imported only by *.test.ts.
 */
export async function expectRejects(fn: () => Promise<unknown>): Promise<void> {
  let threw = false;
  try {
    await fn();
  } catch {
    threw = true;
  }
  expect(threw).toBe(true);
}
