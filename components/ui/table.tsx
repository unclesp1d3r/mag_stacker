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
    <thead className="border-b-2 border-line-strong bg-paper-sunken">
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
        // Stamped mono column label (DESIGN.md "label" role). ink-soft (not
        // ink-faint) keeps headers legible on the sunken surface — AA 4.5:1.
        "px-4 py-3 text-left font-mono text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-ink-soft",
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
  flash = false,
  ...props
}: HTMLAttributes<HTMLTableRowElement> & {
  /** One-shot "armed gauge" highlight after this row was just created/edited. */
  flash?: boolean;
}) {
  return (
    <tr
      data-flash={flash ? "true" : undefined}
      className={cn(
        "border-b border-line transition-colors duration-150 last:border-0 hover:bg-blaze-soft/45",
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
    <td className={cn("px-4 py-3 align-middle text-ink", className)} {...props}>
      {children}
    </td>
  );
}
