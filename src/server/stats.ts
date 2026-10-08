import { isoWeekday, monthRange, weekRange } from "./dates";

export interface Target {
  period: "week" | "month";
  days_required: number;
  /** ISO weekdays that count, e.g. "12345" for Monday to Friday. */
  workdays: string;
}

export interface PeriodProgress {
  start: string;
  end: string;
  days: number;
  /** Leave, holiday and sick days that fall on workdays in this period. */
  daysOff: number;
  /** Days required after days off, or null when the target is set on the other period. */
  required: number | null;
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
  const period = (r: { start: string; end: string }, kind: Target["period"]): PeriodProgress => {
    const days = checkinDates.filter((d) => inRange(d, r)).length;
    const daysOff = leaveDates.filter((d) => inRange(d, r) && workdays.includes(String(isoWeekday(d)))).length;
    const required = target?.period === kind ? Math.max(target.days_required - daysOff, 0) : null;
    return { ...r, days, daysOff, required };
  };
  return {
    today,
    checkedInToday: checkinDates.includes(today),
    week: period(weekRange(today), "week"),
    month: period(monthRange(today), "month"),
  };
}
