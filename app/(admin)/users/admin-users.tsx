"use client";

import { useId, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Badge, Callout } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/surface";
import { DataTable, TD, TH, THead, TRow } from "@/components/ui/table";
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

  function onToggleDisabled(user: AdminUserRow) {
    startTransition(async () => {
      const result = await setAccountDisabledAction(user.id, !user.banned);
      if (!result.ok)
        setFeedback({ tone: "danger", text: result.error ?? "Update failed." });
    });
  }

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

      <DataTable>
        <THead>
          <TH>Email</TH>
          <TH>Name</TH>
          <TH>Role</TH>
          <TH>Status</TH>
          <TH className="text-right">Actions</TH>
        </THead>
        <tbody>
          {users.map((user) => (
            <TRow key={user.id}>
              <TD className="font-mono text-xs">{user.email}</TD>
              <TD>{user.name}</TD>
              <TD>
                <Badge tone={user.role === "admin" ? "blaze" : "neutral"}>
                  {user.role}
                </Badge>
              </TD>
              <TD>
                {user.banned ? (
                  <Badge tone="danger">disabled</Badge>
                ) : (
                  <Badge tone="ok">active</Badge>
                )}
              </TD>
              <TD className="text-right">
                <Button
                  variant={user.banned ? "secondary" : "danger"}
                  size="sm"
                  disabled={pending || user.role === "admin"}
                  onClick={() => onToggleDisabled(user)}
                >
                  {user.banned ? "Enable" : "Disable"}
                </Button>
              </TD>
            </TRow>
          ))}
        </tbody>
      </DataTable>
    </div>
  );
}
