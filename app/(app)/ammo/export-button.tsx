"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/feedback";
import { useToast } from "@/components/ui/toast";

const DEFAULT_FILENAME = "magstacker-ammo.csv";

/**
 * Triggers the ammo CSV download via the dedicated export Route Handler (U6,
 * ammo plan KTD5). Mirrors `magazines/export-button.tsx` exactly, pointed at the
 * ammo-specific route rather than the combined inventory export.
 */
export function ExportButton() {
  const { toast } = useToast();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onExport() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/export/ammo");
      if (!response.ok) throw new Error("export failed");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = DEFAULT_FILENAME;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast({ message: "Ammo exported", detail: DEFAULT_FILENAME });
    } catch {
      setError("Could not export. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {error ? (
        <span role="alert" className="text-xs font-medium text-destructive">
          {error}
        </span>
      ) : null}
      <Button variant="secondary" onClick={onExport} disabled={pending}>
        {pending ? <Spinner /> : null}
        {pending ? "Exporting…" : "Export CSV"}
      </Button>
    </div>
  );
}
