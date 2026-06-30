import { getCurrentUser } from "@/src/auth/session";
import { buildInventoryCsv } from "@/src/domain/csv/build";

/**
 * CSV download (U8, ADR-0006, KTD-2). Sits at `/api/export` (covered by the
 * proxy matcher) and re-resolves the session in-handler — the real
 * authorization boundary (R66). Unauthenticated requests get 401 with no body.
 */
export async function GET(): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const csv = await buildInventoryCsv(user.id);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="magstacker-inventory.csv"',
    },
  });
}
