import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

export function Card({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-lg)] border border-line bg-paper-raised p-5 shadow-[var(--shadow-raised)]",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          {title}
        </h1>
        {description ? (
          <p className="text-sm text-ink-soft">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex items-center gap-2">{actions}</div>
      ) : null}
    </header>
  );
}

export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-line bg-paper-raised p-5 shadow-[var(--shadow-raised)]">
      <div className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
        {label}
      </div>
      <div className="mt-1 text-3xl font-semibold tabular text-ink">
        {value}
      </div>
    </div>
  );
}
