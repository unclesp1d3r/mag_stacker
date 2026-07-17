import { describe, expect, mock, spyOn, test } from "bun:test";
import type pino from "pino";
import * as logging from "@/src/lib/logging";
import { toActionError } from "../action-result";
import { ValidationError } from "../errors";

/**
 * Unit tests for `toActionError`'s logging funnel (see the doc comment on
 * `toActionError`): every mapped error type (ValidationError, RateLimitError,
 * etc.) is intentionally silent, while anything unmapped logs one
 * `childLogger("action").error(...)` line so there is a server-side trail.
 *
 * `childLogger` is spied via the `@/src/lib/logging` barrel (mirrors the
 * `spyOn(logging, "logAction")` pattern in
 * `src/domain/firearms/__tests__/service.test.ts`), stubbed to return a fake
 * logger so no real Pino instance/transport is spun up.
 */

function fakeChildLogger() {
  const errorSpy = mock(() => undefined);
  const logger = { error: errorSpy } as unknown as pino.Logger;
  return { logger, errorSpy };
}

describe("toActionError — unhandled-error logging funnel", () => {
  test("an unmapped Error logs one 'unhandled action error' line and returns the generic shape", () => {
    const { logger, errorSpy } = fakeChildLogger();
    const childLoggerSpy = spyOn(logging, "childLogger").mockReturnValue(
      logger,
    );

    try {
      const error = new Error("boom");
      const result = toActionError(error);

      expect(result).toEqual({
        ok: false,
        error: "Something went wrong. Please try again.",
      });
      expect(childLoggerSpy).toHaveBeenCalledWith("action");
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledWith(
        { err: error },
        "unhandled action error",
      );
    } finally {
      childLoggerSpy.mockRestore();
    }
  });

  test("a mapped ValidationError returns the mapped shape and does not log", () => {
    const { logger, errorSpy } = fakeChildLogger();
    const childLoggerSpy = spyOn(logging, "childLogger").mockReturnValue(
      logger,
    );

    try {
      const result = toActionError(new ValidationError(["required"]));

      expect(result).toEqual({ ok: false, codes: ["required"] });
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      childLoggerSpy.mockRestore();
    }
  });
});
