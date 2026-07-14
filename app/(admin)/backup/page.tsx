import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/surface";
import { getCurrentUser } from "@/src/auth/session";
import { BackupPanel } from "./backup-panel";

/**
 * Admin backup screen (plan Unit U7, R1/R5/R14). The `(admin)` layout already
 * gates non-admins (redirecting to `/magazines`), but this page re-asserts the
 * same check as defense-in-depth (KTD6's convention — every admin surface
 * re-checks, not just the layout), matching how U6's routes re-assert admin
 * even though the layout and the route both gate independently.
 */
export default async function BackupPage() {
  const user = await getCurrentUser();
  if (user?.role !== "admin") redirect("/magazines");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Backup"
        description="Export an encrypted, whole-instance backup or restore from one. Admin-only."
      />
      <BackupPanel />
    </div>
  );
}
