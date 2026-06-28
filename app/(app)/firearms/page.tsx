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

  const counts = new Map(summary.firearmCounts.map((f) => [f.id, f.count]));
  const items: FirearmListItem[] = firearms.map((f) => ({
    id: f.id,
    name: f.name,
    manufacturer: f.manufacturer,
    caliber: f.caliber,
    serialNumber: f.serialNumber,
    notes: f.notes,
    magazineCount: counts.get(f.id) ?? 0,
  }));
  // Serial column shows only when at least one visible firearm has a serial (R71).
  const showSerial = firearms.some((f) => f.serialNumber.trim() !== "");

  return (
    <FirearmsView
      firearms={items}
      showSerial={showSerial}
      caliberSuggestions={caliberSuggestions}
      manufacturerSuggestions={manufacturers()}
    />
  );
}
