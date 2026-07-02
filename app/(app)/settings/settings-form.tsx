"use client";

import { type ChangeEvent, useState, useTransition } from "react";
import { Callout } from "@/components/ui/feedback";
import { updateMagpulModeAction } from "./actions";

interface SettingsFormProps {
  magpulMode: boolean;
}

/**
 * Client-side settings form. Saves changes immediately on toggle via a server
 * action — no submit button required for a single boolean preference.
 * Rolls back the optimistic state and surfaces an error if the action fails.
 */
export function SettingsForm({
  magpulMode: initialMagpulMode,
}: SettingsFormProps) {
  const [magpulMode, setMagpulMode] = useState(initialMagpulMode);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleToggle(e: ChangeEvent<HTMLInputElement>) {
    const enabled = e.target.checked;
    setError(null);
    setMagpulMode(enabled);
    startTransition(async () => {
      try {
        const result = await updateMagpulModeAction(enabled);
        if (!result.ok) {
          setMagpulMode(!enabled);
          setError(result.error ?? "Could not save settings.");
        }
      } catch (err) {
        // Only unexpected transport/RPC failures reach here (the action itself
        // resolves to an ActionResult). Surface it so a real failure leaves a
        // trace instead of vanishing behind the generic message.
        console.error("Failed to update Magpul mode setting", err);
        setMagpulMode(!enabled);
        setError("Could not save settings.");
      }
    });
  }

  return (
    <section aria-labelledby="label-constraints-heading" className="space-y-4">
      <h2
        id="label-constraints-heading"
        className="text-sm font-semibold text-ink"
      >
        Label constraints
      </h2>
      {error ? (
        <Callout id="magpul-mode-error" tone="danger">
          {error}
        </Callout>
      ) : null}
      <label className="flex cursor-pointer items-center gap-3">
        <input
          type="checkbox"
          checked={magpulMode}
          onChange={handleToggle}
          disabled={pending}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "magpul-mode-error" : undefined}
          className="size-4 accent-[var(--blaze)]"
        />
        <span className="text-sm text-ink">
          Magpul mode — enforce PMAG dot-matrix label constraints (A–Z, 0–9,
          hyphen, max 4 characters)
        </span>
      </label>
    </section>
  );
}
