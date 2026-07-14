import type { RestoreOutcome } from "@/src/backup/restore-service";

/**
 * Admin backup UI constants (plan Unit U7, R6/R7/R12).
 */

/**
 * The exact type-to-confirm phrase gating force-replace restore (R7/AE2). The
 * operator must type this literally — no case-insensitive or partial match —
 * before the confirm control in the force-replace dialog enables. A fixed
 * sentinel (rather than the instance hostname the plan floats as an
 * alternative) keeps this simple and works identically across every
 * self-hosted deployment, with no dependency on an "instance identity"
 * concept this app doesn't otherwise have.
 */
export const FORCE_REPLACE_PHRASE = "REPLACE ALL DATA";

/**
 * Distinct, actionable copy for each of U6's discriminated restore outcomes
 * (R6/R7/R9/AE1-AE4) plus a client-side fallback for a network/parse failure
 * the route itself can't produce. Keyed by `RestoreOutcome["kind"]` so a new
 * outcome kind fails to compile here until this map is updated.
 */
export const RESTORE_OUTCOME_COPY: Record<
  RestoreOutcome["kind"],
  { readonly title: string; readonly detail: string }
> = {
  ok: {
    title: "Instance restored",
    detail: "Please sign in again.",
  },
  refused_not_empty: {
    title: "Restore refused — instance is not empty",
    detail:
      "This instance already holds inventory data. Use force-replace below to wipe it and apply this backup.",
  },
  wrong_password_or_tampered: {
    title: "Restore refused — could not authenticate the backup",
    detail:
      "Check the password, or the bundle may be corrupt or tampered with. No data was changed.",
  },
  version_mismatch: {
    title: "Restore refused — incompatible backup version",
    detail:
      "This bundle was produced by an incompatible version of MagStacker and cannot be restored here. No data was changed.",
  },
  rolled_back: {
    title: "Restore failed — rolled back",
    detail:
      "The force-replace restore failed partway through and your previous data was automatically rolled back. No data was lost.",
  },
};

/** Shown when the request itself fails (network error, unexpected status, or
 * a non-JSON response) — a case U6's `RestoreOutcome` union doesn't model. */
export const RESTORE_UNEXPECTED_ERROR = {
  title: "Restore failed unexpectedly",
  detail: "Please try again. No confirmation of a data change was received.",
} as const;
