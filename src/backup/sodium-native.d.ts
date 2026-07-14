/**
 * Minimal ambient types for `sodium-native`, scoped to exactly the API
 * surface `crypto.ts` (U1) uses.
 *
 * `sodium-native` ships no types of its own, and the only published
 * `@types/sodium-native` (2.3.9, DefinitelyTyped) predates the installed
 * v5.x line by several major versions — pinning to it risks a silent
 * mismatch against the actual runtime API. A small hand-written surface for
 * the handful of low-level libsodium primitives used here (which have been
 * stable across sodium-native's major versions) is safer and easier to
 * audit than trusting a stale third-party `.d.ts`.
 */
declare module "sodium-native" {
  // Argon2id key derivation (crypto_pwhash).
  export const crypto_pwhash_SALTBYTES: number;
  export const crypto_pwhash_ALG_ARGON2ID13: number;
  export const crypto_pwhash_OPSLIMIT_MODERATE: number;
  export const crypto_pwhash_MEMLIMIT_MODERATE: number;
  export function crypto_pwhash(
    out: Buffer,
    passwd: Buffer,
    salt: Buffer,
    opslimit: number,
    memlimit: number,
    alg: number,
  ): void;

  // Randomness.
  export function randombytes_buf(buffer: Buffer): void;

  // Authenticated streaming encryption (crypto_secretstream_xchacha20poly1305).
  export const crypto_secretstream_xchacha20poly1305_HEADERBYTES: number;
  export const crypto_secretstream_xchacha20poly1305_ABYTES: number;
  export const crypto_secretstream_xchacha20poly1305_KEYBYTES: number;
  export const crypto_secretstream_xchacha20poly1305_STATEBYTES: number;
  export const crypto_secretstream_xchacha20poly1305_TAG_MESSAGE: number;
  export const crypto_secretstream_xchacha20poly1305_TAG_FINAL: number;
  export function crypto_secretstream_xchacha20poly1305_init_push(
    state: Buffer,
    header: Buffer,
    key: Buffer,
  ): void;
  export function crypto_secretstream_xchacha20poly1305_init_pull(
    state: Buffer,
    header: Buffer,
    key: Buffer,
  ): void;
  export function crypto_secretstream_xchacha20poly1305_push(
    state: Buffer,
    ciphertext: Buffer,
    message: Buffer,
    additionalData: Buffer | null,
    tag: number,
  ): number;
  export function crypto_secretstream_xchacha20poly1305_pull(
    state: Buffer,
    message: Buffer,
    tag: Buffer,
    ciphertext: Buffer,
    additionalData: Buffer | null,
  ): number;
}
