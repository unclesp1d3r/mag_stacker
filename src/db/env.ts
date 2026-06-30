/**
 * Boundary validation for database configuration.
 *
 * `DATABASE_URL` is the single connection secret; it is supplied at runtime
 * (host env or Docker secret), never baked into the image. Construction fails
 * fast with a clear error when it is missing so a misconfigured deployment
 * surfaces immediately instead of at the first query.
 */
export function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url || url.trim() === "") {
    throw new Error(
      "DATABASE_URL is not set. Supply it via the host environment or a Docker secret (see .env.example).",
    );
  }
  return url;
}
