"use client";

import Link from "next/link";
import { Fragment, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState } from "@/components/ui/feedback";
import { Card } from "@/components/ui/surface";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import type { InheritanceState } from "@/src/domain/service-intervals/constants";
import type { RuleDueState } from "@/src/domain/service-intervals/due-service";
import type { ServiceParentType } from "@/src/domain/service-intervals/rules-service";
import { LogServiceForm } from "./log-service-form";
import {
  addItemOnlyRuleAction,
  logServiceEventAction,
  overrideServiceRuleAction,
  resetServiceRuleAction,
  restoreServiceRuleAction,
  suppressServiceRuleAction,
} from "./service-actions";
import { ServiceRuleForm } from "./service-rule-form";

/**
 * The shared service-rules panel (U8, R18) — ONE component mounted on both
 * the firearm and accessory detail views, taking the item's resolved,
 * due-annotated rules as props (`getItemDueState`'s output, U4's
 * derivation — no re-deriving here, KTD4). Nothing in this file decides due
 * state; it only renders what was already computed and dispatches the five
 * rule actions plus log-service.
 *
 * Permission gating (KTD3): `canManageRules` gates all five rule actions;
 * `canLogService` gates only the log-service action. A firearm view-grantee
 * gets neither; a firearm edit-grantee gets `canLogService` only; every
 * owner gets both; an accessory is owner-only throughout, so both flags are
 * identical there and a non-owner never even reaches this component (the
 * accessory detail page doesn't load or mount it for them).
 *
 * R21: no action here confirms, interrupts, or blocks — reset/suppress/
 * restore are direct one-click writes with no `ConfirmDialog`, and a due
 * rule renders as a plain text marker, never a modal.
 */

const INHERITANCE_LABEL: Record<InheritanceState, string> = {
  inherited: "Inherited",
  overridden: "Overridden",
  "item-only": "Item-only",
};

function formatAxis(
  elapsed: number,
  threshold: number | null,
  unit: string,
): string {
  return threshold === null ? "—" : `${elapsed} of ${threshold} ${unit}`;
}

export interface ServiceRulesPanelProps {
  parentType: ServiceParentType;
  parentId: string;
  rules: RuleDueState[];
  /** Names of this item's suppressed rules (KTD6) — absent from `rules` entirely (R5). */
  suppressedRuleNames: string[];
  /** Owner-only: override, reset, suppress, restore, add-item-only (KTD3). */
  canManageRules: boolean;
  /** Owner or edit-grantee on a firearm; owner-only on an accessory (KTD3). */
  canLogService: boolean;
  /** Called after any mutation so the parent can `router.refresh()` for fresh due state. */
  onChange: () => void;
}

type PanelForm =
  | { kind: "override"; rule: RuleDueState }
  | { kind: "addItemOnly" }
  | { kind: "log"; ruleName: string }
  | null;

function toRuleFieldValues(rule: RuleDueState) {
  return {
    name: rule.name,
    days: rule.intervalDays?.toString() ?? "",
    sessions: rule.intervalSessions?.toString() ?? "",
    rounds: rule.intervalRounds?.toString() ?? "",
  };
}

interface RuleActionsProps {
  rule: RuleDueState;
  canManageRules: boolean;
  canLogService: boolean;
  onOverride: () => void;
  onLog: () => void;
  onReset: () => void;
  onSuppress: () => void;
  pending: boolean;
}

function RuleActions({
  rule,
  canManageRules,
  canLogService,
  onOverride,
  onLog,
  onReset,
  onSuppress,
  pending,
}: RuleActionsProps) {
  return (
    <div className="flex flex-wrap justify-end gap-1">
      {canLogService ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={onLog}
          aria-label={`Log service — ${rule.name}`}
        >
          Log service
        </Button>
      ) : null}
      {canManageRules ? (
        <>
          {rule.inheritanceState !== "item-only" ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={onOverride}
              aria-label={`Override ${rule.name}`}
            >
              Override
            </Button>
          ) : null}
          {rule.inheritanceState === "overridden" ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={onReset}
              disabled={pending}
              aria-label={`Reset ${rule.name} to inherited`}
            >
              Reset to inherited
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            onClick={onSuppress}
            disabled={pending}
            aria-label={`Suppress ${rule.name}`}
          >
            Suppress
          </Button>
        </>
      ) : null}
    </div>
  );
}

export function ServiceRulesPanel({
  parentType,
  parentId,
  rules,
  suppressedRuleNames,
  canManageRules,
  canLogService,
  onChange,
}: ServiceRulesPanelProps) {
  const { toast } = useToast();
  const [form, setForm] = useState<PanelForm>(null);
  const [pending, startTransition] = useTransition();

  function afterMutation(message?: string) {
    setForm(null);
    if (message) toast({ message });
    onChange();
  }

  function siblingNamesExcluding(name: string): string[] {
    const active = rules.map((r) => r.name).filter((n) => n !== name);
    const suppressed = suppressedRuleNames.filter((n) => n !== name);
    return [...active, ...suppressed];
  }

  function reset(ruleName: string) {
    startTransition(async () => {
      const result = await resetServiceRuleAction(
        parentType,
        parentId,
        ruleName,
      );
      if (result.ok) {
        afterMutation(`${ruleName} reset to inherited`);
      } else {
        toast({
          message: result.error ?? "Could not reset rule.",
          tone: "destructive",
        });
      }
    });
  }

  function suppress(ruleName: string) {
    startTransition(async () => {
      const result = await suppressServiceRuleAction(
        parentType,
        parentId,
        ruleName,
      );
      if (result.ok) {
        afterMutation(`${ruleName} suppressed`);
      } else {
        toast({
          message: result.error ?? "Could not suppress rule.",
          tone: "destructive",
        });
      }
    });
  }

  function restore(ruleName: string) {
    startTransition(async () => {
      const result = await restoreServiceRuleAction(
        parentType,
        parentId,
        ruleName,
      );
      if (result.ok) {
        afterMutation(`${ruleName} restored`);
      } else {
        toast({
          message: result.error ?? "Could not restore rule.",
          tone: "destructive",
        });
      }
    });
  }

  const isEmpty = rules.length === 0 && suppressedRuleNames.length === 0;

  return (
    <Card role="region" aria-label="Service rules">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-sm font-semibold text-foreground">Service rules</h2>
        {canManageRules && form?.kind !== "addItemOnly" ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setForm({ kind: "addItemOnly" })}
          >
            Add item-only rule
          </Button>
        ) : null}
      </div>

      {isEmpty ? (
        <EmptyState
          title="No service rules"
          description={
            canManageRules
              ? "Set up category defaults so every matching item inherits them, or add an item-only rule below."
              : "No service rules are tracked for this item."
          }
          action={
            canManageRules ? (
              <Link
                href="/settings/service"
                className="text-sm font-medium text-primary hover:underline"
              >
                Go to Service defaults
              </Link>
            ) : undefined
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Rule</TableHead>
              <TableHead>State</TableHead>
              <TableHead>Days</TableHead>
              <TableHead>Sessions</TableHead>
              <TableHead>Rounds</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rules.map((rule) => {
              const isOverrideForm =
                form?.kind === "override" && form.rule.name === rule.name;
              const isLogForm =
                form?.kind === "log" && form.ruleName === rule.name;
              return (
                <Fragment key={rule.name}>
                  {isOverrideForm ? (
                    <TableRow key={`${rule.name}-override`}>
                      <TableCell colSpan={6}>
                        <ServiceRuleForm
                          initial={toRuleFieldValues(rule)}
                          nameLocked={rule.inheritanceState !== "item-only"}
                          siblingNames={siblingNamesExcluding(rule.name)}
                          submitLabel="Save override"
                          pendingLabel="Saving…"
                          onCancel={() => setForm(null)}
                          onSubmit={(input) =>
                            overrideServiceRuleAction(
                              parentType,
                              parentId,
                              input,
                            )
                          }
                          onSaved={() => afterMutation(`${rule.name} updated`)}
                        />
                      </TableCell>
                    </TableRow>
                  ) : (
                    <TableRow key={rule.name}>
                      <TableCell className="font-medium text-foreground">
                        {rule.name}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge tone="neutral">
                            {INHERITANCE_LABEL[rule.inheritanceState]}
                          </Badge>
                          {rule.due ? (
                            <Badge tone="destructive">Due</Badge>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        {formatAxis(
                          rule.counts.days,
                          rule.intervalDays,
                          "days",
                        )}
                      </TableCell>
                      <TableCell>
                        {formatAxis(
                          rule.counts.sessions,
                          rule.intervalSessions,
                          "sessions",
                        )}
                      </TableCell>
                      <TableCell>
                        {formatAxis(
                          rule.counts.rounds,
                          rule.intervalRounds,
                          "rounds",
                        )}
                      </TableCell>
                      <TableCell>
                        <RuleActions
                          rule={rule}
                          canManageRules={canManageRules}
                          canLogService={canLogService}
                          pending={pending}
                          onOverride={() => setForm({ kind: "override", rule })}
                          onLog={() =>
                            setForm({ kind: "log", ruleName: rule.name })
                          }
                          onReset={() => reset(rule.name)}
                          onSuppress={() => suppress(rule.name)}
                        />
                      </TableCell>
                    </TableRow>
                  )}
                  {isLogForm ? (
                    <TableRow key={`${rule.name}-log`}>
                      <TableCell colSpan={6}>
                        <LogServiceForm
                          ruleName={rule.name}
                          onCancel={() => setForm(null)}
                          onSubmit={(input) =>
                            logServiceEventAction(parentType, parentId, input)
                          }
                          onSaved={() =>
                            afterMutation(`Logged service — ${rule.name}`)
                          }
                        />
                      </TableCell>
                    </TableRow>
                  ) : null}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      )}

      {form?.kind === "addItemOnly" ? (
        <div className="mt-3">
          <ServiceRuleForm
            siblingNames={[...rules.map((r) => r.name), ...suppressedRuleNames]}
            submitLabel="Add rule"
            pendingLabel="Adding…"
            onCancel={() => setForm(null)}
            onSubmit={(input) =>
              addItemOnlyRuleAction(parentType, parentId, input)
            }
            onSaved={() => afterMutation("Item-only rule added")}
          />
        </div>
      ) : null}

      {canManageRules && suppressedRuleNames.length > 0 ? (
        <div className="mt-4 border-t border-border pt-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Suppressed rules
          </h3>
          <ul className="flex flex-col gap-1.5">
            {suppressedRuleNames.map((name) => (
              <li
                key={name}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <span className="text-foreground">{name}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => restore(name)}
                  disabled={pending}
                  aria-label={`Restore ${name}`}
                >
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}
