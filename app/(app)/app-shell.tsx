"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { signOut } from "@/lib/auth-client";

interface NavItem {
  href: string;
  label: string;
}

const NAV: NavItem[] = [
  { href: "/magazines", label: "Magazines" },
  { href: "/firearms", label: "Firearms" },
  { href: "/summary", label: "Summary" },
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
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 border-b border-line bg-paper/85 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-6 px-4">
          <Link
            href="/magazines"
            className="font-mono text-sm font-bold uppercase tracking-[0.18em] text-blaze"
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
                  "rounded-[var(--radius)] px-3 py-1.5 text-sm font-medium transition-colors",
                  isActive(item.href)
                    ? "bg-blaze-soft text-blaze"
                    : "text-ink-soft hover:bg-paper-sunken hover:text-ink",
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
  );
}
