import { notFound, redirect } from "next/navigation";
import { NotFoundError } from "@/src/auth/errors";
import { getCurrentUser } from "@/src/auth/session";
import { namesByIds } from "@/src/auth/users";
import { visibleFirearmPermissions } from "@/src/auth/visibility";
import { db } from "@/src/db/client";
import { costCentsToInputValue } from "@/src/domain/accessories/display";
import { getAccessory } from "@/src/domain/accessories/service";
import { buildFirearmMountContext } from "@/src/domain/firearms/mount-options";
import { listFirearms } from "@/src/domain/firearms/service";
import {
  getItemDueState,
  type RuleDueState,
} from "@/src/domain/service-intervals/due-service";
import {
  listServiceHistory,
  type ServiceEventRow,
} from "@/src/domain/service-intervals/events-service";
import {
  listItemRules,
  listOwnerAccessoryCategories,
} from "@/src/domain/service-intervals/rules-service";
import { isUuid } from "@/src/lib/uuid";
import type { ServiceHistoryEntry } from "../../firearms/service-history";
import { AccessoryDetailView } from "../accessory-detail-view";

/** Display label when `actorId` is `null` — the authoring account was later deleted. */
const UNKNOWN_ACTOR_LABEL = "Unknown";

interface PageProps {
  params: Promise<{ id: string }>;
}

interface AccessoryServiceProps {
  serviceRules: RuleDueState[] | null;
  suppressedServiceRuleNames: string[] | null;
  serviceHistory: ServiceHistoryEntry[] | null;
}

async function withActorNames(
  events: ServiceEventRow[],
): Promise<ServiceHistoryEntry[]> {
  const actorIds = [
    ...new Set(
      events
        .map((event) => event.actorId)
        .filter((actorId): actorId is string => actorId !== null),
    ),
  ];
  const nameById = await namesByIds(actorIds);
  return events.map((event) => ({
    id: event.id,
    ruleName: event.ruleName,
    servicedOn: event.servicedOn,
    actorName:
      event.actorId === null
        ? UNKNOWN_ACTOR_LABEL
        : (nameById.get(event.actorId) ?? event.actorId),
    notes: event.notes,
  }));
}

/**
 * Loads service data (U8) for the OWNER only — accessories are owner-only
 * throughout for service (KTD3), so a non-owner viewer gets `null` in every
 * field rather than empty arrays, and the detail view doesn't render the
 * section at all for them (matching `requireAccessoryOwner` throwing were we
 * to call it for a non-owner anyway).
 */
async function loadAccessoryServiceProps(
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
  const [dueRules, itemRules, history] = await Promise.all([
    getItemDueState(userId, "accessory", accessoryId),
    listItemRules(userId, "accessory", accessoryId),
    listServiceHistory(userId, "accessory", accessoryId),
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
  const { accessory: row, permission } = await getAccessory(user.id, id).catch(
    (error: unknown) => {
      if (error instanceof NotFoundError) notFound();
      throw error;
    },
  );

  const isOwner = permission === "owner";

  const [firearms, permissions, serviceProps, ownerCategories] =
    await Promise.all([
      listFirearms(user.id),
      visibleFirearmPermissions(db, user.id),
      loadAccessoryServiceProps(user.id, id, isOwner),
      // The ACCESSORY'S OWNER's categories (row.ownerId, not the actor) —
      // suggestions should reflect the owner whose category defaults (KD10)
      // this accessory actually inherits from, even when an edit-grantee is
      // the one editing a shared mount.
      listOwnerAccessoryCategories(row.ownerId),
    ]);

  // The reassign-mount picker must offer only firearms owned by the
  // ACCESSORY's owner (`row.ownerId`, not the actor — an edit-grantee acting
  // on someone else's mounted accessory must still only relocate it among
  // that owner's own guns, KTD5's cross-tenant guard) AND editable by the
  // acting user.
  const { firearmNames, editableFirearms } = buildFirearmMountContext(
    firearms,
    permissions,
    row.ownerId,
  );

  return (
    <AccessoryDetailView
      accessory={{
        id: row.id,
        category: row.category,
        brand: row.brand,
        model: row.model,
        serialNumber: row.serialNumber,
        installedDate: row.installedDate ?? "",
        acquiredDate: row.acquiredDate ?? "",
        cost: costCentsToInputValue(row.costCents),
        notes: row.notes,
        isNfa: row.isNfa,
        currentFirearmId: row.currentFirearmId,
      }}
      permission={permission}
      editableFirearms={editableFirearms}
      firearmNames={firearmNames}
      serviceRules={serviceProps.serviceRules}
      suppressedServiceRuleNames={serviceProps.suppressedServiceRuleNames}
      serviceHistory={serviceProps.serviceHistory}
      ownerCategories={ownerCategories}
    />
  );
}
