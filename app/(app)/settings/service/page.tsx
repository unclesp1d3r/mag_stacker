import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/surface";
import { getCurrentUser } from "@/src/auth/session";
import {
  FIREARM_TYPES,
  firearmTypeLabel,
  isRealFirearmType,
} from "@/src/domain/firearms/constants";
import {
  countItemsByCategory,
  listConfiguredCategories,
  listOwnerAccessoryCategories,
  listServiceRuleDefaultsByCategory,
  type ServiceRuleDefaultRow,
} from "@/src/domain/service-intervals/rules-service";
import { ServiceDefaultsForm } from "./service-defaults-form";
import type { CategorySection } from "./types";

/**
 * Service-defaults settings surface (U7). Owner-only, collection-wide
 * configuration: one default rule set per firearm type (fixed list,
 * `FIREARM_TYPES`) and per accessory category (free text, KD10) — arming a
 * category here reaches every item in it live (R4), with no item visited.
 *
 * Firearm categories are always shown, whether or not the owner has a
 * firearm of that type yet — the type list is fixed, so there's nothing to
 * derive. Accessory categories merge the owner's real distinct categories
 * (`listOwnerAccessoryCategories`, KTD8) with any category already carrying a
 * default (`listConfiguredCategories`) so a category armed ahead of an
 * accessory existing — or whose only accessory was since deleted — still has
 * a section here rather than becoming invisible.
 */

/**
 * Builds each scope's sections from the already-batch-loaded defaults-by-
 * category and count-by-category maps (one query each, regardless of how
 * many categories exist) rather than a query pair per category.
 */
function loadSections(
  categories: { category: string; label: string }[],
  defaultsByCategory: Map<string, ServiceRuleDefaultRow[]>,
  countByCategory: Map<string, number>,
): CategorySection[] {
  return categories.map(({ category, label }) => ({
    category,
    label,
    itemCount: countByCategory.get(category) ?? 0,
    defaults: (defaultsByCategory.get(category) ?? []).map((d) => ({
      id: d.id,
      name: d.name,
      intervalDays: d.intervalDays,
      intervalSessions: d.intervalSessions,
      intervalRounds: d.intervalRounds,
    })),
  }));
}

export default async function ServiceDefaultsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const firearmCategories = FIREARM_TYPES.filter(isRealFirearmType).map(
    (type) => ({ category: type, label: firearmTypeLabel(type) }),
  );

  const [existingAccessoryCategories, configuredAccessoryCategories] =
    await Promise.all([
      listOwnerAccessoryCategories(user.id),
      listConfiguredCategories(user.id, "accessory"),
    ]);
  const accessoryCategoryNames = [
    ...new Set([
      ...existingAccessoryCategories,
      ...configuredAccessoryCategories,
    ]),
  ].sort((a, b) => a.localeCompare(b));
  const accessoryCategories = accessoryCategoryNames.map((category) => ({
    category,
    label: category,
  }));

  // One grouped-by-category query per data source per scope (four total),
  // instead of a defaults + count query pair for every individual category.
  const [firearmDefaults, firearmCounts, accessoryDefaults, accessoryCounts] =
    await Promise.all([
      listServiceRuleDefaultsByCategory(user.id, "firearm"),
      countItemsByCategory(user.id, "firearm"),
      listServiceRuleDefaultsByCategory(user.id, "accessory"),
      countItemsByCategory(user.id, "accessory"),
    ]);
  const firearmSections = loadSections(
    firearmCategories,
    firearmDefaults,
    firearmCounts,
  );
  const accessorySections = loadSections(
    accessoryCategories,
    accessoryDefaults,
    accessoryCounts,
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Service-interval defaults"
        description="Set per-category service rules once — every item of that category inherits them live, without visiting any of them."
      />
      <ServiceDefaultsForm
        firearmSections={firearmSections}
        accessorySections={accessorySections}
        existingAccessoryCategories={existingAccessoryCategories}
      />
    </div>
  );
}
