/**
 * Domain validation failure. Carries ALL failure codes at once (R20) so the UI
 * can surface every problem in one pass. Thrown before any store write (R21).
 */
export class ValidationError extends Error {
  readonly codes: string[];
  constructor(codes: string[]) {
    super(`validation failed: ${codes.join(", ")}`);
    this.name = "ValidationError";
    this.codes = codes;
  }
}
