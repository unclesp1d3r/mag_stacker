import { notFound, redirect } from "next/navigation";
import { NotFoundError } from "@/src/auth/errors";
import { getCurrentUser } from "@/src/auth/session";
import { db } from "@/src/db/client";
import { listMountedForFirearm } from "@/src/domain/accessories/service";
import { toFirearmDocumentRow } from "@/src/domain/firearm-documents/row";
import { listDocuments } from "@/src/domain/firearm-documents/service";
import { listPhotos } from "@/src/domain/firearm-photos/service";
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

  // Documents are owner-only on every operation (R8) — `listDocuments` throws
  // for a non-owner, so it's only ever called for the owner. A non-owner gets
  // an empty array here; `firearm-detail-view.tsx` never even mounts the
  // documents section for them (KTD7), so this value is unused in that case.
  const isOwner = permission === "owner";

  const [
    caliberSuggestions,
    magazineCount,
    firearms,
    mountedAccessories,
    photos,
    documents,
  ] = await Promise.all([
    calibersForInput(db, user.id),
    magazineCountForFirearm(user.id, id),
    listFirearms(user.id),
    listMountedForFirearm(user.id, id),
    // If access is revoked between the getFirearm check above and here (a
    // narrow race), listPhotos' NotFoundError becomes the same clean 404 the
    // page otherwise guarantees, not a generic 500.
    listPhotos(user.id, id).catch((error: unknown) => {
      if (error instanceof NotFoundError) notFound();
      throw error;
    }),
    isOwner
      ? listDocuments(user.id, id).catch((error: unknown) => {
          if (error instanceof NotFoundError) notFound();
          throw error;
        })
      : Promise.resolve([]),
  ]);

  // Derive the value total from the already-fetched accessories rather than
  // re-querying (the total is a pure read over the same rows).
  const accessoryValueCents = mountedAccessories.reduce(
    (sum, a) => sum + (a.costCents ?? 0),
    0,
  );

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
      photos={photos}
      // Narrowed via `toFirearmDocumentRow` (not the raw `FirearmDocument[]`)
      // so `storageKey` — the internal blob-storage path — never reaches the
      // client bundle (R10). Centralizing the narrowing is the enforcement
      // point: a bare `documents={documents}` would compile via structural
      // typing and leak the key.
      documents={documents.map(toFirearmDocumentRow)}
    />
  );
}
