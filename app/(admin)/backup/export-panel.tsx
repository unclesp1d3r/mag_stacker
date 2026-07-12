"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Callout, Spinner } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/surface";

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

export function ExportPanel() {
  const passwordId = useId();
  const confirmId = useId();
  const acknowledgeId = useId();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [status, setStatus] = useState<"idle" | "pending" | "started">("idle");

  const passwordsMatch = password.length > 0 && password === confirmPassword;
  const canExport = passwordsMatch && acknowledged && status !== "pending";

  function onSubmit() {
    if (!canExport) return;
    setStatus("pending");
    // The native form submission proceeds after this handler returns (no
    // preventDefault) — this just drives the in-page status readout.
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
        <Field label="Export password" controlId={passwordId} required>
          <Input
            id={passwordId}
            name="password"
            type="password"
            autoComplete="new-password"
            required
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
