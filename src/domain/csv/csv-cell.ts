/**
 * Shared CSV cell escaping (parity §9 + dotnet-extensions §1). Pure — no DB,
 * no Next. Single source of truth for the formula-injection guard used by
 * every CSV export surface; a future change to the prefix set or quoting
 * rules must apply to all exports at once.
 */

// Characters that, as a cell's first char, trigger the formula-injection guard.
const INJECTION_PREFIXES = new Set(["=", "+", "-", "@", "\t", "\r"]);

export function guardAndQuote(value: string): string {
  let v = value;
  if (v.length > 0 && INJECTION_PREFIXES.has(v[0])) {
    v = `'${v}`; // apostrophe first (dotnet-extensions §1)
  }
  if (/[",\r\n]/.test(v)) {
    v = `"${v.replace(/"/g, '""')}"`; // RFC-4180 quote with doubled quotes
  }
  return v;
}

export function toRecord(cells: string[]): string {
  return cells.map(guardAndQuote).join(",");
}
