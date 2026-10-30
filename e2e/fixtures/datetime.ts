/**
 * The `datetime-local` value for `date`, to the minute, in the browser's local
 * time zone (matches `nowLocal()` in `app/(app)/inventory-log/log-entry-form.tsx`,
 * which the picker itself uses — a timezone-less string is interpreted as
 * local time by both the input and the `Date` constructor). Shared by the
 * specs that back-date a log entry.
 */
export function localDateTimeInput(date: Date): string {
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}
