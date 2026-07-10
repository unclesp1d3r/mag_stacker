import type { StorageKey } from "./service";

/**
 * Server-side, uuid-based key generation (R3, KTD7). Uses `crypto.randomUUID()`
 * so keys are unique and non-guessable; callers must never derive a key from
 * user-supplied input (e.g. an uploaded filename).
 */
export function generateKey(ext: string): StorageKey {
  const normalizedExt = ext.startsWith(".") ? ext.slice(1) : ext;
  return `${crypto.randomUUID()}.${normalizedExt}`;
}

/** Suffixes appended to a base key to address its derivatives (KTD5). */
export const DERIVATIVE_SUFFIXES = {
  thumb: "thumb",
  preview: "preview",
} as const;

export type DerivativeVariant = keyof typeof DERIVATIVE_SUFFIXES;

/**
 * Derives a derivative key from a base (original) key by suffix convention —
 * `<key>.thumb`, `<key>.preview` (KTD5). No manifest, no lookup table: the
 * derivative's location is always computable from the original key alone.
 * Only ever called with a server-generated base key, never user input.
 */
export function deriveKey(
  baseKey: StorageKey,
  variant: DerivativeVariant,
): StorageKey {
  return `${baseKey}.${DERIVATIVE_SUFFIXES[variant]}`;
}
