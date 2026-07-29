"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { ConsoleSignature } from "@/components/ui/console-signature";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { ToastProvider } from "@/components/ui/toast";
import { signOut } from "@/lib/auth-client";

interface NavItem {
  href: string;
  label: string;
}

const NAV: NavItem[] = [
  { href: "/magazines", label: "Magazines" },
  { href: "/firearms", label: "Firearms" },
  { href: "/ammo", label: "Ammo" },
  { href: "/accessories", label: "Accessories" },
  { href: "/summary", label: "Summary" },
  { href: "/settings", label: "Settings" },
];

export interface ShellUser {
  email: string;
  name: string;
  role: string | null | undefined;
}

export function AppShell({
  user,
  children,
}: {
  user: ShellUser;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const nav =
    user.role === "admin"
      ? [
          ...NAV,
          { href: "/users", label: "Accounts" },
          { href: "/backup", label: "Backup" },
        ]
      : NAV;

  function isActive(href: string): boolean {
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  async function logout() {
    await signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <ToastProvider>
      <div className="flex min-h-screen flex-col">
        <header className="sticky top-0 z-[var(--z-sticky)] border-b border-border bg-background/85 backdrop-blur">
          <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4 sm:gap-6">
            <Link
              href="/magazines"
              className="shrink-0 font-mono text-sm font-bold uppercase tracking-[0.18em] text-primary"
            >
              MagStacker
            </Link>
            {/*
             * The nav must be allowed to shrink below its content width, or the
             * six-to-eight links force the whole document wider than a phone
             * viewport (every route measured 976px at 393px wide). `min-w-0`
             * makes the flex item shrinkable; `overflow-x-auto` then scrolls the
             * links in place instead of pushing the page. All destinations stay
             * one swipe away rather than hidden behind a menu.
             *
             * `relative` pairs with the scroll: `overflow-x-auto` only clips
             * descendants whose containing block runs through this element, so
             * without it any absolutely-positioned child would escape the rail
             * and widen the document — the bug that hit the data tables.
             */}
            <nav
              aria-label="Primary"
              className="no-scrollbar relative flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
            >
              {nav.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={isActive(item.href) ? "page" : undefined}
                  className={cn(
                    "shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                    isActive(item.href)
                      ? "bg-accent text-accent-foreground"
                      : "text-ink-soft hover:bg-muted hover:text-foreground",
                  )}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
            <div className="flex shrink-0 items-center gap-3">
              <span
                className="hidden text-sm text-ink-soft sm:inline"
                title={user.email}
              >
                {user.name || user.email}
              </span>
              <ThemeToggle />
              <Button variant="ghost" size="sm" onClick={logout}>
                Sign out
              </Button>
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
          {children}
        </main>
      </div>
      <ConsoleSignature />
    </ToastProvider>
  );
}
