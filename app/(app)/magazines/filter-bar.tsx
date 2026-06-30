"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { FirearmOption } from "./magazine-form";

const DEBOUNCE_MS = 250;

interface FilterBarProps {
  calibers: string[];
  firearmOptions: FirearmOption[];
}

export function FilterBar({ calibers, firearmOptions }: FilterBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const searchId = useId();
  const caliberId = useId();
  const firearmId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(params.get("q") ?? "");

  const pushParam = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params.toString());
      if (value) next.set(key, value);
      else next.delete(key);
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [params, pathname, router],
  );

  // Debounce the brand/model search before issuing the query (R71).
  useEffect(() => {
    const current = params.get("q") ?? "";
    if (query === current) return;
    const handle = setTimeout(() => pushParam("q", query), DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query, params, pushParam]);

  // Keyboard accelerator: "/" focuses the search box when no input is focused.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "/") return;
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      event.preventDefault();
      searchRef.current?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-[var(--radius-lg)] border border-line bg-paper-raised p-3">
      <div className="min-w-48 flex-1">
        <label
          htmlFor={searchId}
          className="mb-1 block text-xs font-medium text-ink-soft"
        >
          Search brand / model <span className="text-ink-faint">( / )</span>
        </label>
        <Input
          id={searchId}
          ref={searchRef}
          placeholder="e.g. PMAG"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="w-40">
        <label
          htmlFor={caliberId}
          className="mb-1 block text-xs font-medium text-ink-soft"
        >
          Caliber
        </label>
        <Select
          id={caliberId}
          value={params.get("caliber") ?? ""}
          onChange={(e) => pushParam("caliber", e.target.value)}
          disabled={calibers.length === 0}
        >
          <option value="">All calibers</option>
          {calibers.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
      </div>
      <div className="w-48">
        <label
          htmlFor={firearmId}
          className="mb-1 block text-xs font-medium text-ink-soft"
        >
          Compatible firearm
        </label>
        <Select
          id={firearmId}
          value={params.get("firearm") ?? ""}
          onChange={(e) => pushParam("firearm", e.target.value)}
        >
          <option value="">Any firearm</option>
          {firearmOptions.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
              {f.hint ? ` (${f.hint})` : ""}
            </option>
          ))}
        </Select>
      </div>
    </div>
  );
}
