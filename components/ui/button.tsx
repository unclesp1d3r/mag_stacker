import type { ButtonHTMLAttributes, Ref } from "react";
import { cn } from "./cn";

type Variant = "primary" | "secondary" | "ghost" | "destructive";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-primary text-primary-foreground border-transparent hover:brightness-105 active:brightness-95 shadow-[var(--glow-primary)]",
  secondary:
    "bg-card text-foreground border-input hover:bg-muted active:bg-muted",
  ghost:
    "bg-transparent text-ink-soft border-transparent hover:bg-muted hover:text-foreground",
  destructive:
    "bg-transparent text-destructive border-destructive/40 hover:bg-danger-soft",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-sm gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  type = "button",
  ref,
  ...props
}: ButtonProps) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex items-center justify-center rounded-md border font-medium",
        "transition-[filter,background-color,color,transform] duration-150",
        // Tactile press — the control settles under your finger, then releases.
        "active:translate-y-px disabled:cursor-not-allowed disabled:opacity-55 disabled:active:translate-y-0",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  );
}
