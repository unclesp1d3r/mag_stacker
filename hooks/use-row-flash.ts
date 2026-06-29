"use client";

import { useEffect, useRef, useState } from "react";

/** How long the just-touched row stays "lit" (matches @keyframes arm-row). */
const FLASH_MS = 1200;

/**
 * One-shot "armed gauge" row highlight after a create/edit. Returns the id to
 * flash and a trigger; the highlight clears itself, and the timer is cleared on
 * unmount. Pair with `<TRow flash={item.id === flashId}>` and the `arm-row`
 * keyframe in globals.css.
 */
export function useRowFlash() {
  const [flashId, setFlashId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function flash(id: string) {
    setFlashId(id);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setFlashId(null), FLASH_MS);
  }

  return { flashId, flash };
}
