import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/surface";
import { getCurrentUser } from "@/src/auth/session";
import { db } from "@/src/db/client";
import { listAmmo } from "@/src/domain/ammo/service";
import { calibersForInput } from "@/src/domain/reference/reference";
import { type AmmoListItem, AmmoView } from "./ammo-view";
import { ExportButton } from "./export-button";

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

  // Export only makes sense once there's inventory, mirroring the magazines
  // page: the cold-start empty state carries the one path forward alone.
  const showControls = items.length > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ammo"
        description="Track rounds on hand and low-stock alerts."
        actions={showControls ? <ExportButton /> : undefined}
      />
      <AmmoView
        ammo={items}
        currentUserId={user.id}
        caliberSuggestions={caliberSuggestions}
      />
    </div>
  );
}
