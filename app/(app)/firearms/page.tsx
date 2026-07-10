import { redirect } from "next/navigation";
import { getCurrentUser } from "@/src/auth/session";
import { visibleFirearmPermissions } from "@/src/auth/visibility";
import { db } from "@/src/db/client";
import { primaryThumbnailsFor } from "@/src/domain/firearm-photos/service";
import { listFirearms } from "@/src/domain/firearms/service";
import { lifetimeRoundTotals } from "@/src/domain/range-sessions/service";
import {
  calibersForInput,
  manufacturers,
} from "@/src/domain/reference/reference";
import { inventorySummary } from "@/src/domain/summary/summary";
import { type FirearmListItem, FirearmsView } from "./firearms-view";

export default async function FirearmsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // Needs the visible firearm id set, so it can't join the Promise.all below —
  // still a single batched query (R18), just sequenced after the list fetch
  // rather than run per row.
  const firearms = await listFirearms(user.id);
  const [summary, caliberSuggestions, permissions, primaryThumbnails] =
    await Promise.all([
      inventorySummary(user.id),
      calibersForInput(db, user.id),
      visibleFirearmPermissions(db, user.id),
      primaryThumbnailsFor(
        user.id,
        firearms.map((f) => f.id),
      ),
    ]);
  // Reuse the permission map's keys (the visible firearm set) so the round-total
  // aggregation doesn't re-derive owned∪granted a second time.
  const roundTotals = await lifetimeRoundTotals(
    user.id,
    new Set(permissions.keys()),
  );

  // Subtype suggestions are the in-use values on the user's visible firearms
  // (owned + shared, per listFirearms), already fetched above — derive them here
  // rather than re-querying (unlike calibers, there is no curated master list to
  // union in). Mirrors the visibility scope of distinctCalibers.
  const subtypeSuggestions = [
    ...new Set(firearms.map((f) => f.subtype).filter((s) => s.trim() !== "")),
  ].sort((a, b) => a.localeCompare(b));

  const counts = new Map(summary.firearmCounts.map((f) => [f.id, f.count]));
  const items: FirearmListItem[] = firearms.map((f) => ({
    id: f.id,
    ownerId: f.ownerId,
    name: f.name,
    nickname: f.nickname,
    manufacturer: f.manufacturer,
    caliber: f.caliber,
    type: f.type,
    action: f.action,
    subtype: f.subtype,
    serialNumber: f.serialNumber,
    notes: f.notes,
    isNfa: f.isNfa,
    magazineCount: counts.get(f.id) ?? 0,
    roundTotal: roundTotals.get(f.id) ?? 0,
    primaryPhoto: primaryThumbnails.get(f.id) ?? null,
  }));
  // Serial column shows only when at least one visible firearm has a serial (R71).
  const showSerial = firearms.some((f) => f.serialNumber.trim() !== "");

  return (
    <FirearmsView
      firearms={items}
      currentUserId={user.id}
      showSerial={showSerial}
      caliberSuggestions={caliberSuggestions}
      manufacturerSuggestions={manufacturers()}
      subtypeSuggestions={subtypeSuggestions}
    />
  );
}
