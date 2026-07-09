import type { ReactNode } from "react";
import { cn } from "./cn";

export function Spinner({ className }: { className?: string }) {
  // Decorative: always rendered alongside status text (e.g. "Signing in…").
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent",
        className,
      )}
    />
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-input bg-muted/50 px-6 py-16 text-center">
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      {description ? (
        <p className="max-w-sm text-sm text-ink-soft">{description}</p>
      ) : null}
      {action}
    </div>
  );
}

type Tone = "neutral" | "primary" | "ok" | "destructive";
const TONES: Record<Tone, string> = {
  neutral: "bg-muted text-ink-soft border-input",
  primary: "bg-accent text-accent-foreground border-primary/30",
  ok: "bg-[var(--ok)]/12 text-[var(--ok)] border-[var(--ok)]/30",
  destructive: "bg-danger-soft text-destructive border-destructive/30",
};

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: Tone;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
        TONES[tone],
      )}
    >
      {children}
    </span>
  );
}

export function Callout({
  tone = "destructive",
  id,
  children,
}: {
  tone?: Tone;
  /** Optional id so the callout can be referenced via aria-describedby. */
  id?: string;
  children: ReactNode;
}) {
  return (
    <div
      id={id}
      className={cn("rounded-md border px-3 py-2 text-sm", TONES[tone])}
      role="alert"
    >
      {children}
    </div>
  );
}
