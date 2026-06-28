import { defineConfig } from "drizzle-kit";
import { requireDatabaseUrl } from "./src/db/env";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dbCredentials: {
    url: requireDatabaseUrl(),
  },
  strict: true,
  verbose: true,
});
