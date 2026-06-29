"use client";

import { useEffect, useRef } from "react";

/**
 * A quiet maker's mark for the curious who open devtools (delight: discovery,
 * "personality with a straight face"). Logs once per mount, then nothing.
 */
export function ConsoleSignature() {
  const printed = useRef(false);
  useEffect(() => {
    if (printed.current) return;
    printed.current = true;
    console.log(
      "%cMagStacker%c  field console online · all systems nominal",
      "color:#ffb240;font-weight:700;font-family:ui-monospace,monospace;letter-spacing:0.14em",
      "color:#8a929c;font-family:ui-monospace,monospace",
    );
  }, []);
  return null;
}
