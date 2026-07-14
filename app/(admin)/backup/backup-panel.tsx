"use client";

import { ExportPanel } from "./export-panel";
import { RestorePanel } from "./restore-panel";

/**
 * Admin backup screen (plan Unit U7). Composes the export and restore panels
 * side by side on wide viewports, stacked on narrow ones — mirrors the
 * `/users` admin surface's create-form + table layout.
 */
export function BackupPanel() {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <ExportPanel />
      <RestorePanel />
    </div>
  );
}
