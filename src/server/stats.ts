import { monthRange, weekRange } from "./dates";

export interface Target {
  period: "week" | "month";
  days_required: number;
}

export interface PeriodProgress {
  start: string;
  end: string;
  days: number;
  /** Days required in this period, or null when the target is set on the other period. */
  required: number | null;
}

export interface Progress {
  today: string;
  checkedInToday: boolean;
  week: PeriodProgress;
  month: PeriodProgress;
}

/** Counts check-in dates in today's week and month and pairs them with the target. */
export function progress(today: string, checkinDates: string[], target: Target | null): Progress {
  const count = (r: { start: string; end: string }) =>
    checkinDates.filter((d) => d >= r.start && d <= r.end).length;
  const w = weekRange(today);
  const m = monthRange(today);
  return {
    today,
    checkedInToday: checkinDates.includes(today),
    week: { ...w, days: count(w), required: target?.period === "week" ? target.days_required : null },
    month: { ...m, days: count(m), required: target?.period === "month" ? target.days_required : null },
  };
}
