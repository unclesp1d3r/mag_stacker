import { notFound, redirect } from "next/navigation";
import { NotFoundError } from "@/src/auth/errors";
import { getCurrentUser } from "@/src/auth/session";
import { db } from "@/src/db/client";
import { getAmmo } from "@/src/domain/ammo/service";
import { calibersForInput } from "@/src/domain/reference/reference";
import { isUuid } from "@/src/lib/uuid";
import { AmmoDetailView } from "../ammo-detail-view";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function AmmoDetailPage({ params }: PageProps) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  // A malformed id can match no record and would raise a uuid-cast error on the
  // query — treat it as not-found at the boundary (R9).
  if (!isUuid(id)) notFound();

  // getAmmo resolves the viewer's permission and throws NotFoundError for a lot
  // that is not owned or shared — the not-found path never reveals existence
  // (R9). It returns the permission so we don't re-resolve it.
  const { ammo: row, permission } = await getAmmo(user.id, id).catch(
    (error: unknown) => {
      if (error instanceof NotFoundError) notFound();
      throw error;
    },
  );

  const caliberSuggestions = await calibersForInput(db, user.id);

  return (
    <AmmoDetailView
      ammo={{
        id: row.id,
        brand: row.brand,
        caliber: row.caliber,
        type: row.type,
        grain: String(row.grain),
        quantityRounds: String(row.quantityRounds),
        lowStockThreshold: String(row.lowStockThreshold),
        acquiredDate: row.acquiredDate ?? "",
        notes: row.notes,
      }}
      permission={permission}
      caliberSuggestions={caliberSuggestions}
    />
  );
}
