import Link from "next/link";
import { PageHeader } from "@/components/ui/surface";

/**
 * Shared 404 for the (app) segment — rendered when a detail route calls
 * `notFound()` because the record does not exist or is not shared with the
 * viewer (R9). Accessible heading and keyboard-reachable links back; as a
 * full-page notFound() boundary it relies on Next's route announcer rather than
 * the focus-shift the detail views implement for R16.
 */
export default function AppNotFound() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Not found"
        description="This record doesn’t exist, or it isn’t shared with you."
      />
      <nav
        aria-label="Back to inventory"
        className="flex flex-wrap gap-4 text-sm"
      >
        <Link
          href="/firearms"
          className="font-medium text-primary hover:underline"
        >
          ← Firearms
        </Link>
        <Link
          href="/magazines"
          className="font-medium text-primary hover:underline"
        >
          ← Magazines
        </Link>
      </nav>
    </div>
  );
}
