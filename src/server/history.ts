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
  const finished = [...weeks, ...months].filter((p) => p.end < today && p.required !== null);
  return {
    weeks: weeks.reverse(),
    months: months.reverse(),
    streak,
    streakUnit: unit,
    hit: { met: finished.filter((p) => p.met).length, total: finished.length },
    totalDays: checkins.length,
  };
}
