import type { InputHTMLAttributes, Ref, TextareaHTMLAttributes } from "react";
import { cn } from "./cn";

const BASE =
  "w-full rounded-md border border-input bg-card px-3 text-foreground " +
  "placeholder:text-muted-foreground transition-colors " +
  "hover:border-muted-foreground focus:border-primary " +
  "aria-[invalid=true]:border-destructive aria-[invalid=true]:bg-danger-soft/40";

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
