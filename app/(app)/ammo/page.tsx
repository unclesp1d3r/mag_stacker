import { redirect } from "next/navigation";
import { getCurrentUser } from "@/src/auth/session";
import { db } from "@/src/db/client";
import { listAmmo } from "@/src/domain/ammo/service";
import { calibersForInput } from "@/src/domain/reference/reference";
import { type AmmoListItem, AmmoView } from "./ammo-view";

export default async function AmmoPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [lots, caliberSuggestions] = await Promise.all([
    listAmmo(user.id),
    calibersForInput(db, user.id),
  ]);

  const items: AmmoListItem[] = lots.map((a) => ({
    id: a.id,
    ownerId: a.ownerId,
    brand: a.brand,
    caliber: a.caliber,
    type: a.type,
    grain: a.grain,
    quantityRounds: a.quantityRounds,
    lowStockThreshold: a.lowStockThreshold,
    acquiredDate: a.acquiredDate,
    notes: a.notes,
  }));

  return (
    <div className="space-y-6">
      <AmmoView
        ammo={items}
        currentUserId={user.id}
        caliberSuggestions={caliberSuggestions}
      />
    </div>
  );
}
