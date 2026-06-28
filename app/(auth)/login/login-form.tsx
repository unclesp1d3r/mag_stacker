"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Callout, Spinner } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { signIn } from "@/lib/auth-client";

/**
 * Email+password sign-in (U13, F1). Wrong credentials show an inline error that
 * does not reveal which field was wrong; a rate-limited attempt (429) shows a
 * distinct throttle message (R7a). No public sign-up control is presented (R7).
 */
export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const redirectTo = params.get("redirectTo") || "/magazines";
  const emailId = useId();
  const passwordId = useId();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return; // double-submit guard
    submitting.current = true;
    setPending(true);
    setError(null);

    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "");
    const password = String(data.get("password") ?? "");

    await signIn.email(
      { email, password },
      {
        onSuccess: () => {
          router.push(redirectTo);
          router.refresh();
        },
        onError: (ctx) => {
          setError(
            ctx.response?.status === 429
              ? "Too many attempts. Please wait a moment and try again."
              : "Incorrect email or password.",
          );
          setPending(false);
          submitting.current = false;
        },
      },
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      {error ? <Callout tone="danger">{error}</Callout> : null}
      <Field label="Email" controlId={emailId} required>
        <Input
          id={emailId}
          name="email"
          type="email"
          autoComplete="username"
          required
          aria-invalid={!!error}
        />
      </Field>
      <Field label="Password" controlId={passwordId} required>
        <Input
          id={passwordId}
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={!!error}
        />
      </Field>
      <Button type="submit" disabled={pending} className="mt-1 w-full">
        {pending ? <Spinner /> : null}
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
