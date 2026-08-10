import type { ReactNode } from "react";

/**
 * How a firearm's magazine count renders (#37 R6/R7/R8).
 *
 * A firearm that does not take detachable magazines — a revolver, a
 * break-action, a tube-fed lever gun — shows a muted em dash rather than `0`,
 * because `0` reads as *you are missing magazines* rather than *this gun does
 * not take any*.
 *
 * Keyed off the flag, NEVER off `count === 0` (R9): a magazine-fed firearm
 * that genuinely has no magazines yet still shows `0`, and that distinction is
 * the whole point of the feature.
 *
 * Shared by the firearms table, the firearm detail view, and the summary
 * per-firearm table so all three can never disagree about the same firearm.
 *
 * The caller supplies the already-rendered count rather than a bare number, so
 * each surface keeps the numeric treatment it already had — the two tables
 * render a plain number like their sibling numeric columns, while the detail
 * view keeps its `<Data>` mono/tabular span. Rendering the number here would
 * silently restyle every magazine-fed row.
 */
export function magazineCountValue(
  isMagazineFed: boolean,
  count: ReactNode,
): ReactNode {
  if (!isMagazineFed) {
    return <span className="text-muted-foreground">—</span>;
  }
  return count;
}
