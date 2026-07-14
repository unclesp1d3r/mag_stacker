/**
 * Minimum length for a backup EXPORT password (hardening pass on plan Unit
 * U6/U7). Shared between the export route (`app/api/admin/backup/export/route.ts`,
 * server-side enforcement) and the export panel
 * (`app/(admin)/backup/export-panel.tsx`, client-side gating) so the two
 * never drift.
 *
 * Deliberately NOT applied to restore: a restore's password must match
 * whatever password encrypted the specific bundle being restored, including
 * bundles produced before this minimum existed — enforcing it there would
 * reject a legitimately-short older password. See `restore/route.ts`.
 */
export const MIN_BACKUP_PASSWORD_LENGTH = 12;
