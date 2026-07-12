"use client";

import type { ChangeEvent, FormEvent } from "react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Callout, Spinner } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/surface";
import { signOut } from "@/lib/auth-client";
import type { RestoreOutcome } from "@/src/backup/restore-service";
import {
  FORCE_REPLACE_PHRASE,
  RESTORE_OUTCOME_COPY,
  RESTORE_UNEXPECTED_ERROR,
} from "./constants";

/**
 * Restore panel (plan Unit U7, R5/R6/R7/R9/R10, AE1-AE4).
 *
 * The upload is sent as the raw request body via `fetch()` — the bundle file
 * itself is passed as `body` (a `File`, which the browser streams from disk
 * without the JS heap materializing it, R13), with the password and
 * force-replace intent carried in headers (`X-Backup-Password`,
 * `X-Backup-Force`) so the body stays exactly the encrypted bytes, matching
 * U6's route contract.
 */

/** How long a restore runs before the progress label switches from
 * "verifying" to "applying" (R7/U7: "so a static screen can't be mistaken for
 * a hang"). The route's single JSON response gives no real intermediate
 * progress, so this is a readable approximation, not a literal signal. */
const ASSUME_APPLYING_AFTER_MS = 4000;

type Phase = "idle" | "verifying" | "applying";

/** `RestoreOutcome` plus a client-only kind for a request that never got a
 * discriminated response at all (network failure, non-JSON body). */
type DisplayOutcome =
  | RestoreOutcome
  | { readonly kind: "client_error"; readonly message: string };

async function postRestore(
  file: File,
  password: string,
  force: boolean,
): Promise<DisplayOutcome> {
  try {
    const response = await fetch("/api/admin/backup/restore", {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Backup-Password": password,
        ...(force ? { "X-Backup-Force": "true" } : {}),
      },
      body: file,
    });
    const body = (await response.json()) as {
      outcome?: string;
      message?: string;
    };
    if (!body.outcome) {
      return { kind: "client_error", message: "Malformed response." };
    }
    return {
      kind: body.outcome,
      message: body.message ?? "",
    } as DisplayOutcome;
  } catch (error) {
    return {
      kind: "client_error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export function RestorePanel() {
  const fileInputId = useId();
  const passwordId = useId();
  const phraseId = useId();

  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [outcome, setOutcome] = useState<DisplayOutcome | null>(null);
  const [forceDialogOpen, setForceDialogOpen] = useState(false);
  const [forcePhrase, setForcePhrase] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  const applyingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (applyingTimer.current) clearTimeout(applyingTimer.current);
    },
    [],
  );

  const restoring = phase !== "idle";
  const canSubmit = file !== null && password.length > 0 && !restoring;

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    setFile(event.currentTarget.files?.[0] ?? null);
  }

  async function runRestore(force: boolean) {
    if (!file) return;
    setOutcome(null);
    setPhase("verifying");
    applyingTimer.current = setTimeout(
      () => setPhase("applying"),
      ASSUME_APPLYING_AFTER_MS,
    );

    const result = await postRestore(file, password, force);

    if (applyingTimer.current) clearTimeout(applyingTimer.current);
    setPhase("idle");
    setForceDialogOpen(false);

    if (result.kind === "ok") {
      await handleSuccessfulRestore();
      return;
    }
    setOutcome(result);
  }

  async function handleSuccessfulRestore() {
    setSigningOut(true);
    // The users table (including the acting admin's own row) was just
    // replaced (R10), so the current session is no longer trustworthy —
    // best-effort clear it, then hard-navigate so no stale client state
    // survives. signOut() may itself fail if the session row is already
    // gone; that's fine, the redirect below still happens.
    try {
      await signOut();
    } catch {
      // Ignored — proceeding to the hard redirect regardless.
    }
    window.location.assign("/login?restored=1");
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runRestore(false);
  }

  function onConfirmForce() {
    void runRestore(true);
  }

  const isRefusedNotEmpty = outcome?.kind === "refused_not_empty";
  const phraseMatches = forcePhrase === FORCE_REPLACE_PHRASE;

  return (
    <Card>
      <h2 className="text-sm font-semibold text-foreground">
        Restore from a backup
      </h2>
      <p className="mt-1 mb-4 text-xs text-ink-soft">
        Upload an encrypted backup file and its password. A plain restore only
        applies to an empty instance — force-replace is required to overwrite
        existing data.
      </p>

      <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
        <Field label="Backup file" controlId={fileInputId} required>
          <input
            id={fileInputId}
            type="file"
            required
            disabled={restoring}
            onChange={onFileChange}
            className="block w-full text-sm text-foreground file:mr-3 file:h-8 file:cursor-pointer file:rounded-md file:border-0 file:bg-primary file:px-3 file:text-sm file:font-medium file:text-primary-foreground file:transition-[filter] hover:file:brightness-105 disabled:cursor-not-allowed disabled:opacity-55"
          />
        </Field>
        <Field label="Restore password" controlId={passwordId} required>
          <Input
            id={passwordId}
            type="password"
            autoComplete="current-password"
            required
            disabled={restoring}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>

        <p
          aria-live="polite"
          role="status"
          className="text-xs text-muted-foreground"
        >
          {phase === "verifying" ? "Verifying backup…" : ""}
          {phase === "applying"
            ? "Applying changes — this can take a while for large backups. Do not close this window."
            : ""}
        </p>

        {outcome && outcome.kind !== "ok" ? (
          <Callout tone={isRefusedNotEmpty ? "neutral" : "destructive"}>
            <p className="font-medium">
              {outcome.kind === "client_error"
                ? RESTORE_UNEXPECTED_ERROR.title
                : RESTORE_OUTCOME_COPY[outcome.kind].title}
            </p>
            <p className="mt-0.5">
              {outcome.kind === "client_error"
                ? RESTORE_UNEXPECTED_ERROR.detail
                : RESTORE_OUTCOME_COPY[outcome.kind].detail}
            </p>
          </Callout>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={!canSubmit}>
            {restoring ? <Spinner /> : null}
            {restoring ? "Restoring…" : "Restore"}
          </Button>
          {isRefusedNotEmpty ? (
            <Button
              type="button"
              variant="destructive"
              disabled={restoring}
              onClick={() => {
                setForcePhrase("");
                setForceDialogOpen(true);
              }}
            >
              Force replace…
            </Button>
          ) : null}
        </div>
      </form>

      {signingOut ? (
        <p role="status" className="mt-3 text-sm text-ink-soft">
          Instance restored — please sign in.
        </p>
      ) : null}

      <ConfirmDialog
        open={forceDialogOpen}
        title="Force-replace all data?"
        description={
          <span className="flex flex-col gap-2">
            <span>
              This permanently deletes every user, grant, and inventory item
              currently on this instance and replaces them with the uploaded
              backup. This cannot be undone.
            </span>
            <span>
              Type <strong className="font-mono">{FORCE_REPLACE_PHRASE}</strong>{" "}
              to confirm.
            </span>
            <Input
              aria-label={`Type ${FORCE_REPLACE_PHRASE} to confirm`}
              id={phraseId}
              autoComplete="off"
              value={forcePhrase}
              disabled={restoring}
              onChange={(event) => setForcePhrase(event.target.value)}
            />
          </span>
        }
        confirmLabel="Force replace"
        pending={restoring}
        pendingLabel="Restoring…"
        confirmDisabled={!phraseMatches}
        onConfirm={onConfirmForce}
        onCancel={() => setForceDialogOpen(false)}
      />
    </Card>
  );
}
