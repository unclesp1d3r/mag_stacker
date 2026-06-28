import { NotAuthorizedError, NotFoundError } from "@/src/auth/errors";
import { RateLimitError } from "@/src/auth/rate-limit";
import { DatabaseUnavailableError } from "@/src/db/health";
import { ValidationError } from "./errors";

/** Result envelope returned by Server Actions to the UI. */
export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; codes?: string[]; error?: string };

/** Map a thrown domain/auth error to a non-leaking ActionResult. */
export function toActionError(error: unknown): ActionResult<never> {
  if (error instanceof ValidationError)
    return { ok: false, codes: error.codes };
  if (error instanceof RateLimitError) {
    return {
      ok: false,
      error: `Too many requests — try again in ${error.retryAfterSeconds}s.`,
    };
  }
  if (error instanceof NotFoundError) return { ok: false, error: "Not found." };
  if (error instanceof NotAuthorizedError) {
    return { ok: false, error: "You are not allowed to do that." };
  }
  if (error instanceof DatabaseUnavailableError)
    return { ok: false, error: error.message };
  return { ok: false, error: "Something went wrong. Please try again." };
}
