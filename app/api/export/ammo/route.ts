import { getCurrentUser } from "@/src/auth/session";
import { buildAmmoCsv } from "@/src/domain/csv/ammo-build";
import { withRequestContext } from "@/src/lib/logging/entry-context";

/**
 * Ammo CSV download (ammo plan U6, R15). Sits at `/api/export/ammo` and
 * re-resolves the session in-handler — the real authorization boundary
 * (R66), mirroring `/api/export`. Unauthenticated requests get 401 with no
 * body.
 */
export const GET = withRequestContext(
  "export-ammo",
  async (): Promise<Response> => {
    const user = await getCurrentUser();
    if (!user) {
      return new Response("Unauthorized", { status: 401 });
    }

    const csv = await buildAmmoCsv(user.id);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="magstacker-ammo.csv"',
      },
    });
  },
);
