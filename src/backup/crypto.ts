/**
 * Crypto module for MagStacker encrypted backups (plan Unit U1).
 *
 * A thin wrapper over libsodium — no hand-rolled crypto, no `openssl enc`.
 *
 * Binding choice (KTD1): `sodium-native` (native, prebuilt via prebuildify —
 * no compile step, so Bun's install doesn't need to build anything) was
 * verified to `import`/load cleanly under Bun 1.3 in this repo and is used
 * here. `libsodium-wrappers-sumo` (wasm) remains the documented portable
 * fallback if `sodium-native`'s native binding ever fails to load in a
 * target environment (see the plan's Deferred/Open Questions).
 *
 * - Key derivation: Argon2id via libsodium `crypto_pwhash`, using
 *   libsodium's own OWASP-aligned "MODERATE" ops/mem-limit constants and a
 *   16-byte random salt (R3, R11).
 * - Bulk encryption: `crypto_secretstream_xchacha20poly1305`, chunked at
 *   {@link CHUNK_SIZE} (64 KiB), authenticated end-to-end — a wrong key or a
 *   single flipped ciphertext byte fails authentication before any
 *   plaintext is produced for that chunk (R9, R11, AE3).
 * - A small, fixed-length, unencrypted header (magic bytes, format version,
 *   salt, KDF params, and the secretstream header) precedes the ciphertext
 *   so a bundle is self-describing. The header carries no secrets — it is
 *   exactly what a legitimate decryptor needs before it can even attempt to
 *   derive a key or authenticate the first chunk.
 *
 * No plaintext is ever persisted by this module; callers are responsible
 * for piping streams straight through (KTD3).
 */

import { Transform } from "node:stream";
import * as sodium from "sodium-native";

/** Plaintext chunk size for the secretstream framing (KTD3). */
export const CHUNK_SIZE = 64 * 1024;

/** Crypto header format version. Bump when the header layout changes. */
export const FORMAT_VERSION = 1;

const MAGIC = Buffer.from("MSKB", "ascii"); // "MagStacker Key Backup"

const SALT_BYTES = sodium.crypto_pwhash_SALTBYTES;
const SECRETSTREAM_HEADER_BYTES =
  sodium.crypto_secretstream_xchacha20poly1305_HEADERBYTES;
const SECRETSTREAM_ABYTES = sodium.crypto_secretstream_xchacha20poly1305_ABYTES;
const SECRETSTREAM_KEY_BYTES =
  sodium.crypto_secretstream_xchacha20poly1305_KEYBYTES;
const SECRETSTREAM_STATE_BYTES =
  sodium.crypto_secretstream_xchacha20poly1305_STATEBYTES;
const TAG_MESSAGE = sodium.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE;
const TAG_FINAL = sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL;

/** Ciphertext size for one full {@link CHUNK_SIZE} plaintext chunk. */
const CIPHERTEXT_CHUNK_SIZE = CHUNK_SIZE + SECRETSTREAM_ABYTES;

/** Argon2id parameters for {@link deriveKey}. */
export interface KdfParams {
  readonly opslimit: number;
  readonly memlimit: number;
  readonly alg: number;
}

/**
 * OWASP-aligned Argon2id parameters — libsodium's own "MODERATE" preset
 * (opslimit=3, memlimit=256 MiB), the pairing named in the plan (KTD1).
 */
export const DEFAULT_KDF_PARAMS: KdfParams = {
  opslimit: sodium.crypto_pwhash_OPSLIMIT_MODERATE,
  memlimit: sodium.crypto_pwhash_MEMLIMIT_MODERATE,
  alg: sodium.crypto_pwhash_ALG_ARGON2ID13,
};

/**
 * Upper bounds accepted for KDF parameters read from an untrusted bundle
 * header (see `readHeader`). Generous relative to MODERATE (3 / 256 MiB) so a
 * future SENSITIVE-tier bundle still validates, but finite so a hostile header
 * cannot force an unbounded pre-authentication Argon2id allocation.
 */
export const MAX_KDF_OPSLIMIT = 10;
export const MAX_KDF_MEMLIMIT = 1024 * 1024 * 1024; // 1 GiB

/** The bundle's unencrypted crypto header — see module doc comment. */
export interface CryptoHeader {
  readonly version: number;
  readonly salt: Buffer;
  readonly kdfParams: KdfParams;
  readonly secretstreamHeader: Buffer;
}

/** Fixed byte length of a serialized {@link CryptoHeader} (see {@link writeHeader}). */
export const HEADER_BYTE_LENGTH =
  MAGIC.byteLength + // magic
  1 + // version (uint8)
  SALT_BYTES + // salt
  4 + // opslimit (uint32 LE)
  8 + // memlimit (uint64 LE)
  1 + // alg (uint8)
  SECRETSTREAM_HEADER_BYTES; // secretstream header

/** Thrown when a header buffer is malformed, truncated, or has an unsupported version. */
export class InvalidHeaderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidHeaderError";
  }
}

/**
 * Thrown when authenticated decryption fails — a wrong key, a tampered
 * byte, or a truncated stream. Never carries recovered plaintext.
 */
export class DecryptionAuthError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DecryptionAuthError";
  }
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

/** Generates a fresh 16-byte random salt for {@link deriveKey}. */
export function generateSalt(): Buffer {
  const salt = Buffer.alloc(SALT_BYTES);
  sodium.randombytes_buf(salt);
  return salt;
}

/**
 * Derives a 32-byte secretstream key from `password` and `salt` via
 * Argon2id (`crypto_pwhash`). Deterministic for the same password + salt +
 * params; differs whenever any of those inputs differ.
 */
export function deriveKey(
  password: string,
  salt: Buffer,
  params: KdfParams = DEFAULT_KDF_PARAMS,
): Buffer {
  if (salt.byteLength !== SALT_BYTES) {
    throw new RangeError(`salt must be ${SALT_BYTES} bytes`);
  }
  const passwordBytes = Buffer.from(password, "utf8");
  const key = Buffer.alloc(SECRETSTREAM_KEY_BYTES);
  sodium.crypto_pwhash(
    key,
    passwordBytes,
    salt,
    params.opslimit,
    params.memlimit,
    params.alg,
  );
  return key;
}

/** Serializes a {@link CryptoHeader} to its fixed-length wire format. */
export function writeHeader(header: CryptoHeader): Buffer {
  if (header.salt.byteLength !== SALT_BYTES) {
    throw new RangeError(`header salt must be ${SALT_BYTES} bytes`);
  }
  if (header.secretstreamHeader.byteLength !== SECRETSTREAM_HEADER_BYTES) {
    throw new RangeError(
      `secretstreamHeader must be ${SECRETSTREAM_HEADER_BYTES} bytes`,
    );
  }

  const buf = Buffer.alloc(HEADER_BYTE_LENGTH);
  let offset = 0;

  MAGIC.copy(buf, offset);
  offset += MAGIC.byteLength;

  buf.writeUInt8(header.version, offset);
  offset += 1;

  header.salt.copy(buf, offset);
  offset += SALT_BYTES;

  buf.writeUInt32LE(header.kdfParams.opslimit, offset);
  offset += 4;

  buf.writeBigUInt64LE(BigInt(header.kdfParams.memlimit), offset);
  offset += 8;

  buf.writeUInt8(header.kdfParams.alg, offset);
  offset += 1;

  header.secretstreamHeader.copy(buf, offset);
  offset += SECRETSTREAM_HEADER_BYTES;

  return buf;
}

/**
 * Parses a {@link CryptoHeader} from the first {@link HEADER_BYTE_LENGTH}
 * bytes of `buf`. Throws {@link InvalidHeaderError} on bad magic, an
 * unsupported version, or a buffer shorter than the header.
 */
export function readHeader(buf: Buffer): CryptoHeader {
  if (buf.byteLength < HEADER_BYTE_LENGTH) {
    throw new InvalidHeaderError(
      `buffer is too short to contain a crypto header: got ${buf.byteLength} bytes, need ${HEADER_BYTE_LENGTH}`,
    );
  }

  let offset = 0;

  const magic = buf.subarray(offset, offset + MAGIC.byteLength);
  offset += MAGIC.byteLength;
  if (!magic.equals(MAGIC)) {
    throw new InvalidHeaderError("bad magic bytes: not a MagStacker backup");
  }

  const version = buf.readUInt8(offset);
  offset += 1;
  if (version !== FORMAT_VERSION) {
    throw new InvalidHeaderError(
      `unsupported crypto header version: ${version}`,
    );
  }

  const salt = Buffer.from(buf.subarray(offset, offset + SALT_BYTES));
  offset += SALT_BYTES;

  const opslimit = buf.readUInt32LE(offset);
  offset += 4;

  const memlimit = Number(buf.readBigUInt64LE(offset));
  offset += 8;

  const alg = buf.readUInt8(offset);
  offset += 1;

  // The KDF cost parameters come straight off an untrusted bundle header and
  // are fed to Argon2id (`deriveKey`) BEFORE any ciphertext byte is
  // authenticated. Without an upper bound, a crafted bundle could set
  // memlimit/opslimit arbitrarily high and exhaust memory/CPU on an admin's
  // restore attempt. Legitimate bundles use OWASP MODERATE (opslimit 3,
  // memlimit 256 MiB), well within these ceilings.
  if (opslimit > MAX_KDF_OPSLIMIT || memlimit > MAX_KDF_MEMLIMIT) {
    throw new InvalidHeaderError(
      `crypto header KDF parameters exceed the accepted maximum (opslimit=${opslimit}, memlimit=${memlimit})`,
    );
  }

  // `alg` is the third untrusted KDF field and is fed to `crypto_pwhash`
  // (`deriveKey`) just like opslimit/memlimit above. This module only ever
  // writes Argon2id (see `DEFAULT_KDF_PARAMS`), so any other value is a
  // corrupt or crafted bundle — reject it here as a header problem, rather
  // than letting a generic native `crypto_pwhash` error escape unclassified
  // past `InvalidHeaderError`/`DecryptionAuthError`.
  if (alg !== sodium.crypto_pwhash_ALG_ARGON2ID13) {
    throw new InvalidHeaderError(
      `crypto header KDF algorithm is not supported: ${alg}`,
    );
  }

  const secretstreamHeader = Buffer.from(
    buf.subarray(offset, offset + SECRETSTREAM_HEADER_BYTES),
  );
  offset += SECRETSTREAM_HEADER_BYTES;

  return {
    version,
    salt,
    kdfParams: { opslimit, memlimit, alg },
    secretstreamHeader,
  };
}

/**
 * Accumulates buffers and lets a caller pull off exact byte counts as they
 * become available — the framing primitive both stream transforms below use
 * to align arbitrary-sized writes to {@link CHUNK_SIZE}/
 * {@link CIPHERTEXT_CHUNK_SIZE} boundaries.
 */
class ByteAccumulator {
  private chunks: Buffer[] = [];
  private length = 0;

  push(chunk: Buffer): void {
    if (chunk.length === 0) return;
    this.chunks.push(chunk);
    this.length += chunk.length;
  }

  get size(): number {
    return this.length;
  }

  /** Removes and returns exactly `n` buffered bytes. Caller must check `size >= n` first. */
  take(n: number): Buffer {
    const combined =
      this.chunks.length === 1
        ? this.chunks[0]
        : Buffer.concat(this.chunks, this.length);
    const result = Buffer.from(combined.subarray(0, n));
    const rest = combined.subarray(n);
    this.chunks = rest.length > 0 ? [Buffer.from(rest)] : [];
    this.length = rest.length;
    return result;
  }

  /** Removes and returns all buffered bytes. */
  takeAll(): Buffer {
    return this.take(this.length);
  }
}

/**
 * Builds a `Transform` that encrypts a plaintext byte stream into a
 * MagStacker backup bundle stream: the fixed-length {@link CryptoHeader}
 * first, then `crypto_secretstream_xchacha20poly1305` ciphertext chunked at
 * {@link CHUNK_SIZE} plaintext bytes per chunk, with the last chunk tagged
 * `TAG_FINAL` (even for zero-byte input, so every encrypted stream ends in
 * exactly one authenticated final chunk).
 *
 * `salt` and `kdfParams` are only needed to make the header self-describing
 * — `key` must already be `deriveKey(password, salt, kdfParams)`.
 */
export function createEncryptStream(
  key: Buffer,
  salt: Buffer,
  kdfParams: KdfParams = DEFAULT_KDF_PARAMS,
): Transform {
  if (key.byteLength !== SECRETSTREAM_KEY_BYTES) {
    throw new RangeError(`key must be ${SECRETSTREAM_KEY_BYTES} bytes`);
  }
  if (salt.byteLength !== SALT_BYTES) {
    throw new RangeError(`salt must be ${SALT_BYTES} bytes`);
  }

  // Defensively copy on ingest, matching `readHeader`'s discipline — this
  // closure holds `salt` for the lifetime of the stream (it's written into
  // every call's header), so a caller mutating its buffer after the call
  // must not be able to affect an already-in-flight encryption.
  const ingestedSalt = Buffer.from(salt);

  const state = Buffer.alloc(SECRETSTREAM_STATE_BYTES);
  const secretstreamHeader = Buffer.alloc(SECRETSTREAM_HEADER_BYTES);
  sodium.crypto_secretstream_xchacha20poly1305_init_push(
    state,
    secretstreamHeader,
    key,
  );

  const pending = new ByteAccumulator();
  let headerWritten = false;

  function encryptChunk(
    stream: Transform,
    plaintext: Buffer,
    tag: number,
  ): void {
    const ciphertext = Buffer.alloc(plaintext.length + SECRETSTREAM_ABYTES);
    sodium.crypto_secretstream_xchacha20poly1305_push(
      state,
      ciphertext,
      plaintext,
      null,
      tag,
    );
    stream.push(ciphertext);
  }

  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      try {
        if (!headerWritten) {
          this.push(
            writeHeader({
              version: FORMAT_VERSION,
              salt: ingestedSalt,
              kdfParams,
              secretstreamHeader,
            }),
          );
          headerWritten = true;
        }

        pending.push(chunk);
        while (pending.size >= CHUNK_SIZE) {
          encryptChunk(this, pending.take(CHUNK_SIZE), TAG_MESSAGE);
        }
        callback();
      } catch (err) {
        callback(toError(err));
      }
    },
    flush(callback) {
      try {
        if (!headerWritten) {
          this.push(
            writeHeader({
              version: FORMAT_VERSION,
              salt: ingestedSalt,
              kdfParams,
              secretstreamHeader,
            }),
          );
          headerWritten = true;
        }
        // Final chunk carries TAG_FINAL even when empty (zero-byte input),
        // so every stream this function produces ends in one authenticated
        // final chunk a decryptor can rely on (KTD10's authenticate-before-
        // trust contract starts here).
        encryptChunk(this, pending.takeAll(), TAG_FINAL);
        callback();
      } catch (err) {
        callback(toError(err));
      }
    },
  });
}

/**
 * Builds a `Transform` that decrypts a MagStacker backup bundle stream from a
 * `password` alone (U5's restore entry point). {@link createDecryptStream}
 * needs the derived key up front, but the key can only be derived from the
 * salt and KDF params that live inside the bundle's own unencrypted
 * {@link CryptoHeader} preamble — a chicken-and-egg problem solved here by
 * peeking the first {@link HEADER_BYTE_LENGTH} bytes off the stream first.
 *
 * Once enough bytes have arrived, this parses the header, derives the key via
 * {@link deriveKey}, builds the real {@link createDecryptStream}, and
 * re-prepends the buffered header bytes to it — so nothing is lost. From the
 * caller's side this behaves exactly like {@link createDecryptStream}: pipe
 * the raw encrypted stream in, read decrypted plaintext out.
 *
 * Throws {@link InvalidHeaderError} if the stream ends before a complete
 * header is read, and {@link DecryptionAuthError} for a wrong password or a
 * tampered/truncated bundle — including, for a tamper in the final chunk,
 * only once the whole stream has been consumed (see
 * {@link createDecryptStream}'s doc comment; this is what lets a
 * stage-then-promote restore catch a late tamper before anything live is
 * touched).
 */
export function createDecryptStreamFromPassword(password: string): Transform {
  const headerAcc = new ByteAccumulator();
  let inner: Transform | undefined;

  const outer: Transform = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      try {
        if (inner) {
          inner.write(chunk, (err) => callback(err ? toError(err) : undefined));
          return;
        }

        headerAcc.push(chunk);
        if (headerAcc.size < HEADER_BYTE_LENGTH) {
          callback();
          return;
        }

        // May include ciphertext bytes beyond the header if this write
        // delivered more than HEADER_BYTE_LENGTH bytes at once — that's fine,
        // `readHeader` only reads its fixed-length prefix, and the whole
        // buffer (header + any trailing ciphertext) is exactly what a raw
        // stream into `createDecryptStream` looks like, so it's forwarded
        // whole below.
        const combined = headerAcc.takeAll();
        const header = readHeader(combined);
        const key = deriveKey(password, header.salt, header.kdfParams);
        inner = createDecryptStream(key);
        inner.on("data", (data: Buffer) => outer.push(data));
        // Errors already surface through the write/flush callback chain
        // below (which destroys `outer` the normal way); this listener only
        // exists so an unhandled 'error' event on `inner` doesn't crash the
        // process.
        inner.on("error", () => {});

        inner.write(combined, (err) =>
          callback(err ? toError(err) : undefined),
        );
      } catch (err) {
        callback(toError(err));
      }
    },
    flush(callback) {
      try {
        if (!inner) {
          // Never reached a full header. This always throws
          // InvalidHeaderError (buffer too short) — the explicit throw below
          // is an unreachable safety net in case that ever changes.
          readHeader(headerAcc.takeAll());
          throw new InvalidHeaderError(
            "bundle stream ended before a complete crypto header was read",
          );
        }
        inner.end((err?: Error | null) =>
          callback(err ? toError(err) : undefined),
        );
      } catch (err) {
        callback(toError(err));
      }
    },
  });

  return outer;
}

/**
 * Builds a `Transform` that decrypts a MagStacker backup bundle stream
 * produced by {@link createEncryptStream}: it parses the leading
 * {@link CryptoHeader} itself (the header is unencrypted preamble, so no key
 * is needed to read it), then authenticates and decrypts each ciphertext
 * chunk with `key`.
 *
 * Throws {@link InvalidHeaderError} for a malformed/truncated header and
 * {@link DecryptionAuthError} for a wrong key, a tampered ciphertext byte
 * (anywhere, including the final chunk), or a stream that ends before an
 * authenticated final chunk — in every failure case, no unauthenticated
 * plaintext is ever pushed downstream.
 */
export function createDecryptStream(key: Buffer): Transform {
  if (key.byteLength !== SECRETSTREAM_KEY_BYTES) {
    throw new RangeError(`key must be ${SECRETSTREAM_KEY_BYTES} bytes`);
  }

  const state = Buffer.alloc(SECRETSTREAM_STATE_BYTES);
  const headerBuf = new ByteAccumulator();
  const ciphertext = new ByteAccumulator();
  let initialized = false;
  let finalized = false;

  function decryptChunk(stream: Transform, ct: Buffer): void {
    if (ct.byteLength < SECRETSTREAM_ABYTES) {
      throw new DecryptionAuthError(
        "ciphertext chunk shorter than the authentication tag: truncated or corrupt bundle",
      );
    }
    const plaintext = Buffer.alloc(ct.byteLength - SECRETSTREAM_ABYTES);
    const tag = Buffer.alloc(1);
    try {
      sodium.crypto_secretstream_xchacha20poly1305_pull(
        state,
        plaintext,
        tag,
        ct,
        null,
      );
    } catch (err) {
      throw new DecryptionAuthError(
        "authenticated decryption failed: wrong password/key or a tampered/corrupt bundle",
        { cause: err },
      );
    }
    stream.push(plaintext);
    if (tag[0] === TAG_FINAL) {
      finalized = true;
    }
  }

  function drainFullChunks(stream: Transform): void {
    while (!finalized && ciphertext.size >= CIPHERTEXT_CHUNK_SIZE) {
      decryptChunk(stream, ciphertext.take(CIPHERTEXT_CHUNK_SIZE));
    }
  }

  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      try {
        if (finalized) {
          throw new DecryptionAuthError(
            "received data after the final authenticated chunk: trailing/corrupt bytes",
          );
        }

        if (!initialized) {
          headerBuf.push(chunk);
          if (headerBuf.size < HEADER_BYTE_LENGTH) {
            callback();
            return;
          }
          const header = readHeader(headerBuf.take(HEADER_BYTE_LENGTH));
          try {
            sodium.crypto_secretstream_xchacha20poly1305_init_pull(
              state,
              header.secretstreamHeader,
              key,
            );
          } catch (err) {
            throw new DecryptionAuthError(
              "failed to initialize decryption from the bundle header",
              { cause: err },
            );
          }
          initialized = true;
          ciphertext.push(headerBuf.takeAll());
        } else {
          ciphertext.push(chunk);
        }

        drainFullChunks(this);
        callback();
      } catch (err) {
        callback(toError(err));
      }
    },
    flush(callback) {
      try {
        if (!initialized) {
          throw new InvalidHeaderError(
            "bundle ended before a complete crypto header was read",
          );
        }
        if (finalized) {
          callback();
          return;
        }
        if (ciphertext.size === 0) {
          throw new DecryptionAuthError(
            "bundle ended before its final authenticated chunk: truncated bundle",
          );
        }
        decryptChunk(this, ciphertext.takeAll());
        if (!finalized) {
          throw new DecryptionAuthError(
            "bundle ended without a final authenticated chunk: truncated bundle",
          );
        }
        callback();
      } catch (err) {
        callback(toError(err));
      }
    },
  });
}
