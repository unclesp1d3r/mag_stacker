import { describe, expect, test } from "bun:test";
import { Readable } from "node:stream";
import { expectRejects } from "@/src/test-support/assertions";
import {
  CHUNK_SIZE,
  createDecryptStream,
  createEncryptStream,
  DEFAULT_KDF_PARAMS,
  DecryptionAuthError,
  deriveKey,
  FORMAT_VERSION,
  generateSalt,
  InvalidHeaderError,
  readHeader,
  writeHeader,
} from "../crypto";

/** Drains a Readable/Transform stream into a single Buffer. */
async function collect(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const chunk of stream) {
    parts.push(chunk as Buffer);
  }
  return Buffer.concat(parts);
}

/** Encrypts `plaintext` with `key`/`salt` and returns the full encrypted output (header + ciphertext). */
async function encrypt(
  key: Buffer,
  salt: Buffer,
  plaintext: Buffer,
): Promise<Buffer> {
  const source = Readable.from([plaintext]);
  const encrypted = source.pipe(createEncryptStream(key, salt));
  return collect(encrypted);
}

/** Decrypts a full encrypted buffer (header + ciphertext) with `key`. */
async function decrypt(key: Buffer, encrypted: Buffer): Promise<Buffer> {
  const source = Readable.from([encrypted]);
  const decrypted = source.pipe(createDecryptStream(key));
  return collect(decrypted);
}

describe("deriveKey", () => {
  test("is deterministic for the same password and salt", () => {
    const salt = generateSalt();

    const key1 = deriveKey("correct horse battery staple", salt);
    const key2 = deriveKey("correct horse battery staple", salt);

    expect(key1.equals(key2)).toBe(true);
  });

  test("differs across salts for the same password", () => {
    const saltA = generateSalt();
    const saltB = generateSalt();

    const keyA = deriveKey("same password", saltA);
    const keyB = deriveKey("same password", saltB);

    expect(keyA.equals(keyB)).toBe(false);
  });

  test("differs across passwords for the same salt", () => {
    const salt = generateSalt();

    const keyA = deriveKey("password one", salt);
    const keyB = deriveKey("password two", salt);

    expect(keyA.equals(keyB)).toBe(false);
  });

  test("generateSalt produces unique, correctly-sized salts", () => {
    const salts = Array.from({ length: 20 }, () => generateSalt());
    const unique = new Set(salts.map((s) => s.toString("hex")));

    expect(unique.size).toBe(20);
    for (const salt of salts) {
      expect(salt.byteLength).toBe(16);
    }
  });
});

describe("header round-trip", () => {
  test("writeHeader/readHeader recovers salt and KDF params", () => {
    const salt = generateSalt();
    const secretstreamHeader = Buffer.alloc(24, 7);

    const bytes = writeHeader({
      version: FORMAT_VERSION,
      salt,
      kdfParams: DEFAULT_KDF_PARAMS,
      secretstreamHeader,
    });
    const header = readHeader(bytes);

    expect(header.version).toBe(FORMAT_VERSION);
    expect(header.salt.equals(salt)).toBe(true);
    expect(header.kdfParams).toEqual(DEFAULT_KDF_PARAMS);
    expect(header.secretstreamHeader.equals(secretstreamHeader)).toBe(true);
  });

  test("readHeader rejects bad magic bytes", () => {
    const salt = generateSalt();
    const bytes = writeHeader({
      version: FORMAT_VERSION,
      salt,
      kdfParams: DEFAULT_KDF_PARAMS,
      secretstreamHeader: Buffer.alloc(24),
    });
    bytes[0] = bytes[0] ^ 0xff; // corrupt the first magic byte

    expect(() => readHeader(bytes)).toThrow(InvalidHeaderError);
  });

  test("readHeader rejects a buffer shorter than the header length", () => {
    expect(() => readHeader(Buffer.alloc(4))).toThrow(InvalidHeaderError);
  });

  test("readHeader rejects an unsupported format version", () => {
    const salt = generateSalt();
    const bytes = writeHeader({
      version: FORMAT_VERSION,
      salt,
      kdfParams: DEFAULT_KDF_PARAMS,
      secretstreamHeader: Buffer.alloc(24),
    });
    bytes[4] = 99; // version byte follows the 4-byte magic

    expect(() => readHeader(bytes)).toThrow(InvalidHeaderError);
  });
});

describe("encrypt/decrypt round-trip", () => {
  test("round-trips a small single-chunk input", async () => {
    const salt = generateSalt();
    const key = deriveKey("hunter2", salt);
    const plaintext = Buffer.from("a small secret payload");

    const encrypted = await encrypt(key, salt, plaintext);
    const decrypted = await decrypt(key, encrypted);

    expect(decrypted.equals(plaintext)).toBe(true);
  });

  test("round-trips an empty input", async () => {
    const salt = generateSalt();
    const key = deriveKey("hunter2", salt);
    const plaintext = Buffer.alloc(0);

    const encrypted = await encrypt(key, salt, plaintext);
    const decrypted = await decrypt(key, encrypted);

    expect(decrypted.length).toBe(0);
  });

  test("round-trips a multi-chunk input (several CHUNK_SIZE boundaries)", async () => {
    const salt = generateSalt();
    const key = deriveKey("hunter2", salt);
    // 3.5 chunks worth of pseudo-random bytes, deterministic for the test.
    const plaintext = Buffer.alloc(CHUNK_SIZE * 3.5);
    for (let i = 0; i < plaintext.length; i++) {
      plaintext[i] = i % 256;
    }

    const encrypted = await encrypt(key, salt, plaintext);
    const decrypted = await decrypt(key, encrypted);

    expect(decrypted.length).toBe(plaintext.length);
    expect(decrypted.equals(plaintext)).toBe(true);
  });

  test("round-trips an input that lands exactly on a CHUNK_SIZE boundary", async () => {
    const salt = generateSalt();
    const key = deriveKey("hunter2", salt);
    const plaintext = Buffer.alloc(CHUNK_SIZE * 2, 0xab);

    const encrypted = await encrypt(key, salt, plaintext);
    const decrypted = await decrypt(key, encrypted);

    expect(decrypted.equals(plaintext)).toBe(true);
  });

  test("input delivered across many small, unaligned writes still round-trips", async () => {
    const salt = generateSalt();
    const key = deriveKey("hunter2", salt);
    const plaintext = Buffer.alloc(CHUNK_SIZE + 777);
    for (let i = 0; i < plaintext.length; i++) {
      plaintext[i] = (i * 7) % 256;
    }

    // Feed the encrypt stream in small, deliberately-unaligned pieces.
    const source = Readable.from(chunkBuffer(plaintext, 333));
    const encryptedStream = source.pipe(createEncryptStream(key, salt));
    const encrypted = await collect(encryptedStream);
    const decrypted = await decrypt(key, encrypted);

    expect(decrypted.equals(plaintext)).toBe(true);
  });

  test("wrong password fails authenticated decryption and yields no plaintext", async () => {
    const salt = generateSalt();
    const rightKey = deriveKey("correct password", salt);
    const wrongKey = deriveKey("wrong password", salt);
    const plaintext = Buffer.from("top secret inventory data");

    const encrypted = await encrypt(rightKey, salt, plaintext);

    await expectRejects(() => decrypt(wrongKey, encrypted));
  });

  test("a single flipped byte in the ciphertext fails authentication", async () => {
    const salt = generateSalt();
    const key = deriveKey("hunter2", salt);
    const plaintext = Buffer.alloc(CHUNK_SIZE + 100, 0x42);

    const encrypted = await encrypt(key, salt, plaintext);
    // Flip a byte well past the (unencrypted) header, inside the ciphertext.
    const tampered = Buffer.from(encrypted);
    const flipIndex = tampered.length - 5;
    tampered[flipIndex] = tampered[flipIndex] ^ 0xff;

    await expectRejects(() => decrypt(key, tampered));
  });

  test("a flipped byte in the final chunk fails authentication", async () => {
    const salt = generateSalt();
    const key = deriveKey("hunter2", salt);
    // Two full chunks plus a partial final chunk so tampering the final
    // chunk's ciphertext is distinguishable from tampering an earlier one.
    const plaintext = Buffer.alloc(CHUNK_SIZE * 2 + 50, 0x11);

    const encrypted = await encrypt(key, salt, plaintext);
    const lastByte = encrypted.length - 1;
    const tampered = Buffer.from(encrypted);
    tampered[lastByte] = tampered[lastByte] ^ 0xff;

    await expectRejects(() => decrypt(key, tampered));
  });

  test("truncated ciphertext (missing final chunk) is refused, not silently accepted", async () => {
    const salt = generateSalt();
    const key = deriveKey("hunter2", salt);
    const plaintext = Buffer.alloc(CHUNK_SIZE + 500, 0x33);

    const encrypted = await encrypt(key, salt, plaintext);
    const truncated = encrypted.subarray(0, encrypted.length - 10);

    await expectRejects(() => decrypt(key, truncated));
  });

  test("throws when handed a decrypt key of the wrong length", () => {
    expect(() => createDecryptStream(Buffer.alloc(10))).toThrow();
  });

  test("throws when handed an encrypt key of the wrong length", () => {
    expect(() =>
      createEncryptStream(Buffer.alloc(10), generateSalt()),
    ).toThrow();
  });
});

describe("DecryptionAuthError", () => {
  test("is exported and is an Error subclass", () => {
    const err = new DecryptionAuthError("boom");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("DecryptionAuthError");
  });
});

/** Splits a buffer into pieces of at most `size` bytes, in order. */
function chunkBuffer(buf: Buffer, size: number): Buffer[] {
  const pieces: Buffer[] = [];
  for (let offset = 0; offset < buf.length; offset += size) {
    pieces.push(buf.subarray(offset, offset + size));
  }
  return pieces;
}
