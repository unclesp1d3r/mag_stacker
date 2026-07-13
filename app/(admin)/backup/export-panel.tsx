"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Callout, Spinner } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/surface";
import { MIN_BACKUP_PASSWORD_LENGTH } from "@/src/backup/password-policy";

/**
 * Export panel (plan Unit U7, R1/R3/R4/R12/R13).
 *
 * The download is a real `<form method="POST" action="/api/admin/backup/export">`
 * submit — deliberately NOT a client-side `fetch()` + blob, which would
 * re-buffer a GB-scale bundle in the browser and undercut the export route's
 * R13 streaming guarantee. Submitting the form is a navigation-triggered
 * request: when the response carries `Content-Disposition: attachment` (which
 * it always does here), the browser downloads the file and the current page
 * is never actually unloaded/replaced — so the in-page pending/success state
 * below stays intact for the whole flow. The one edge case this trades away is
 * a genuine 401/403/500 from the route, which (having no attachment
 * disposition) WOULD navigate the tab to a raw response — client-side
 * validation below (password required, confirm match, warning acknowledged)
 * keeps every reachable submission a 200, so that path is not expected in
 * practice.
 */

const NO_RECOVERY_WARNING =
  "There is no password recovery. If this password is lost, this backup cannot be decrypted — by anyone, ever. Store it somewhere safe before you continue.";

/** How long after submit to optimistically report the download as started.
 * There's no JS completion signal for a plain form-triggered download; by
 * this point the browser has received headers and begun streaming the
 * response to disk even for a very large bundle (streaming starts
 * immediately server-side), so "started" is an honest claim at this delay. */
const ASSUME_STARTED_MS = 1200;

export interface ExportGateState {
  readonly password: string;
  readonly confirmPassword: string;
  readonly acknowledged: boolean;
  readonly pending: boolean;
}

/**
 * Whether the export trigger should be enabled (hardening pass, mirrors
 * `MIN_BACKUP_PASSWORD_LENGTH`/`readPassword` in the export route): the
 * password meets the minimum length, both password fields match, the
 * no-recovery warning is acknowledged, and no export has been submitted yet
 * this session (`pending` covers the whole "pending" → "started" lifetime,
 * not just the brief pre-navigation window — see `status` in `ExportPanel`).
 * A genuine full-instance export streams for as long as the underlying data
 * takes; there's no client-visible completion signal, so the only safe gate
 * is "has this view already fired one," not a timer. Exported as a pure
 * function so the exact gating logic backing the rendered button's
 * `disabled` state is unit-testable without a DOM.
 */
export function canExportBackup(state: ExportGateState): boolean {
  const passwordLongEnough =
    state.password.length >= MIN_BACKUP_PASSWORD_LENGTH;
  const passwordsMatch =
    state.password.length > 0 && state.password === state.confirmPassword;
  return (
    passwordLongEnough && passwordsMatch && state.acknowledged && !state.pending
  );
}

export function ExportPanel() {
  const passwordId = useId();
  const confirmId = useId();
  const acknowledgeId = useId();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [status, setStatus] = useState<"idle" | "pending" | "started">("idle");

  const passwordLongEnough = password.length >= MIN_BACKUP_PASSWORD_LENGTH;
  const passwordsMatch = password.length > 0 && password === confirmPassword;
  // Anything past "idle" means this view has already fired a submission —
  // the "started" state (reached ASSUME_STARTED_MS after submit, purely to
  // update the readout) must NOT re-enable the button, or an admin can fire
  // a second full-instance encrypted export while the first is still
  // streaming server-side (review finding: duplicate concurrent export).
  const alreadySubmitted = status !== "idle";
  const canExport = canExportBackup({
    password,
    confirmPassword,
    acknowledged,
    pending: alreadySubmitted,
  });

  function onSubmit() {
    if (!canExport) return;
    setStatus("pending");
    // The native form submission proceeds after this handler returns (no
    // preventDefault) — this just drives the in-page status readout. Status
    // never returns to "idle" afterward, so `canExport` above stays false
    // for the rest of this view's lifetime (a page reload is required to
    // export again), which is the intended one-export-per-view guard.
    window.setTimeout(() => setStatus("started"), ASSUME_STARTED_MS);
  }

  return (
    <Card>
      <h2 className="text-sm font-semibold text-foreground">Export a backup</h2>
      <p className="mt-1 mb-4 text-xs text-ink-soft">
        Downloads one encrypted file containing the entire instance — every
        user, grant, and inventory item, including firearm documents.
      </p>

      <Callout tone="destructive">{NO_RECOVERY_WARNING}</Callout>

      <form
        method="POST"
        action="/api/admin/backup/export"
        onSubmit={onSubmit}
        className="mt-4 flex flex-col gap-3"
        noValidate
      >
        <Field
          label="Export password"
          controlId={passwordId}
          required
          hint={`At least ${MIN_BACKUP_PASSWORD_LENGTH} characters.`}
          error={
            password.length > 0 && !passwordLongEnough
              ? `Password must be at least ${MIN_BACKUP_PASSWORD_LENGTH} characters.`
              : undefined
          }
        >
          <Input
            id={passwordId}
            name="password"
            type="password"
            autoComplete="new-password"
            required
            aria-invalid={password.length > 0 && !passwordLongEnough}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        <Field
          label="Confirm password"
          controlId={confirmId}
          required
          error={
            confirmPassword.length > 0 && !passwordsMatch
              ? "Passwords don't match."
              : undefined
          }
        >
          <Input
            id={confirmId}
            type="password"
            autoComplete="new-password"
            required
            aria-invalid={confirmPassword.length > 0 && !passwordsMatch}
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
          />
        </Field>

        <label
          htmlFor={acknowledgeId}
          className="flex items-start gap-2 text-sm text-foreground"
        >
          <input
            id={acknowledgeId}
            type="checkbox"
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
            className="mt-0.5 size-4 accent-primary"
          />
          <span>
            I understand this backup cannot be recovered without this password.
          </span>
        </label>

        <p aria-live="polite" className="text-xs text-muted-foreground">
          {status === "pending" ? "Preparing your download…" : ""}
        </p>
        {status === "started" ? (
          <Callout tone="ok">
            Export started — check your browser's downloads.
          </Callout>
        ) : null}

        <Button type="submit" disabled={!canExport}>
          {status === "pending" ? <Spinner /> : null}
          {status === "pending" ? "Preparing…" : "Export backup"}
        </Button>
      </form>
    </Card>
  );
}
