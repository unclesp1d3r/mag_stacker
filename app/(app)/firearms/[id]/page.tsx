import { notFound, redirect } from "next/navigation";
import { NotFoundError } from "@/src/auth/errors";
import { getCurrentUser } from "@/src/auth/session";
import { db } from "@/src/db/client";
import {
  firearmAccessoryValueCents,
  listMountedForFirearm,
} from "@/src/domain/accessories/service";
import { getFirearm, listFirearms } from "@/src/domain/firearms/service";
import { magazineCountForFirearm } from "@/src/domain/magazines/service";
import {
  calibersForInput,
  manufacturers,
} from "@/src/domain/reference/reference";
import { isUuid } from "@/src/lib/uuid";
import { FirearmDetailView } from "../firearm-detail-view";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function FirearmDetailPage({ params }: PageProps) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  // A malformed id can match no record and would raise a uuid-cast error on the
  // query — treat it as not-found at the boundary (R9).
  if (!isUuid(id)) notFound();

  // getFirearm resolves the viewer's permission and throws NotFoundError for a
  // record that is not owned or shared — the not-found path never reveals
  // existence (R9). It returns the permission so we don't re-resolve it.
  const { firearm: row, permission } = await getFirearm(user.id, id).catch(
    (error: unknown) => {
      if (error instanceof NotFoundError) notFound();
      throw error;
    },
  );

  const [
    caliberSuggestions,
    magazineCount,
    firearms,
    mountedAccessories,
    accessoryValueCents,
  ] = await Promise.all([
    calibersForInput(db, user.id),
    magazineCountForFirearm(user.id, id),
    listFirearms(user.id),
    listMountedForFirearm(user.id, id),
    firearmAccessoryValueCents(user.id, id),
  ]);

  const subtypeSuggestions = [
    ...new Set(firearms.map((f) => f.subtype).filter((s) => s.trim() !== "")),
  ].sort((a, b) => a.localeCompare(b));

  return (
    <FirearmDetailView
      firearm={{
        id: row.id,
        name: row.name,
        nickname: row.nickname,
        manufacturer: row.manufacturer,
        caliber: row.caliber,
        type: row.type,
        action: row.action,
        subtype: row.subtype,
        serialNumber: row.serialNumber,
        notes: row.notes,
        isNfa: row.isNfa,
      }}
      permission={permission}
      magazineCount={magazineCount}
      caliberSuggestions={caliberSuggestions}
      manufacturerSuggestions={manufacturers()}
      subtypeSuggestions={subtypeSuggestions}
      mountedAccessories={mountedAccessories}
      accessoryValueCents={accessoryValueCents}
    />
  );
}
