/** Calendar dates are plain "YYYY-MM-DD" strings in the user's timezone. */

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function localDate(timezone: string, at: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

function toUtc(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const d = toUtc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return fmt(d);
}

/** Monday to Sunday week containing the date. */
export function weekRange(date: string): { start: string; end: string } {
  const dow = (toUtc(date).getUTCDay() + 6) % 7; // Monday = 0
  const start = addDays(date, -dow);
  return { start, end: addDays(start, 6) };
}

export function monthRange(date: string): { start: string; end: string } {
  const d = toUtc(date);
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  return { start: fmt(start), end: fmt(end) };
}
