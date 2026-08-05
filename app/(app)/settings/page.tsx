import Link from "next/link";
import { redirect } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { Card, PageHeader } from "@/components/ui/surface";
import { getCurrentUser } from "@/src/auth/session";
import { SettingsForm } from "./settings-form";

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Manage your account preferences."
      />
      <SettingsForm magpulMode={user.magpulMode} />
      <Card>
        <h2 className="text-sm font-semibold text-foreground">
          Service intervals
        </h2>
        <p className="mt-1.5 text-sm text-ink-soft">
          Set default cleaning, barrel, and other service rules per firearm type
          and accessory category. Every item in that category inherits the
          defaults live — none of them need to be visited.
        </p>
        <Link
          href="/settings/service"
          className={buttonVariants({
            variant: "outline",
            size: "sm",
            className: "mt-4",
          })}
        >
          Manage service-interval defaults
        </Link>
      </Card>
    </div>
  );
}
