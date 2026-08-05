import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import { NotFoundError } from "@/src/auth/errors";
import * as dueService from "@/src/domain/service-intervals/due-service";
import * as eventsService from "@/src/domain/service-intervals/events-service";
import * as rulesService from "@/src/domain/service-intervals/rules-service";
import { loadAccessoryServiceProps } from "../page";

/**
 * Unit tests for `loadAccessoryServiceProps` (the accessory detail page's
 * owner-only service-data loader) — specifically the 404 guard added
 * alongside the firearm detail page's `asNotFound` (mirrored via
 * `@/src/lib/as-not-found`).
 *
 * Uses `spyOn` on the real `due-service`/`events-service`/`rules-service`
 * module namespaces rather than `mock.module(...)` on those specifiers:
 * `rules-service` is ALSO `mock.module`-replaced, with a differently-shaped
 * export set, by `settings/service/__tests__/actions.test.ts` — a second,
 * incompatible `mock.module` on the same path from this file would collide
 * when `bun test app` runs every file in one process (mirrors the same
 * tradeoff documented in `firearms/__tests__/service-actions.test.ts`).
 * `spyOn` overrides only the named export on the already-loaded module
 * object, so it doesn't touch that shared registry.
 */

const USER_ID = "user-1";
const ACCESSORY_ID = "accessory-1";

describe("loadAccessoryServiceProps", () => {
  let getItemDueStateSpy: ReturnType<typeof spyOn>;
  let listItemRulesSpy: ReturnType<typeof spyOn>;
  let listServiceHistorySpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    getItemDueStateSpy = spyOn(dueService, "getItemDueState").mockResolvedValue(
      [],
    );
    listItemRulesSpy = spyOn(rulesService, "listItemRules").mockResolvedValue(
      [],
    );
    listServiceHistorySpy = spyOn(
      eventsService,
      "listServiceHistory",
    ).mockResolvedValue([]);
  });

  test("a non-owner viewer gets null in every field, without calling any loader", async () => {
    const result = await loadAccessoryServiceProps(
      USER_ID,
      ACCESSORY_ID,
      false,
    );

    expect(result).toEqual({
      serviceRules: null,
      suppressedServiceRuleNames: null,
      serviceHistory: null,
    });
    expect(getItemDueStateSpy).not.toHaveBeenCalled();
    expect(listItemRulesSpy).not.toHaveBeenCalled();
    expect(listServiceHistorySpy).not.toHaveBeenCalled();
  });

  test("an owner viewer gets the resolved rules, suppressed names, and history on the happy path", async () => {
    const dueRuleStub = {
      name: "Cleaning",
    } as unknown as dueService.RuleDueState;
    const keptRuleStub = {
      name: "Cleaning",
      suppressed: false,
    } as unknown as rulesService.ServiceRuleRow;
    const suppressedRuleStub = {
      name: "Lube",
      suppressed: true,
    } as unknown as rulesService.ServiceRuleRow;
    getItemDueStateSpy.mockResolvedValue([dueRuleStub]);
    listItemRulesSpy.mockResolvedValue([keptRuleStub, suppressedRuleStub]);
    listServiceHistorySpy.mockResolvedValue([]);

    const result = await loadAccessoryServiceProps(USER_ID, ACCESSORY_ID, true);

    expect(result.serviceRules).toEqual([dueRuleStub]);
    expect(result.suppressedServiceRuleNames).toEqual(["Lube"]);
    expect(result.serviceHistory).toEqual([]);
  });

  // `getItemDueState`/`listItemRules`/`listServiceHistory` route through
  // `requireAccessoryOwner`, which authorizes internally and can throw
  // `NotFoundError` if the accessory was deleted or reassigned between the
  // page's earlier `getAccessory` check and this call. Each loader is
  // independently exercised so the fix applied to all three isn't only
  // proven for whichever settles first in the `Promise.all`.
  const guardedLoaders: Array<{
    name: string;
    reject: () => void;
  }> = [
    {
      name: "getItemDueState",
      reject: () => {
        getItemDueStateSpy.mockRejectedValue(new NotFoundError());
      },
    },
    {
      name: "listItemRules",
      reject: () => {
        listItemRulesSpy.mockRejectedValue(new NotFoundError());
      },
    },
    {
      name: "listServiceHistory",
      reject: () => {
        listServiceHistorySpy.mockRejectedValue(new NotFoundError());
      },
    },
  ];

  for (const loader of guardedLoaders) {
    test(`a NotFoundError from ${loader.name} surfaces as Next's clean 404, not an unhandled rejection`, async () => {
      loader.reject();

      let caught: unknown;
      try {
        await loadAccessoryServiceProps(USER_ID, ACCESSORY_ID, true);
      } catch (error: unknown) {
        caught = error;
      }

      // `notFound()` throws a real Next.js error carrying this digest, which
      // is what the framework's router boundary keys off of to render the
      // clean 404 UI instead of the generic error boundary.
      expect(caught).toBeInstanceOf(Error);
      expect((caught as { digest?: string }).digest).toBe(
        "NEXT_HTTP_ERROR_FALLBACK;404",
      );
    });
  }

  test("a non-NotFoundError from a loader propagates unchanged, not converted to a 404", async () => {
    const boom = new Error("boom");
    getItemDueStateSpy.mockRejectedValue(boom);

    let caught: unknown;
    try {
      await loadAccessoryServiceProps(USER_ID, ACCESSORY_ID, true);
    } catch (error: unknown) {
      caught = error;
    }

    expect(caught).toBe(boom);
  });
});
