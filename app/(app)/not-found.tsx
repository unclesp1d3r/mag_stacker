import Link from "next/link";
import { PageHeader } from "@/components/ui/surface";

/**
 * Shared 404 for the (app) segment — rendered when a detail route calls
 * `notFound()` because the record does not exist or is not shared with the
 * viewer (R9). Accessible heading + keyboard-reachable links back (R16).
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
          className="font-medium text-blaze hover:underline"
        >
          ← Firearms
        </Link>
        <Link
          href="/magazines"
          className="font-medium text-blaze hover:underline"
        >
          ← Magazines
        </Link>
      </nav>
    </div>
  );
}
