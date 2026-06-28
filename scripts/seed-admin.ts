import { auth } from "@/auth";
import { db } from "@/src/db/client";

/**
 * One-time first-admin bootstrap (KTD-6).
 *
 * A fresh deployment has zero accounts and no public sign-up, so this script
 * creates the first admin from ADMIN_EMAIL / ADMIN_PASSWORD. It uses the
 * trusted server-side `auth.api.createUser` (server `auth.api.*` calls are not
 * gated by the admin-session check, so this works on an empty database) and
 * assigns the `admin` role.
 *
 * Idempotent: if an account with ADMIN_EMAIL already exists it is left as-is.
 *
 *   bun run seed:admin
 */
async function main(): Promise<void> {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "ADMIN_EMAIL and ADMIN_PASSWORD must be set to seed the first admin (see .env.example).",
    );
  }

  const existing = await db.query.user.findFirst({
    where: (u, { eq }) => eq(u.email, email),
  });
  if (existing) {
    console.log(`Admin account already exists for ${email}; nothing to do.`);
    return;
  }

  await auth.api.createUser({
    body: {
      email,
      password,
      name: "Administrator",
      role: "admin",
    },
  });
  console.log(`Created admin account for ${email}.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Admin seed failed:", error);
    process.exit(1);
  });
