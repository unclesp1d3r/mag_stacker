import { describe, expect, test } from "bun:test";
import {
  bulkAddCost,
  createMutationLimiter,
  RateLimitError,
} from "../rate-limit";

describe("mutation rate limiter (U12, KTD-10)", () => {
  test("a user exceeding the limit is throttled with a retry signal", async () => {
    const limiter = createMutationLimiter({ points: 2, durationSeconds: 60 });
    await limiter.consume("user-1");
    await limiter.consume("user-1");
    try {
      await limiter.consume("user-1");
      throw new Error("expected a RateLimitError");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(RateLimitError);
      expect((error as RateLimitError).retryAfterSeconds).toBeGreaterThan(0);
    }
  });

  test("normal usage is never throttled", async () => {
    const limiter = createMutationLimiter({ points: 300, durationSeconds: 60 });
    for (let i = 0; i < 50; i++) {
      await limiter.consume("normal-user");
    }
    // No throw means not throttled.
    expect(true).toBe(true);
  });

  test("limits are per-user — one user's usage does not throttle another", async () => {
    const limiter = createMutationLimiter({ points: 1, durationSeconds: 60 });
    await limiter.consume("heavy");
    await expect(limiter.consume("heavy")).rejects.toBeInstanceOf(
      RateLimitError,
    );
    // A different user still has their full budget.
    await expect(limiter.consume("light")).resolves.toBeUndefined();
  });

  test("bulkAddCost scales with batch size", () => {
    expect(bulkAddCost(1)).toBe(1);
    expect(bulkAddCost(100)).toBe(1);
    expect(bulkAddCost(101)).toBe(2);
    expect(bulkAddCost(1000)).toBe(10);
  });
});
