import type { HTMLAttributes } from "react";
import { cn } from "./cn";

/**
 * The two typography rules from DESIGN.md §3, as components rather than class
 * strings that every call site has to remember.
 *
 * Both rules were being broken the same way: by hand-writing an approximation
 * of them. Four detail views each declared their own label row with
 * `uppercase tracking-wide` sans (the Mono-Label Rule says mono), and ~20 sites
 * wrote `className="tabular"` without `font-mono` (the Tabular Rule says both).
 * Neither is catchable by review at a glance, so the fix is structural: name
 * the rules, and let the primitive carry the classes.
 */

/**
 * The Mono-Label Rule — small uppercase kickers and column headers are mono,
 * not tracked sans. The monospace tick is the "machined" tell.
 *
 * `as` covers the handful of semantic contexts kickers appear in: a `dt` in a
 * definition list, an `h3` heading a subsection, or a plain `span`.
 */
export function Kicker({
  as: Component = "span",
  className,
  children,
  ...props
}: HTMLAttributes<HTMLElement> & { as?: "span" | "dt" | "h3" }) {
  return (
    <Component
      className={cn(
        "font-mono text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </Component>
  );
}

/**
 * The Tabular Rule — every number (capacity, count, ordinal, date) is mono with
 * tabular figures. Numbers that don't line up vertically are a defect, not a
 * style choice.
 *
 * DataTable columns marked `meta.numeric` already apply this to the whole cell;
 * `<Data>` is for numbers everywhere else — detail rows, inline counts, meta
 * lines under a heading.
 */
export function Data({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={cn("font-mono tabular", className)} {...props}>
      {children}
    </span>
  );
}
