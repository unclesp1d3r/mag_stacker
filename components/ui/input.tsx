import type { InputHTMLAttributes, Ref, TextareaHTMLAttributes } from "react";
import { cn } from "./cn";

const BASE =
  "w-full rounded-[var(--radius)] border border-line-strong bg-paper-raised px-3 text-ink " +
  "placeholder:text-ink-faint transition-colors " +
  "hover:border-ink-faint focus:border-blaze " +
  "aria-[invalid=true]:border-danger aria-[invalid=true]:bg-danger-soft/40";

export function Input({
  className,
  ref,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  return (
    <input
      ref={ref}
      className={cn(BASE, "h-10 text-sm tabular", className)}
      {...props}
    />
  );
}

export function Textarea({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(BASE, "min-h-20 py-2 text-sm leading-relaxed", className)}
      {...props}
    />
  );
}
