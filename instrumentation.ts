/**
 * Next.js server-startup hook (the `register()` file convention — see
 * `node_modules/next/dist/docs/01-app/api-reference/file-conventions/instrumentation.md`).
 * Next.js calls `register()` once, in every runtime, when a new server
 * instance boots — including during `next build`'s page-data collection,
 * where no database is configured at all.
 *
 * This wires the backup/restore crash-recovery sweep
 * (`recoverInterruptedRestore`, `src/backup/maintenance.ts`, KTD5 hardening):
 * if a force-restore was interrupted mid-flight (a crash between entering
 * maintenance and finishing cleanup), the durable maintenance flag is left
 * active and the pre-restore snapshot schema/blob directory are orphaned.
 * Running this once at boot rolls the DB and blobs back to their pre-restore
 * state and sweeps any other leftover restore staging/snapshot schema or
 * temp directory, before the server starts handling requests.
 *
 * Guarded on BOTH conditions the Next.js docs call out for
 * runtime-/environment-specific code in `register()`:
 * - `NEXT_RUNTIME === "nodejs"` — the DB pool (`pg`) and filesystem access
 *   this needs don't exist at the Edge, and importing them there would throw.
 * - `DATABASE_URL` is set — this file is imported unconditionally by every
 *   Next.js server instance, so it must never assume a database is
 *   reachable (mirrors `src/db/client.ts`'s own lazy-construction contract).
 *
 * A recovery failure is caught and logged, never thrown: this must never
 * prevent the server from starting.
 *
 * This is a no-ambient-context entry point (R11): there is no request or
 * action already carrying a correlation id, so the whole body runs inside a
 * freshly minted one via `runWithContext`.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (!process.env.DATABASE_URL) return;

  const { childLogger, mintCorrelationId, runWithContext } = await import(
    "@/src/lib/logging"
  );

  await runWithContext(
    { correlationId: mintCorrelationId(), entrypoint: "instrumentation" },
    async () => {
      try {
        const [{ db }, { activeStorageRoot }, { recoverInterruptedRestore }] =
          await Promise.all([
            import("@/src/db/client"),
            import("@/src/storage"),
            import("@/src/backup/maintenance"),
          ]);
        await recoverInterruptedRestore(db, activeStorageRoot());
      } catch (err) {
        childLogger("instrumentation").error(
          { err },
          "crash-recovery sweep failed",
        );
      }
    },
  );
}
