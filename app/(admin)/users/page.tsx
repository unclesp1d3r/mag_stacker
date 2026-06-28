import { headers } from "next/headers";
import { auth } from "@/auth";
import { PageHeader } from "@/components/ui/surface";
import { type AdminUserRow, AdminUsers } from "./admin-users";

export default async function UsersPage() {
  const result = await auth.api.listUsers({
    query: { limit: 200, sortBy: "email", sortDirection: "asc" },
    headers: await headers(),
  });
  const users: AdminUserRow[] = (result.users ?? []).map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name ?? "",
    role: (u.role as string | null) ?? "user",
    banned: Boolean(u.banned),
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Accounts"
        description="Create and manage operator-provisioned user accounts."
      />
      <AdminUsers users={users} />
    </div>
  );
}
