import type { ReactNode } from "react";
import { Kicker } from "./typography";

/**
 * The read-only label/value row shared by every detail view.
 *
 * This was defined four times over, byte-identical, in the firearm, magazine,
 * ammo, and accessory detail views — so a change to the label treatment had to
 * be made four times or it drifted. The label now goes through `<Kicker>`,
 * which is what put these rows in line with the Mono-Label Rule.
 *
 * Renders `dt`/`dd`, so the caller supplies the wrapping `<dl>`.
 */
export function DetailRow({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-border py-2 last:border-b-0 sm:flex-row sm:gap-4">
      <Kicker as="dt" className="w-40 shrink-0 pt-0.5">
        {label}
      </Kicker>
      <dd className="min-w-0 wrap-break-word text-sm text-foreground">
        {value}
      </dd>
    </div>
  );
}

/** An empty value reads as a muted em dash, never as a blank cell. */
export function orDash(value: string): ReactNode {
  return value.trim() !== "" ? (
    value
  ) : (
    <span className="text-muted-foreground">—</span>
  );
}
