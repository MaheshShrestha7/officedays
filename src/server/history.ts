import { addDays, isoWeekday, monthRange, weekRange } from "./dates";
import type { Target } from "./stats";

export interface TargetRow extends Target {
  effective_from: string;
}

export interface PeriodResult {
  start: string;
  end: string;
  days: number;
  required: number | null;
  /** null while the period is still running and not yet met, or when it has no target. */
  met: boolean | null;
}

export interface History {
  weeks: PeriodResult[];
  months: PeriodResult[];
  /** Periods in a row (of the target's kind) where the target was met. */
  streak: number;
  /** Longest run of met periods (of the target's kind) in the range. */
  bestStreak: number;
  streakUnit: "week" | "month";
  /** Finished periods with a target: how many were met. */
  hit: { met: number; total: number };
  totalDays: number;
}

/** The target that applied on a date, from rows sorted by effective_from ascending. */
export function targetAt(targets: TargetRow[], date: string): Target | null {
  let found: TargetRow | null = null;
  for (const t of targets) if (t.effective_from <= date) found = t;
  return found;
}

function evaluate(
  range: { start: string; end: string },
  kind: Target["period"],
  today: string,
  checkins: string[],
  leave: string[],
  targets: TargetRow[],
): PeriodResult {
  const target = targetAt(targets, range.start) ?? targetAt(targets, today);
  const inRange = (d: string) => d >= range.start && d <= range.end;
  const days = checkins.filter(inRange).length;
  let required: number | null = null;
  if (target?.period === kind) {
    const off = leave.filter((d) => inRange(d) && target.workdays.includes(String(isoWeekday(d)))).length;
    required = Math.max(target.days_required - off, 0);
  }
  const finished = range.end < today;
  const met = required === null ? null : days >= required ? true : finished ? false : null;
  return { ...range, days, required, met };
}

/**
 * Week-by-week and month-by-month results from `since` (the sign-up date) up to today,
 * at most 26 weeks and 12 months back.
 */
export function history(
  today: string,
  since: string,
  checkins: string[],
  leave: string[],
  targets: TargetRow[],
): History {
  const weeks: PeriodResult[] = [];
  for (let start = weekRange(today).start, i = 0; i < 26 && weekRange(start).end >= since; i++) {
    weeks.push(evaluate(weekRange(start), "week", today, checkins, leave, targets));
    start = addDays(start, -7);
  }
  const months: PeriodResult[] = [];
  for (let start = monthRange(today).start, i = 0; i < 12 && monthRange(start).end >= since; i++) {
    months.push(evaluate(monthRange(start), "month", today, checkins, leave, targets));
    start = monthRange(addDays(start, -1)).start;
  }

  const unit = targetAt(targets, today)?.period ?? "week";
  const periods = unit === "week" ? weeks : months;
  let streak = 0;
  for (const [i, p] of periods.entries()) {
    if (p.met === true) streak++;
    else if (i === 0 && p.met === null) continue; // the running period doesn't break a streak
    else break;
  }
  let bestStreak = 0;
  for (let i = periods.length - 1, run = 0; i >= 0; i--) {
    run = periods[i].met === true ? run + 1 : 0;
    bestStreak = Math.max(bestStreak, run);
  }
  const finished = [...weeks, ...months].filter((p) => p.end < today && p.required !== null);
  return {
    weeks: weeks.reverse(),
    months: months.reverse(),
    streak,
    bestStreak,
    streakUnit: unit,
    hit: { met: finished.filter((p) => p.met).length, total: finished.length },
    totalDays: checkins.length,
  };
}

export interface MonthWeek {
  /** The part of a Monday to Sunday week that falls inside the month. */
  start: string;
  end: string;
  days: number;
  required: number | null;
  met: boolean | null;
}

/**
 * Splits a month into its weeks, cut at the month's edges, and scores each part on its own days.
 * A part's target is the weekly target or its number of workdays, whichever is lower, less days off.
 * Only weekly targets give a part a target; a part is missed once it has ended below target.
 */
export function monthWeeks(
  date: string,
  today: string,
  checkins: string[],
  leave: string[],
  targets: TargetRow[],
): MonthWeek[] {
  const month = monthRange(date);
  const out: MonthWeek[] = [];
  for (let start = month.start; start <= month.end; ) {
    const weekEnd = weekRange(start).end;
    const end = weekEnd < month.end ? weekEnd : month.end;
    const inRange = (d: string) => d >= start && d <= end;
    const target = targetAt(targets, start) ?? targetAt(targets, today);
    const days = checkins.filter(inRange).length;
    let required: number | null = null;
    if (target?.period === "week") {
      let workdays = 0;
      for (let d = start; d <= end; d = addDays(d, 1)) if (target.workdays.includes(String(isoWeekday(d)))) workdays++;
      const off = leave.filter((d) => inRange(d) && target.workdays.includes(String(isoWeekday(d)))).length;
      required = Math.max(Math.min(target.days_required, workdays) - off, 0);
    }
    const met = required === null ? null : days >= required ? true : end < today ? false : null;
    out.push({ start, end, days, required, met });
    start = addDays(end, 1);
  }
  return out;
}

/** Office days per ISO weekday, Monday first. */
export function weekdayCounts(checkins: string[]): number[] {
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (const d of checkins) counts[isoWeekday(d) - 1]++;
  return counts;
}
