/**
 * Firearm display-label resolution (#18). Pure — no DB, no React.
 *
 * A firearm carries a required canonical product `name` and an optional owner
 * `nickname`. The nickname is the primary label the owner sees when present;
 * otherwise the product name stands alone. "Present" means non-empty after
 * trimming, but the raw (untrimmed) nickname is what gets returned/displayed,
 * matching how the record persists values verbatim (R18/R19).
 */

export interface FirearmNameFields {
  name: string;
  nickname: string;
}

/** The primary label: the nickname when present, else the product name. */
export function firearmDisplayName(f: FirearmNameFields): string {
  return f.nickname.trim() !== "" ? f.nickname : f.name;
}

/**
 * Whether a firearm has a usable nickname. Uses the same trimmed test as
 * `firearmDisplayName` so a row's secondary line and its primary label can
 * never disagree about presence (a whitespace-only nickname is "no nickname").
 */
export function hasNickname(f: { nickname: string }): boolean {
  return f.nickname.trim() !== "";
}
