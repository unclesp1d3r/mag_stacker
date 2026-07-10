import { requireUploadDir } from "./env";
import { LocalFilesystemAdapter } from "./local-fs-adapter";
import type { StorageService } from "./service";

export { requireUploadDir } from "./env";
export type { DerivativeVariant } from "./keys";
export { DERIVATIVE_SUFFIXES, deriveKey, generateKey } from "./keys";
export { LocalFilesystemAdapter, PathTraversalError } from "./local-fs-adapter";
export type { StorageKey, StorageService } from "./service";

/**
 * Shared storage backend (lazily constructed on first access).
 *
 * Construction is deferred to first use: importing this module must NOT
 * require `UPLOAD_DIR`, so server modules can be imported during `next build`
 * without an upload directory configured. `requireUploadDir()` then fails
 * fast at first *access*, mirroring `src/db/client.ts`.
 */
let activeStorage: StorageService | undefined;

function connect(): StorageService {
  if (!activeStorage) {
    activeStorage = new LocalFilesystemAdapter(requireUploadDir());
  }
  return activeStorage;
}

/** Lazy proxy: forwards to the real object built on first property access. */
function lazy<T extends object>(resolve: () => T): T {
  return new Proxy({} as T, {
    get(_target, prop) {
      const real = resolve() as object;
      const value = Reflect.get(real, prop, real);
      return typeof value === "function" ? value.bind(real) : value;
    },
  });
}

/** Shared storage service (lazily constructed on first access). */
export const storage: StorageService = lazy(connect);
