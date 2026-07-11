/**
 * Boundary validation for storage configuration.
 *
 * `UPLOAD_DIR` is the local-filesystem root every storage key resolves under
 * (KTD1). It is supplied at runtime (host env or a mounted Docker volume),
 * never baked into the image. Construction fails fast with a clear error when
 * it is missing so a misconfigured deployment surfaces immediately instead of
 * at the first upload.
 */
export function requireUploadDir(): string {
  const dir = process.env.UPLOAD_DIR;
  if (!dir || dir.trim() === "") {
    throw new Error(
      "UPLOAD_DIR is not set. Supply it via the host environment or a Docker volume mount (see .env.example).",
    );
  }
  return dir;
}
