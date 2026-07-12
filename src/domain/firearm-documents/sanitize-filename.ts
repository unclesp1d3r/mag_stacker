/**
 * Filename sanitization (U5, KTD6, R3). One pass does double duty: it removes
 * the characters that enable BOTH path traversal (path separators) and
 * `Content-Disposition` header injection (control characters, CR/LF), then
 * length-caps. The sanitized name is what gets stored and later emitted as the
 * download filename (via RFC 6266 encoding in the serving route, U6), so it
 * must be safe to place in a header value.
 *
 * Note the storage key itself is server-generated (`generateKey`), never
 * derived from this name — so a residual `..` (with its separators stripped)
 * cannot traverse anything; it is only ever a display/download label.
 *
 * The unsafe-character test is written as an explicit code-point check rather
 * than a regex with embedded control bytes: raw 0x00-0x1F/0x7F literals in the
 * source would make git treat this security-critical file as binary, breaking
 * line-level diff/blame/review. Keeping it plain-text keeps the strip auditable.
 */

/** Max stored filename length. Well under the 255-byte filesystem norm and
 * short enough to keep the download label reasonable. */
const MAX_FILENAME_LENGTH = 200;

/** Fallback when sanitization leaves nothing usable (e.g. a name that was all
 * separators/control chars). */
const FALLBACK_FILENAME = "document";

/** Longest trailing ".ext" we bother preserving when truncating. */
const MAX_EXTENSION_LENGTH = 10;

const CONTROL_CHAR_MAX = 0x1f; // C0 controls incl. TAB (0x09), LF (0x0a), CR (0x0d)
const DEL_CHAR = 0x7f;

/** True for path separators, the `Content-Disposition` quoted-string delimiter
 * (`"`), and control characters (C0 range + DEL) — removing these neutralizes
 * traversal and header-injection in one pass, so the stored name is safe to
 * place in a header even before the serving route's RFC 6266 encoding. */
function isUnsafeChar(char: string): boolean {
  if (char === "/" || char === "\\" || char === '"') return true;
  const code = char.codePointAt(0) ?? 0;
  return code <= CONTROL_CHAR_MAX || code === DEL_CHAR;
}

export function sanitizeFilename(raw: string): string {
  let stripped = "";
  for (const char of raw) {
    if (!isUnsafeChar(char)) stripped += char;
  }
  stripped = stripped.trim();
  if (stripped === "") return FALLBACK_FILENAME;

  // Code-point (not UTF-16 code-unit) counting/slicing throughout: `.length`
  // and `.slice()` operate on UTF-16 code units, so a truncation boundary that
  // falls inside an astral character (e.g. an emoji) would split its surrogate
  // pair and leave a lone surrogate in the stored/served filename.
  const codePoints = Array.from(stripped);
  if (codePoints.length <= MAX_FILENAME_LENGTH) return stripped;

  // Preserve a trailing extension when truncating so the download label keeps
  // a sensible suffix (e.g. `.pdf`). `dot` is a UTF-16 index into `stripped`,
  // but a literal "." is always a single code unit and never part of a
  // surrogate pair, so `stripped.slice(dot)` is always a code-point-aligned
  // suffix — safe to re-split into code points below.
  const dot = stripped.lastIndexOf(".");
  const extCodePoints = dot > 0 ? Array.from(stripped.slice(dot)) : [];
  if (dot > 0 && extCodePoints.length <= MAX_EXTENSION_LENGTH) {
    return (
      codePoints.slice(0, MAX_FILENAME_LENGTH - extCodePoints.length).join("") +
      extCodePoints.join("")
    );
  }
  return codePoints.slice(0, MAX_FILENAME_LENGTH).join("");
}
