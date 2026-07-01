import { execFileSync } from "node:child_process";

/**
 * Reserve an OS-assigned free TCP port, synchronously.
 *
 * playwright.config.ts is loaded as CommonJS (no top-level await), so the port
 * must be resolved without awaiting. We shell out to a tiny script that binds
 * port 0, prints the port the OS assigned, and releases it.
 *
 * There is a reserve-then-bind race: the launcher only binds `next start` after
 * the container starts, migrations, and seeding — tens of seconds later, not
 * milliseconds — so on a busy host another process could claim the port in the
 * gap. That is rare on ephemeral CI runners; if it happens, `next start` fails
 * with EADDRINUSE, its output surfaces (stdio is inherited), and the launcher's
 * early-exit handler tears down and reports the failure fast (no long timeout).
 */
export function getFreePort(): number {
  const probe =
    "const s=require('node:net').createServer();" +
    "s.listen(0,()=>{process.stdout.write(String(s.address().port));s.close();});";
  const out = execFileSync(process.execPath, ["-e", probe], {
    encoding: "utf8",
  });
  const port = Number(out.trim());
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Free-port probe returned an invalid port: "${out}".`);
  }
  return port;
}
