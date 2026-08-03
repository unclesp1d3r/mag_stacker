import type { Page } from "@playwright/test";

/**
 * Shared console/page-error tracker (originally duplicated between
 * theme.spec.ts and magazine-dot-matrix.spec.ts).
 *
 * Ignores only the specific favicon 404 some production builds emit — a
 * narrow allowlist so genuine runtime errors (incl. net::ERR_*) still fail.
 */
const BENIGN_CONSOLE_PATTERNS = [/favicon\.ico/i];

function isBenignConsoleText(text: string): boolean {
  return BENIGN_CONSOLE_PATTERNS.some((pattern) => pattern.test(text));
}

/** Attach console/page-error listeners before any navigation the caller wants covered. */
export function trackConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !isBenignConsoleText(message.text())) {
      errors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    if (!isBenignConsoleText(error.message)) errors.push(error.message);
  });
  return errors;
}
