/**
 * Backend-agnostic blob storage contract (R1, R2).
 *
 * The app reads and writes blobs only through this interface — never through
 * a filesystem or object-store SDK directly — so a future S3-compatible
 * adapter can be dropped in behind it without touching callers (KTD1).
 *
 * This module intentionally imports nothing backend-specific (no `node:fs`,
 * no cloud SDKs): it is the shape callers and every adapter share.
 */

/** Opaque, server-generated storage key. Never derived from user input (R3). */
export type StorageKey = string;

export interface StorageService {
  /** Persists `bytes` under `key`, creating any needed parent structure. */
  save(key: StorageKey, bytes: Uint8Array): Promise<void>;

  /** Reads the blob stored at `key`. Rejects if the key does not exist. */
  read(key: StorageKey): Promise<Buffer>;

  /** Deletes the blob at `key`. Idempotent: a missing key is a no-op. */
  delete(key: StorageKey): Promise<void>;

  /** Generates a fresh, non-guessable storage key for a file with extension `ext`. */
  generateKey(ext: string): StorageKey;
}
