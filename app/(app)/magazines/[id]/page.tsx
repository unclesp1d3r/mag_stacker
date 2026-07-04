import { notFound, redirect } from "next/navigation";
import { NotFoundError } from "@/src/auth/errors";
import { getCurrentUser } from "@/src/auth/session";
import { db } from "@/src/db/client";
import { listFirearms } from "@/src/domain/firearms/service";
import { getPrefixData } from "@/src/domain/magazines/prefixes";
import { getMagazine } from "@/src/domain/magazines/service";
import { calibersForInput } from "@/src/domain/reference/reference";
import { isUuid } from "@/src/lib/uuid";
import { MagazineDetailView } from "../magazine-detail-view";
import type { FirearmOption } from "../magazine-form";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function MagazineDetailPage({ params }: PageProps) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  // A malformed id can match no record and would raise a uuid-cast error on the
  // query — treat it as not-found at the boundary (R9).
  if (!isUuid(id)) notFound();

  // getMagazine throws NotFoundError for a record not owned or shared — the
  // not-found path never reveals existence (R9). It returns the permission so we
  // don't re-resolve it.
  const { magazine: row, permission } = await getMagazine(user.id, id).catch(
    (error: unknown) => {
      if (error instanceof NotFoundError) notFound();
      throw error;
    },
  );

  const [firearms, caliberSuggestions, prefixData] = await Promise.all([
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
  // Pair id+name structurally so display can't drift; a firearm the viewer can't
  // see is omitted (its name is never leaked), not rendered as a blank badge.
  const compatibleFirearms = row.compatibleFirearmIds
    .map((fid) => {
      const name = nameById.get(fid);
      return name ? { id: fid, name } : null;
    })
    .filter((f): f is { id: string; name: string } => f !== null);

  return (
    <MagazineDetailView
      magazine={{
        id: row.id,
        brandModel: row.brandModel,
        caliber: row.caliber,
        baseCapacity: String(row.baseCapacity),
        extensionRounds: String(row.extensionRounds),
        label: row.label,
        acquiredDate: row.acquiredDate ?? "",
        notes: row.notes,
        compatibleFirearmIds: row.compatibleFirearmIds,
        compatibleFirearms,
      }}
      permission={permission}
      firearmOptions={firearmOptions}
      caliberSuggestions={caliberSuggestions}
      prefixOptions={prefixData.prefixes}
      prefixNextStart={prefixData.nextStart}
      magpulMode={user.magpulMode}
    />
  );
}
