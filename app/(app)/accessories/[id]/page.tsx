import { notFound, redirect } from "next/navigation";
import { NotFoundError } from "@/src/auth/errors";
import { getCurrentUser } from "@/src/auth/session";
import { visibleFirearmPermissions } from "@/src/auth/visibility";
import { db } from "@/src/db/client";
import { costCentsToInputValue } from "@/src/domain/accessories/display";
import { getAccessory } from "@/src/domain/accessories/service";
import { buildFirearmMountContext } from "@/src/domain/firearms/mount-options";
import { listFirearms } from "@/src/domain/firearms/service";
import { isUuid } from "@/src/lib/uuid";
import { AccessoryDetailView } from "../accessory-detail-view";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function AccessoryDetailPage({ params }: PageProps) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  // A malformed id can match no record and would raise a uuid-cast error on the
  // query — treat it as not-found at the boundary (R9).
  if (!isUuid(id)) notFound();

  // getAccessory resolves the viewer's permission and throws NotFoundError for
  // an accessory that is not owned nor mounted on a visible firearm — the
  // not-found path never reveals existence (R9). It returns the permission so
  // we don't re-resolve it.
  const { accessory: row, permission } = await getAccessory(user.id, id).catch(
    (error: unknown) => {
      if (error instanceof NotFoundError) notFound();
      throw error;
    },
  );

  const [firearms, permissions] = await Promise.all([
    listFirearms(user.id),
    visibleFirearmPermissions(db, user.id),
  ]);

  // The reassign-mount picker must offer only firearms owned by the
  // ACCESSORY's owner (`row.ownerId`, not the actor — an edit-grantee acting
  // on someone else's mounted accessory must still only relocate it among
  // that owner's own guns, KTD5's cross-tenant guard) AND editable by the
  // acting user.
  const { firearmNames, editableFirearms } = buildFirearmMountContext(
    firearms,
    permissions,
    row.ownerId,
  );

  return (
    <AccessoryDetailView
      accessory={{
        id: row.id,
        category: row.category,
        brand: row.brand,
        model: row.model,
        serialNumber: row.serialNumber,
        installedDate: row.installedDate ?? "",
        cost: costCentsToInputValue(row.costCents),
        notes: row.notes,
        isNfa: row.isNfa,
        currentFirearmId: row.currentFirearmId,
      }}
      permission={permission}
      editableFirearms={editableFirearms}
      firearmNames={firearmNames}
    />
  );
}
