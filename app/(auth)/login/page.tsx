import { Suspense } from "react";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-4">
      <section
        aria-labelledby="login-heading"
        className="w-full max-w-sm rounded-[var(--radius-lg)] border border-line bg-paper-raised p-7 shadow-[var(--shadow-pop)]"
      >
        <div className="mb-6">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-blaze">
            MagStacker
          </p>
          <h1
            id="login-heading"
            className="mt-2 text-xl font-semibold tracking-tight text-ink"
          >
            Sign in to your inventory
          </h1>
          <p className="mt-1 text-sm text-ink-soft">
            Accounts are created by your operator. There is no public sign-up.
          </p>
        </div>
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </section>
    </main>
  );
}
