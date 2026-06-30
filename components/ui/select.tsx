import type { SelectHTMLAttributes } from "react";
import { cn } from "./cn";

export function Select({
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-10 w-full appearance-none rounded-[var(--radius)] border border-line-strong bg-paper-raised",
        "px-3 pr-9 text-sm text-ink transition-colors hover:border-ink-faint focus:border-blaze",
        "bg-[length:1rem] bg-[right_0.65rem_center] bg-no-repeat",
        "bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22 fill=%22none%22 stroke=%22%23999%22 stroke-width=%221.5%22><path d=%22M4 6l4 4 4-4%22/></svg>')]",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}
