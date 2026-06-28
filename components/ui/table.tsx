import type { HTMLAttributes, ReactNode, ThHTMLAttributes } from "react";
import { cn } from "./cn";

export function DataTable({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-line bg-paper-raised shadow-[var(--shadow-raised)]">
      <table
        className={cn("w-full border-collapse text-sm", className)}
        {...props}
      >
        {children}
      </table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return (
    <thead className="border-b border-line-strong bg-paper-sunken">
      <tr>{children}</tr>
    </thead>
  );
}

export function TH({
  className,
  children,
  ...props
}: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn(
        "px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-ink-soft",
        className,
      )}
      {...props}
    >
      {children}
    </th>
  );
}

export function TRow({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn(
        "border-b border-line last:border-0 transition-colors hover:bg-blaze-soft/30",
        className,
      )}
      {...props}
    >
      {children}
    </tr>
  );
}

export function TD({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={cn("px-4 py-2.5 align-middle text-ink", className)}
      {...props}
    >
      {children}
    </td>
  );
}
