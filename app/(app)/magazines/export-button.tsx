"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/feedback";
import { useToast } from "@/components/ui/toast";

const DEFAULT_FILENAME = "magstacker-inventory.csv";

/**
 * Triggers the CSV download via the export Route Handler (U15, F6). Shows an
 * in-flight state and a non-leaking error message on failure (R48).
 */
export function ExportButton() {
  const { toast } = useToast();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onExport() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/export");
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
      toast({ message: "Inventory exported", detail: DEFAULT_FILENAME });
    } catch {
      setError("Could not export. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {error ? (
        <span role="alert" className="text-xs font-medium text-danger">
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
