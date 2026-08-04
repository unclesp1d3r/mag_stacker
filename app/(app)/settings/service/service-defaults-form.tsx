"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Callout, EmptyState } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
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
import { validateServiceRuleSet } from "@/src/domain/service-intervals/validate";
import { firstMessage } from "@/src/domain/validation-messages";
import {
  createServiceRuleDefaultAction,
  deleteServiceRuleDefaultAction,
  updateServiceRuleDefaultAction,
} from "./actions";
import {
  EMPTY_RULE_VALUES,
  NAME_CODES,
  type RuleFieldValues,
  ServiceRuleForm,
  THRESHOLD_CODES,
  ThresholdInputs,
  toRuleInput,
  toRuleValues,
} from "./default-rule-form";
import type { CategoryDefaultRule, CategorySection } from "./types";

/**
 * Client form for the service-defaults settings surface (U7). Category data
 * (which categories exist, their existing default rules, and how many items
 * each reaches) comes entirely from server-rendered props — this component
 * holds only ephemeral UI state (which row is open for edit, which default is
 * pending delete confirmation) and calls `router.refresh()` after every
 * mutation so the next render carries fresh server data, rather than cloning
 * the props into local state and letting it drift stale (React Compiler:
 * pass reactive slices through, don't shadow them).
 */

export type { CategoryDefaultRule, CategorySection };

interface ServiceDefaultsFormProps {
  firearmSections: CategorySection[];
  accessorySections: CategorySection[];
  /** Owner's real accessory categories — suggestions for the new-category field. */
  existingAccessoryCategories: string[];
}

function formatThreshold(value: number | null, unit: string): string {
  return value === null ? "—" : `${value} ${unit}`;
}

type OpenForm = { kind: "add" } | { kind: "edit"; id: string } | null;

interface CategorySectionCardProps {
  section: CategorySection;
  scope: "firearm" | "accessory";
  itemNounSingular: string;
  itemNounPlural: string;
  onRequestDelete: (rule: CategoryDefaultRule, categoryLabel: string) => void;
}

function CategorySectionCard({
  section,
  scope,
  itemNounSingular,
  itemNounPlural,
  onRequestDelete,
}: CategorySectionCardProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [openForm, setOpenForm] = useState<OpenForm>(null);
  const noun = section.itemCount === 1 ? itemNounSingular : itemNounPlural;

  function afterSaved(message: string) {
    setOpenForm(null);
    toast({ message });
    router.refresh();
  }

  return (
    <Card role="region" aria-label={section.label}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            {section.label}
          </h3>
          <p className="text-xs text-muted-foreground">
            Reaches {section.itemCount} {noun} in your collection
          </p>
        </div>
        {openForm === null ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setOpenForm({ kind: "add" })}
          >
            Add rule
          </Button>
        ) : null}
      </div>

      {section.defaults.length === 0 && openForm === null ? (
        <EmptyState
          title="No default rules yet"
          description="Add a rule so every item in this category resolves it live."
        />
      ) : null}

      {section.defaults.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Rule</TableHead>
              <TableHead>Days</TableHead>
              <TableHead>Sessions</TableHead>
              <TableHead>Rounds</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {section.defaults.map((rule) =>
              openForm?.kind === "edit" && openForm.id === rule.id ? (
                <TableRow key={rule.id}>
                  <TableCell colSpan={5}>
                    <ServiceRuleForm
                      initial={toRuleValues(rule)}
                      siblingNames={section.defaults
                        .filter((d) => d.id !== rule.id)
                        .map((d) => d.name)}
                      submitLabel="Save changes"
                      pendingLabel="Saving…"
                      onCancel={() => setOpenForm(null)}
                      onSubmit={(input) =>
                        updateServiceRuleDefaultAction(rule.id, input)
                      }
                      onSaved={() => afterSaved(`${rule.name} updated`)}
                    />
                  </TableCell>
                </TableRow>
              ) : (
                <TableRow key={rule.id}>
                  <TableCell className="font-medium text-foreground">
                    {rule.name}
                  </TableCell>
                  <TableCell>
                    {formatThreshold(rule.intervalDays, "days")}
                  </TableCell>
                  <TableCell>
                    {formatThreshold(rule.intervalSessions, "sessions")}
                  </TableCell>
                  <TableCell>
                    {formatThreshold(rule.intervalRounds, "rounds")}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setOpenForm({ kind: "edit", id: rule.id })
                        }
                      >
                        Edit
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => onRequestDelete(rule, section.label)}
                      >
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ),
            )}
          </TableBody>
        </Table>
      ) : null}

      {openForm?.kind === "add" ? (
        <div className="mt-3">
          <ServiceRuleForm
            siblingNames={section.defaults.map((d) => d.name)}
            submitLabel="Add rule"
            pendingLabel="Adding…"
            onCancel={() => setOpenForm(null)}
            onSubmit={(input) =>
              createServiceRuleDefaultAction({
                scope,
                category: section.category,
                ...input,
              })
            }
            onSaved={() => afterSaved(`${section.label} rule added`)}
          />
        </div>
      ) : null}
    </Card>
  );
}

interface AddAccessoryCategoryPanelProps {
  existingAccessoryCategories: string[];
}

/**
 * Arms a brand-new accessory category (KTD8) — free text, no live accessory
 * required, so a category can be configured before the first item in it
 * exists. Suggests the owner's real categories via a datalist so a near-typo
 * ("Optics" vs "Optic") is caught before it silently strands a second,
 * unrelated default set (KD10).
 */
function AddAccessoryCategoryPanel({
  existingAccessoryCategories,
}: AddAccessoryCategoryPanelProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [category, setCategory] = useState("");
  const [values, setValues] = useState<RuleFieldValues>(EMPTY_RULE_VALUES);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const categoryId = useId();
  const nameId = useId();
  const thresholdsErrorId = useId();
  const ids = { days: useId(), sessions: useId(), rounds: useId() };

  function set(key: keyof RuleFieldValues, value: string) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedCategory = category.trim();
    const input = toRuleInput(values);
    const found = validateServiceRuleSet([input]);
    setCodes(found);
    setCategoryError(trimmedCategory === "" ? "Category is required" : null);
    setServerError(null);
    if (trimmedCategory === "" || found.length > 0) {
      if (trimmedCategory === "") {
        document.getElementById(categoryId)?.focus();
      } else {
        const nameInvalid = found.some((c) => NAME_CODES.includes(c));
        document.getElementById(nameInvalid ? nameId : ids.days)?.focus();
      }
      return;
    }
    startTransition(async () => {
      const result = await createServiceRuleDefaultAction({
        scope: "accessory",
        category: trimmedCategory,
        ...input,
      });
      if (result.ok) {
        toast({ message: `${trimmedCategory} armed`, detail: input.name });
        setCategory("");
        setValues(EMPTY_RULE_VALUES);
        router.refresh();
      } else if (result.codes) {
        setCodes(result.codes);
      } else {
        setServerError(result.error ?? "Could not save.");
      }
    });
  }

  return (
    <Card role="region" aria-label="Add a new accessory category">
      <h3 className="mb-1 text-sm font-semibold text-foreground">
        Add a new accessory category
      </h3>
      <p className="mb-3 text-xs text-muted-foreground">
        Arm a category ahead of owning an accessory in it — a category with no
        matching accessory yet still inherits nothing until one exists.
      </p>
      <datalist id="service-defaults-accessory-categories">
        {existingAccessoryCategories.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
        {serverError ? (
          <Callout tone="destructive">{serverError}</Callout>
        ) : null}
        <Field
          label="Category"
          controlId={categoryId}
          required
          error={categoryError ?? undefined}
        >
          <Input
            id={categoryId}
            list="service-defaults-accessory-categories"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            aria-invalid={Boolean(categoryError)}
          />
        </Field>
        <Field
          label="Rule name"
          controlId={nameId}
          required
          error={firstMessage(codes, NAME_CODES)}
        >
          <Input
            id={nameId}
            value={values.name}
            onChange={(e) => set("name", e.target.value)}
            aria-invalid={NAME_CODES.some((c) => codes.includes(c))}
          />
        </Field>
        <ThresholdInputs
          values={values}
          onChange={set}
          ids={ids}
          error={firstMessage(codes, THRESHOLD_CODES)}
          errorId={thresholdsErrorId}
          invalid={THRESHOLD_CODES.some((c) => codes.includes(c))}
        />
        <div>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Adding…" : "Add category"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

interface DeleteTarget {
  rule: CategoryDefaultRule;
  categoryLabel: string;
}

export function ServiceDefaultsForm({
  firearmSections,
  accessorySections,
  existingAccessoryCategories,
}: ServiceDefaultsFormProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [target, setTarget] = useState<DeleteTarget | null>(null);
  const [deleting, startDelete] = useTransition();

  function confirmDelete() {
    const current = target;
    if (!current) return;
    startDelete(async () => {
      const result = await deleteServiceRuleDefaultAction(current.rule.id);
      setTarget(null);
      if (result.ok) {
        toast({ message: `${current.rule.name} removed`, tone: "neutral" });
        router.refresh();
      } else {
        toast({
          message: result.error ?? "Could not delete.",
          tone: "destructive",
        });
      }
    });
  }

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <h2 className="text-base font-semibold text-foreground">
          Firearm categories
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {firearmSections.map((section) => (
            <CategorySectionCard
              key={section.category}
              section={section}
              scope="firearm"
              itemNounSingular="firearm"
              itemNounPlural="firearms"
              onRequestDelete={(rule, categoryLabel) =>
                setTarget({ rule, categoryLabel })
              }
            />
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-base font-semibold text-foreground">
          Accessory categories
        </h2>
        {accessorySections.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {accessorySections.map((section) => (
              <CategorySectionCard
                key={section.category}
                section={section}
                scope="accessory"
                itemNounSingular="accessory"
                itemNounPlural="accessories"
                onRequestDelete={(rule, categoryLabel) =>
                  setTarget({ rule, categoryLabel })
                }
              />
            ))}
          </div>
        ) : (
          <EmptyState
            title="No accessory categories configured"
            description="Add a category below to start tracking service on your accessories."
          />
        )}
        <AddAccessoryCategoryPanel
          existingAccessoryCategories={existingAccessoryCategories}
        />
      </section>

      <ConfirmDialog
        open={target !== null}
        title={target ? `Delete the "${target.rule.name}" default?` : ""}
        description={
          target
            ? `Every ${target.categoryLabel} item that has not overridden this rule will lose it immediately.`
            : undefined
        }
        pending={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setTarget(null)}
      />
    </div>
  );
}
