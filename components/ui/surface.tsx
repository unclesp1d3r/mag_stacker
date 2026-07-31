import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";
import { Data, Kicker } from "./typography";

export function Card({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card p-5 shadow-[var(--shadow-raised)]",
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
    // No accent stripe under the rule. The One Accent Rule reserves the
    // anodized orange for the live control, the current selection, the lit row
    // — "Never use it to decorate a heading, a border stripe, or a background
    // panel."
    // A stripe on every page header is exactly the decorative use that spends
    // the accent's rarity, which is the only thing that makes "lit" read as a
    // signal. The hairline rule alone carries the separation.
    <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-4">
      <div className="space-y-1">
        <h1 className="text-pretty text-[1.75rem] font-bold leading-none tracking-[-0.02em] text-foreground">
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
    // Same One Accent Rule call as PageHeader: the tick above each stat was
    // decoration on a background panel, not a state signal. Tonal layering and
    // the hairline border do the elevation work (DESIGN.md §4, "largely flat").
    <div className="overflow-hidden rounded-lg border border-border bg-card p-5 shadow-[var(--shadow-raised)]">
      <Kicker className="block">{label}</Kicker>
      <Data className="mt-1.5 block text-3xl font-semibold text-foreground">
        {value}
      </Data>
    </div>
  );
}
