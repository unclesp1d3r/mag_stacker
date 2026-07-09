import type { ReactNode } from "react";
import { cn } from "./cn";

/**
 * Accessible field wrapper: associates the label and the error message with the
 * control via `htmlFor`/`id`/`aria-describedby`. Render the control inside and
 * pass `controlId` matching the input's `id`; set the input's
 * `aria-invalid={!!error}` and `aria-describedby={error ? errorId : undefined}`.
 */
export interface FieldProps {
  label: string;
  controlId: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}

export function Field({
  label,
  controlId,
  error,
  hint,
  required,
  children,
  className,
}: FieldProps) {
  const errorId = `${controlId}-error`;
  const hintId = `${controlId}-hint`;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label
        htmlFor={controlId}
        className="text-sm font-medium text-foreground"
      >
        {label}
        {required ? <span className="ml-0.5 text-destructive">*</span> : null}
      </label>
      {children}
      {hint && !error ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p
          id={errorId}
          role="alert"
          className="text-xs font-medium text-destructive"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
