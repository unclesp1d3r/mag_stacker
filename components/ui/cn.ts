import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge class names the idiomatic shadcn/Tailwind way: `clsx` resolves
 * conditionals/arrays/objects, then `tailwind-merge` de-dupes conflicting
 * Tailwind utilities (last wins). Backward-compatible with the previous
 * string/false/null/undefined call sites. shadcn-generated components import
 * `cn` from here (see `components.json` `aliases.utils`).
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
