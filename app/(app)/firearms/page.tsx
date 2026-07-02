import { redirect } from "next/navigation";
import { getCurrentUser } from "@/src/auth/session";
import { db } from "@/src/db/client";
import { listFirearms } from "@/src/domain/firearms/service";
import {
  calibersForInput,
  manufacturers,
} from "@/src/domain/reference/reference";
import { inventorySummary } from "@/src/domain/summary/summary";
import { type FirearmListItem, FirearmsView } from "./firearms-view";

export default async function FirearmsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [firearms, summary, caliberSuggestions] = await Promise.all([
    listFirearms(user.id),
    inventorySummary(user.id),
    calibersForInput(db, user.id),
  ]);

  // Subtype suggestions are the owner's in-use values, which are already on the
  // fetched rows — derive them here rather than re-querying (unlike calibers,
  // there is no curated master list to union in).
  const subtypeSuggestions = [
    ...new Set(firearms.map((f) => f.subtype).filter((s) => s !== "")),
  ].sort((a, b) => a.localeCompare(b));

  const counts = new Map(summary.firearmCounts.map((f) => [f.id, f.count]));
  const items: FirearmListItem[] = firearms.map((f) => ({
    id: f.id,
    ownerId: f.ownerId,
    name: f.name,
    manufacturer: f.manufacturer,
    caliber: f.caliber,
    type: f.type,
    action: f.action,
    subtype: f.subtype,
    serialNumber: f.serialNumber,
    notes: f.notes,
    magazineCount: counts.get(f.id) ?? 0,
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
