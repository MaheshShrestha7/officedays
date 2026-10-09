import { isoWeekday, monthRange, weekRange } from "./dates";

export type Period = "week" | "month";

export interface Target {
  /** Office days required each week, or null for no weekly target. */
  week_days: number | null;
  /** Office days required each month, or null for no monthly target. */
  month_days: number | null;
  /** ISO weekdays that count, e.g. "12345" for Monday to Friday. */
  workdays: string;
}

export interface PeriodProgress {
  start: string;
  end: string;
  days: number;
  /** Leave, holiday and sick days that fall on workdays in this period. */
  daysOff: number;
  /** Days required after days off, or null when there is no target for this period. */
  required: number | null;
}

/** The days a target asks for on one period, or null when it sets none there. */
export function daysFor(target: Target | null, kind: Period): number | null {
  return (kind === "week" ? target?.week_days : target?.month_days) ?? null;
}

export interface Progress {
  today: string;
  checkedInToday: boolean;
  week: PeriodProgress;
  month: PeriodProgress;
}

/** Counts office days in today's week and month and pairs them with the target, less any days off. */
export function progress(
  today: string,
  checkinDates: string[],
  target: Target | null,
  leaveDates: string[] = [],
): Progress {
  const workdays = target?.workdays ?? "12345";
  const inRange = (d: string, r: { start: string; end: string }) => d >= r.start && d <= r.end;
  const period = (r: { start: string; end: string }, kind: Period): PeriodProgress => {
    const days = checkinDates.filter((d) => inRange(d, r)).length;
    const daysOff = leaveDates.filter((d) => inRange(d, r) && workdays.includes(String(isoWeekday(d)))).length;
    const goal = daysFor(target, kind);
    const required = goal === null ? null : Math.max(goal - daysOff, 0);
    return { ...r, days, daysOff, required };
  };
  return {
    today,
    checkedInToday: checkinDates.includes(today),
    week: period(weekRange(today), "week"),
    month: period(monthRange(today), "month"),
  };
}
