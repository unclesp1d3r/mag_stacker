import { notFound, redirect } from "next/navigation";
import { NotFoundError } from "@/src/auth/errors";
import { getCurrentUser } from "@/src/auth/session";
import { resolvePermission } from "@/src/auth/visibility";
import { db } from "@/src/db/client";
import { getFirearm, listFirearms } from "@/src/domain/firearms/service";
import {
  calibersForInput,
  manufacturers,
} from "@/src/domain/reference/reference";
import { inventorySummary } from "@/src/domain/summary/summary";
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
  // existence (R9). notFound() renders app/(app)/not-found.tsx.
  const row = await getFirearm(user.id, id).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });

  const [permission, caliberSuggestions, summary, firearms] = await Promise.all(
    [
      resolvePermission(db, user.id, "firearm", id),
      calibersForInput(db, user.id),
      inventorySummary(user.id),
      listFirearms(user.id),
    ],
  );

  const magazineCount =
    summary.firearmCounts.find((f) => f.id === id)?.count ?? 0;
  const subtypeSuggestions = [
    ...new Set(firearms.map((f) => f.subtype).filter((s) => s.trim() !== "")),
  ].sort((a, b) => a.localeCompare(b));

  return (
    <FirearmDetailView
      firearm={{
        id: row.id,
        ownerId: row.ownerId,
        name: row.name,
        nickname: row.nickname,
        manufacturer: row.manufacturer,
        caliber: row.caliber,
        type: row.type,
        action: row.action,
        subtype: row.subtype,
        serialNumber: row.serialNumber,
        notes: row.notes,
      }}
      permission={permission ?? "view"}
      currentUserId={user.id}
      magazineCount={magazineCount}
      caliberSuggestions={caliberSuggestions}
      manufacturerSuggestions={manufacturers()}
      subtypeSuggestions={subtypeSuggestions}
    />
  );
}
