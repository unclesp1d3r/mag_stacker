import { describe, expect, test } from "bun:test";
import { sanitizeFilename } from "../sanitize-filename";

/**
 * Direct unit coverage for the security-critical filename sanitizer (KTD6, R3).
 * Its job is to strip the characters that enable path traversal AND
 * `Content-Disposition` header injection, then length-cap — this exercises each
 * branch so a future refactor of the strip set or the truncation math fails
 * loudly.
 */
describe("sanitizeFilename (U5, KTD6, R3)", () => {
  test("strips path separators (forward and back slash)", () => {
    const out = sanitizeFilename("../../etc/passwd.pdf");
    expect(out).not.toContain("/");
    expect(out).not.toContain("\\");
    expect(sanitizeFilename("a\\b/c.pdf")).toBe("abc.pdf");
  });

  test("strips CR, LF, TAB, and other C0 control characters", () => {
    const out = sanitizeFilename("evil\r\n\tSet-Cookie: x=1.pdf");
    expect(out).not.toContain("\r");
    expect(out).not.toContain("\n");
    expect(out).not.toContain("\t");
    // A bare BEL (0x07) and NUL (0x00) are removed too.
    expect(sanitizeFilename("a\x07b\x00c.pdf")).toBe("abc.pdf");
  });

  test("strips DEL (0x7f)", () => {
    expect(sanitizeFilename("a\x7fb.pdf")).toBe("ab.pdf");
  });

  test("strips the double-quote (Content-Disposition delimiter)", () => {
    expect(sanitizeFilename('in"jection".pdf')).toBe("injection.pdf");
    expect(sanitizeFilename('in"jection".pdf')).not.toContain('"');
  });

  test("preserves spaces, hyphens, and normal punctuation", () => {
    expect(sanitizeFilename("My Receipt - ATF Form 4 (2026).pdf")).toBe(
      "My Receipt - ATF Form 4 (2026).pdf",
    );
  });

  test("preserves non-ASCII characters (the serving route encodes them per RFC 6266)", () => {
    expect(sanitizeFilename("récu.pdf")).toBe("récu.pdf");
    expect(sanitizeFilename("領収書.pdf")).toBe("領収書.pdf");
  });

  test("falls back to 'document' when nothing usable remains", () => {
    expect(sanitizeFilename("///")).toBe("document");
    expect(sanitizeFilename("\r\n\t")).toBe("document");
    expect(sanitizeFilename("")).toBe("document");
    expect(sanitizeFilename("   ")).toBe("document");
  });

  test("length-caps an over-long name, preserving a short trailing extension", () => {
    const long = `${"a".repeat(500)}.pdf`;
    const out = sanitizeFilename(long);
    expect(out.length).toBe(200);
    expect(out.endsWith(".pdf")).toBe(true);
  });

  test("length-caps an over-long name with no usable extension by truncation", () => {
    const long = "b".repeat(500);
    const out = sanitizeFilename(long);
    expect(out.length).toBe(200);
    expect(out).toBe("b".repeat(200));
  });

  test("leaves a name at the cap unchanged", () => {
    const exact = "c".repeat(200);
    expect(sanitizeFilename(exact)).toBe(exact);
  });

  test("truncates by code point, never splitting a surrogate pair (astral chars)", () => {
    // Each emoji below is an astral character (2 UTF-16 code units), so a
    // naive `.slice(0, 200)` truncation would land mid-boundary and produce a
    // lone surrogate. 300 emoji comfortably straddles the 200 code-point cap.
    const emoji = "😀".repeat(300);
    const out = sanitizeFilename(emoji);
    expect(out).toBe([...out].join(""));
    expect(out).not.toContain("�");
    expect([...out].length).toBeLessThanOrEqual(200);
    expect([...out].length).toBeGreaterThan(0);
  });

  test("truncates by code point with an extension, keeping both halves intact", () => {
    const long = `${"😀".repeat(300)}.pdf`;
    const out = sanitizeFilename(long);
    expect(out).toBe([...out].join(""));
    expect(out).not.toContain("�");
    expect([...out].length).toBeLessThanOrEqual(200);
    expect(out.endsWith(".pdf")).toBe(true);
  });
});
