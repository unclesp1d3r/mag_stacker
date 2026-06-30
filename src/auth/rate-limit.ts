import { RateLimiterMemory } from "rate-limiter-flexible";

/**
 * Per-user mutation rate limiting (U12, KTD-10). Beyond Better Auth's
 * auth-endpoint limiting (R7a), this bounds Postgres write load — especially
 * bulk-add (up to 1000 records/request). In-memory backend (sufficient for the
 * single-instance homelab deployment, no Redis). Thresholds are generous; the
 * user base is trusted (R72).
 */

export class RateLimitError extends Error {
  readonly retryAfterSeconds: number;
  constructor(retryAfterSeconds: number) {
    super("Too many requests. Please slow down and try again shortly.");
    this.name = "RateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface MutationLimiterOptions {
  /** Total points available per user per window. */
  points?: number;
  /** Window length in seconds. */
  durationSeconds?: number;
}

export interface MutationLimiter {
  consume(userId: string, points?: number): Promise<void>;
}

export function createMutationLimiter(
  options: MutationLimiterOptions = {},
): MutationLimiter {
  const limiter = new RateLimiterMemory({
    points: options.points ?? 300,
    duration: options.durationSeconds ?? 60,
  });
  return {
    async consume(userId: string, points = 1): Promise<void> {
      try {
        await limiter.consume(userId, points);
      } catch (rejection: unknown) {
        const msBeforeNext =
          typeof rejection === "object" &&
          rejection !== null &&
          "msBeforeNext" in rejection
            ? Number((rejection as { msBeforeNext: number }).msBeforeNext)
            : 1000;
        throw new RateLimitError(Math.ceil(msBeforeNext / 1000));
      }
    },
  };
}

/** Shared mutation limiter for the app's mutation entry points. */
export const mutationLimiter = createMutationLimiter();

/** Points charged for a bulk-add of `count` records (heavier than a single write). */
export function bulkAddCost(count: number): number {
  return Math.max(1, Math.ceil(count / 100));
}
