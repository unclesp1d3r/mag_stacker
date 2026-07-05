"use client";

import {
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table/data-table";
import {
  ACTIONS_COLUMN_ID,
  type ColumnDef,
  createDefaultTableViewState,
} from "@/components/ui/data-table/types";
import { Badge, Callout } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/surface";
import { useTableViewState } from "@/hooks/use-table-view-state";
import { createAccountAction, setAccountDisabledAction } from "./actions";

export interface AdminUserRow {
  id: string;
  email: string;
  name: string;
  role: string;
  banned: boolean;
}

export function AdminUsers({ users }: { users: AdminUserRow[] }) {
  const emailId = useId();
  const nameId = useId();
  const passwordId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [feedback, setFeedback] = useState<{
    tone: "ok" | "danger";
    text: string;
  } | null>(null);
  const [pending, startTransition] = useTransition();

  function onCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await createAccountAction(data);
      if (result.ok) {
        setFeedback({ tone: "ok", text: "Account created." });
        formRef.current?.reset();
      } else {
        setFeedback({
          tone: "danger",
          text: result.error ?? "Could not create account.",
        });
      }
    });
  }

  const onToggleDisabled = useCallback((user: AdminUserRow) => {
    startTransition(async () => {
      const result = await setAccountDisabledAction(user.id, !user.banned);
      if (!result.ok)
        setFeedback({ tone: "danger", text: result.error ?? "Update failed." });
    });
  }, []);

  const columns = useMemo<ColumnDef<AdminUserRow>[]>(
    () => [
      {
        accessorKey: "email",
        header: "Email",
        meta: { label: "Email" },
        cell: ({ getValue }) => (
          <span className="font-mono text-xs">{getValue<string>()}</span>
        ),
      },
      {
        accessorKey: "name",
        header: "Name",
        meta: { label: "Name" },
      },
      {
        accessorKey: "role",
        header: "Role",
        meta: { label: "Role" },
        cell: ({ getValue }) => {
          const role = getValue<string>();
          return (
            <Badge tone={role === "admin" ? "blaze" : "neutral"}>{role}</Badge>
          );
        },
      },
      {
        accessorKey: "banned",
        id: "status",
        header: "Status",
        meta: { label: "Status" },
        cell: ({ getValue }) =>
          getValue<boolean>() ? (
            <Badge tone="danger">disabled</Badge>
          ) : (
            <Badge tone="ok">active</Badge>
          ),
      },
      {
        id: ACTIONS_COLUMN_ID,
        header: () => <span className="sr-only">Actions</span>,
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => {
          const user = row.original;
          return (
            <div className="flex justify-end">
              <Button
                variant={user.banned ? "secondary" : "danger"}
                size="sm"
                disabled={user.role === "admin"}
                onClick={() => onToggleDisabled(user)}
              >
                {user.banned ? "Enable" : "Disable"}
              </Button>
            </div>
          );
        },
      },
    ],
    // Deliberately NOT depending on `pending`: it flips on every toggle, and a
    // fresh `columns` array rebuilds every cell's function identity, which
    // makes flexRender remount every cell (tearing down the just-clicked
    // button). `onToggleDisabled` is a stable useCallback. The dropped
    // `pending` disable was only an invisible re-click guard, and a rapid
    // double-toggle is idempotent (both compute `!user.banned` from the same
    // row) — same stable-columns rule applied in magazines/firearms views.
    [onToggleDisabled],
  );

  const { viewState, setViewState, mounted } = useTableViewState(
    "users",
    createDefaultTableViewState(columns),
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
      <Card className="h-fit">
        <h2 className="text-sm font-semibold text-ink">Create account</h2>
        <p className="mt-1 mb-4 text-xs text-ink-soft">
          New users sign in with this email and password. There is no public
          sign-up.
        </p>
        <form
          ref={formRef}
          onSubmit={onCreate}
          className="flex flex-col gap-3"
          noValidate
        >
          {feedback ? (
            <Callout tone={feedback.tone}>{feedback.text}</Callout>
          ) : null}
          <Field label="Email" controlId={emailId} required>
            <Input
              id={emailId}
              name="email"
              type="email"
              autoComplete="off"
              required
            />
          </Field>
          <Field label="Name" controlId={nameId}>
            <Input id={nameId} name="name" autoComplete="off" />
          </Field>
          <Field
            label="Initial password"
            controlId={passwordId}
            hint="At least 8 characters."
            required
          >
            <Input
              id={passwordId}
              name="password"
              type="password"
              autoComplete="new-password"
              required
            />
          </Field>
          <Button type="submit" disabled={pending}>
            {pending ? "Working…" : "Create account"}
          </Button>
        </form>
      </Card>

      <DataTable
        columns={columns}
        data={users}
        viewState={viewState}
        onViewStateChange={setViewState}
        mounted={mounted}
      />
    </div>
  );
}
