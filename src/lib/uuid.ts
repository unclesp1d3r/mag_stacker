/**
 * UUID shape check for untrusted route parameters. Inventory ids are Postgres
 * `uuid` columns, so querying with a malformed id (a typo'd or truncated URL)
 * raises an "invalid input syntax for type uuid" error instead of returning no
 * rows. Reject the id at the request boundary so a bad id resolves as not-found
 * rather than an unhandled 500 (a malformed id can match no record anyway).
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}
