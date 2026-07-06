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
      ? [...NAV, { href: "/users", label: "Accounts" }]
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
          <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-6 px-4">
            <Link
              href="/magazines"
              className="font-mono text-sm font-bold uppercase tracking-[0.18em] text-primary"
            >
              MagStacker
            </Link>
            <nav aria-label="Primary" className="flex items-center gap-1">
              {nav.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={isActive(item.href) ? "page" : undefined}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                    isActive(item.href)
                      ? "bg-accent text-accent-foreground"
                      : "text-ink-soft hover:bg-muted hover:text-foreground",
                  )}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
            <div className="ml-auto flex items-center gap-3">
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
