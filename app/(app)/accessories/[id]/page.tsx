import { notFound, redirect } from "next/navigation";
import { NotFoundError } from "@/src/auth/errors";
import { getCurrentUser } from "@/src/auth/session";
import { visibleFirearmPermissions } from "@/src/auth/visibility";
import { db } from "@/src/db/client";
import { listAttachments } from "@/src/domain/accessories/attachments";
import { costCentsToInputValue } from "@/src/domain/accessories/display";
import { getAccessory } from "@/src/domain/accessories/service";
import { buildFirearmMountContext } from "@/src/domain/firearms/mount-options";
import { listFirearms } from "@/src/domain/firearms/service";
import { withActorNames } from "@/src/domain/service-intervals/actor-names";
import {
  getItemDueState,
  type RuleDueState,
} from "@/src/domain/service-intervals/due-service";
import { listServiceHistory } from "@/src/domain/service-intervals/events-service";
import {
  listItemRules,
  listOwnerAccessoryCategories,
} from "@/src/domain/service-intervals/rules-service";
import { asNotFound } from "@/src/lib/as-not-found";
import { isUuid } from "@/src/lib/uuid";
import type { ServiceHistoryEntry } from "../../firearms/service-history";
import { AccessoryDetailView } from "../accessory-detail-view";

interface PageProps {
  params: Promise<{ id: string }>;
}

export interface AccessoryServiceProps {
  serviceRules: RuleDueState[] | null;
  suppressedServiceRuleNames: string[] | null;
  serviceHistory: ServiceHistoryEntry[] | null;
}

/**
 * Loads service data (U8) for the OWNER only — accessories are owner-only
 * throughout for service (KTD3), so a non-owner viewer gets `null` in every
 * field rather than empty arrays, and the detail view doesn't render the
 * section at all for them (matching `requireAccessoryOwner` throwing were we
 * to call it for a non-owner anyway).
 *
 * Exported so `__tests__/service-props.test.ts` can exercise the 404-guard
 * race (a loader throwing `NotFoundError` between the page's earlier
 * `getAccessory` check and this call) directly, without standing up the rest
 * of the page's dependency graph (`listFirearms`, `visibleFirearmPermissions`,
 * `AccessoryDetailView`, ...) just to reach it.
 */
export async function loadAccessoryServiceProps(
  userId: string,
  accessoryId: string,
  isOwner: boolean,
): Promise<AccessoryServiceProps> {
  if (!isOwner) {
    return {
      serviceRules: null,
      suppressedServiceRuleNames: null,
      serviceHistory: null,
    };
  }
  // These loaders route through `requireAccessoryOwner`, which authorizes
  // internally and throws `NotFoundError` if the row is deleted or ownership
  // changes between the page's earlier `getAccessory` check and this call (a
  // narrow race, mirrors the equivalent guard on the firearm detail page) —
  // that must surface as the page's clean 404, not an unhandled 500.
  const [dueRules, itemRules, history] = await Promise.all([
    getItemDueState(userId, "accessory", accessoryId).catch(asNotFound),
    listItemRules(userId, "accessory", accessoryId).catch(asNotFound),
    listServiceHistory(userId, "accessory", accessoryId).catch(asNotFound),
  ]);
  return {
    serviceRules: dueRules,
    suppressedServiceRuleNames: itemRules
      .filter((rule) => rule.suppressed)
      .map((rule) => rule.name),
    serviceHistory: await withActorNames(history),
  };
}

export default async function AccessoryDetailPage({ params }: PageProps) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  // A malformed id can match no record and would raise a uuid-cast error on the
  // query — treat it as not-found at the boundary (R9).
  if (!isUuid(id)) notFound();

  // getAccessory resolves the viewer's permission and throws NotFoundError for
  // an accessory that is not owned nor mounted on a visible firearm — the
  // not-found path never reveals existence (R9). It returns the permission so
  // we don't re-resolve it.
  // Resolved before the batch below so its keys can serve as the visible
  // firearm id set every other query on this page would otherwise re-derive.
  const permissions = await visibleFirearmPermissions(db, user.id);
  const visibleFirearmIds = new Set(permissions.keys());

  const { accessory: row, permission } = await getAccessory(
    user.id,
    id,
    visibleFirearmIds,
  ).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });

  const isOwner = permission === "owner";

  // Mirrors `requireAccessoryDelete`: the owner deletes, and so does someone
  // who can edit the firearm it is mounted to (#8's inherited path). A direct
  // #23 accessory `edit` grant deliberately does NOT confer deletion, so the
  // control must not be offered to one — an action that is refused after the
  // click is worse than an action that was never offered. Computed from data
  // already in hand; no extra query.
  const hostPermission = row.currentFirearmId
    ? permissions.get(row.currentFirearmId)
    : undefined;
  const canDelete =
    isOwner || hostPermission === "owner" || hostPermission === "edit";

  const [firearms, serviceProps, ownerCategories, attachments] =
    await Promise.all([
      listFirearms(user.id, visibleFirearmIds),
      loadAccessoryServiceProps(user.id, id, isOwner),
      // The ACCESSORY'S OWNER's categories (row.ownerId, not the actor) —
      // suggestions should reflect the owner whose category defaults (KD10)
      // this accessory actually inherits from, even when an edit-grantee is
      // the one editing a shared mount. But `listOwnerAccessoryCategories`
      // returns EVERY category across ALL of that owner's accessories, not
      // just the ones visible to this viewer — for a non-owner grantee that
      // would leak the owner's unrelated-accessory category vocabulary, so
      // fall back to the actor's own categories instead (still useful
      // autocomplete, no cross-tenant leak).
      isOwner
        ? listOwnerAccessoryCategories(row.ownerId)
        : listOwnerAccessoryCategories(user.id),
      // Every viewer sees the attachments (R15). This re-authorizes through
      // the parent rather than trusting the check above, so a grant revoked in
      // the window between the two calls throws its own NotFoundError — route
      // it to the same 404 as `getAccessory` instead of letting it escape as an
      // unhandled error (there is no error boundary under app/).
      listAttachments(user.id, id).catch((error: unknown) => {
        if (error instanceof NotFoundError) notFound();
        throw error;
      }),
    ]);

  // The reassign-mount picker must offer only firearms owned by the
  // ACCESSORY's owner (`row.ownerId`, not the actor — an edit-grantee acting
  // on someone else's mounted accessory must still only relocate it among
  // that owner's own guns, accessories-tracker plan KTD5's cross-tenant
  // guard) AND editable by the acting user.
  const { firearmNames, editableFirearms, visibleFirearms } =
    buildFirearmMountContext(firearms, permissions, row.ownerId);

  return (
    <AccessoryDetailView
      accessory={{
        id: row.id,
        type: row.type,
        category: row.category,
        brand: row.brand,
        model: row.model,
        serialNumber: row.serialNumber,
        installedDate: row.installedDate ?? "",
        acquiredDate: row.acquiredDate ?? "",
        cost: costCentsToInputValue(row.costCents),
        notes: row.notes,
        isNfa: row.isNfa,
        compatibleFirearmIds: row.compatibleFirearmIds,
        currentFirearmId: row.currentFirearmId,
      }}
      permission={permission}
      editableFirearms={editableFirearms}
      visibleFirearms={visibleFirearms}
      attachments={attachments}
      canDelete={canDelete}
      firearmNames={firearmNames}
      serviceRules={serviceProps.serviceRules}
      suppressedServiceRuleNames={serviceProps.suppressedServiceRuleNames}
      serviceHistory={serviceProps.serviceHistory}
      ownerCategories={ownerCategories}
    />
  );
}
