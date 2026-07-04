import { notFound, redirect } from "next/navigation";
import { NotFoundError } from "@/src/auth/errors";
import { getCurrentUser } from "@/src/auth/session";
import { resolvePermission } from "@/src/auth/visibility";
import { db } from "@/src/db/client";
import { listFirearms } from "@/src/domain/firearms/service";
import { getPrefixData } from "@/src/domain/magazines/prefixes";
import { getMagazine } from "@/src/domain/magazines/service";
import { calibersForInput } from "@/src/domain/reference/reference";
import { MagazineDetailView } from "../magazine-detail-view";
import type { FirearmOption } from "../magazine-form";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function MagazineDetailPage({ params }: PageProps) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // getMagazine throws NotFoundError for a record not owned or shared — the
  // not-found path never reveals existence (R9).
  const row = await getMagazine(user.id, id).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });

  const [permission, firearms, caliberSuggestions, prefixData] =
    await Promise.all([
      resolvePermission(db, user.id, "magazine", id),
      listFirearms(user.id),
      calibersForInput(db, user.id),
      getPrefixData(user.id),
    ]);

  const nameById = new Map(firearms.map((f) => [f.id, f.name]));
  const nameCounts = new Map<string, number>();
  for (const f of firearms)
    nameCounts.set(f.name, (nameCounts.get(f.name) ?? 0) + 1);
  const firearmOptions: FirearmOption[] = firearms.map((f) => ({
    id: f.id,
    name: f.name,
    // Disambiguate same-named firearms with a non-sensitive id fragment (R52).
    hint: (nameCounts.get(f.name) ?? 0) > 1 ? f.id.slice(0, 6) : undefined,
  }));
  const compatibleFirearmNames = row.compatibleFirearmIds
    .map((fid) => nameById.get(fid))
    .filter((n): n is string => n !== undefined);

  return (
    <MagazineDetailView
      magazine={{
        id: row.id,
        ownerId: row.ownerId,
        brandModel: row.brandModel,
        caliber: row.caliber,
        baseCapacity: String(row.baseCapacity),
        extensionRounds: String(row.extensionRounds),
        label: row.label,
        acquiredDate: row.acquiredDate ?? "",
        notes: row.notes,
        compatibleFirearmIds: row.compatibleFirearmIds,
        compatibleFirearmNames,
      }}
      permission={permission ?? "view"}
      currentUserId={user.id}
      firearmOptions={firearmOptions}
      caliberSuggestions={caliberSuggestions}
      prefixOptions={prefixData.prefixes}
      prefixNextStart={prefixData.nextStart}
      magpulMode={user.magpulMode}
    />
  );
}
