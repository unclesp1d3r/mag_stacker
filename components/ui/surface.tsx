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
    <header className="relative flex flex-wrap items-end justify-between gap-4 border-b border-line pb-4 before:absolute before:bottom-[-1px] before:left-0 before:h-0.5 before:w-12 before:bg-blaze before:content-['']">
      <div className="space-y-1">
        <h1 className="text-pretty text-[1.75rem] font-bold leading-none tracking-[-0.02em] text-ink">
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
    <div className="relative overflow-hidden rounded-[var(--radius-lg)] border border-line bg-paper-raised p-5 shadow-[var(--shadow-raised)] before:absolute before:left-5 before:top-0 before:h-0.5 before:w-3.5 before:bg-blaze before:content-['']">
      <div className="font-mono text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-ink-faint">
        {label}
      </div>
      <div className="mt-1.5 text-3xl font-semibold tabular text-ink">
        {value}
      </div>
    </div>
  );
}
