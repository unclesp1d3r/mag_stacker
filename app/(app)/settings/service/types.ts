/**
 * Shared shapes for the service-defaults settings surface (U7), split out so
 * `default-rule-form.tsx` and `service-defaults-form.tsx` can both depend on
 * them without importing from each other.
 */

export interface CategoryDefaultRule {
  id: string;
  name: string;
  intervalDays: number | null;
  intervalSessions: number | null;
  intervalRounds: number | null;
}

export interface CategorySection {
  category: string;
  label: string;
  /** Owner's items currently in this category (R4's live-inheritance reach). */
  itemCount: number;
  defaults: CategoryDefaultRule[];
}
