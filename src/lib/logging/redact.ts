/**
 * Curated redaction denylist for structured log fields (R8, R9, KTD-3).
 *
 * IMPORTANT — Pino's `redact` wildcard (`*`) matches EXACTLY ONE path level;
 * there is no recursive `**` match. `REDACT_PATHS` therefore enumerates both
 * top-level keys AND one-level-nested keys (via `*.key`) in camelCase and
 * snake_case. This is an honest constraint, not full-tree redaction: a
 * sensitive key nested deeper than one level will NOT be caught here.
 *
 * Convention: log domain objects under a single known key (e.g.
 * `{ firearm: {...} }`, `{ magazine: {...} }`) so a sensitive field always
 * sits at a predictable depth (top level or one level under that known key)
 * and is covered by this denylist. Redaction only applies to structured
 * fields, never to values interpolated into the message string (R9) — call
 * sites must pass sensitive data as fields, not concatenate it into messages.
 */
export const REDACT_PATHS: string[] = [
  "serialNumber",
  "serial_number",
  "*.serialNumber",
  "*.serial_number",
  "email",
  "*.email",
  "password",
  "*.password",
  "token",
  "*.token",
  "sessionToken",
  "session_token",
  "*.sessionToken",
  "*.session_token",
  "accessToken",
  "access_token",
  "authorization",
  "req.headers.authorization",
  "req.headers.cookie",
];

/** Placeholder written in place of a redacted value. */
export const REDACT_CENSOR = "[REDACTED]";
