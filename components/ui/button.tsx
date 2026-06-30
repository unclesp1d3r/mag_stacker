import type { ButtonHTMLAttributes, Ref } from "react";
import { cn } from "./cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-blaze text-blaze-ink border-transparent hover:brightness-105 active:brightness-95 shadow-[var(--glow-blaze)]",
  secondary:
    "bg-paper-raised text-ink border-line-strong hover:bg-paper-sunken active:bg-paper-sunken",
  ghost:
    "bg-transparent text-ink-soft border-transparent hover:bg-paper-sunken hover:text-ink",
  danger: "bg-transparent text-danger border-danger/40 hover:bg-danger-soft",
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
        "inline-flex items-center justify-center rounded-[var(--radius)] border font-medium",
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
