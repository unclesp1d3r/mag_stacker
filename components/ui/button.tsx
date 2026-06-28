import type { ButtonHTMLAttributes } from "react";
import { cn } from "./cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-blaze text-blaze-ink border-transparent hover:brightness-95 active:brightness-90 shadow-[var(--shadow-raised)]",
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
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center rounded-[var(--radius)] border font-medium",
        "transition-[filter,background-color,color] duration-150",
        "disabled:cursor-not-allowed disabled:opacity-55",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  );
}
