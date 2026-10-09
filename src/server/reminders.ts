import { addDays, isoWeekday, localDate, monthRange, weekRange } from "./dates";
import { progress, type PeriodProgress, type Target } from "./stats";

export interface ReminderUser {
  id: number;
  timezone: string;
  remind_day: number | null;
  remind_hour: number;
  reminded_for: string | null;
}

export interface ReminderPlan {
  userId: number;
  /** Week start to store in users.reminded_for so the check runs once a week. */
  weekStart: string;
  /** Notification text, or null when the user is on track and gets nothing. */
  message: string | null;
}

function localHour(timezone: string, at: Date): number {
  const h = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", hourCycle: "h23" }).format(at);
  return Number(h);
}

/** Is this user's reminder due now and not yet handled this week? */
export function isDue(user: ReminderUser, now: Date): boolean {
  if (user.remind_day === null) return false;
  const today = localDate(user.timezone, now);
  return (
    isoWeekday(today) === user.remind_day &&
    localHour(user.timezone, now) >= user.remind_hour &&
    user.reminded_for !== weekRange(today).start
  );
}

/** The earliest date whose check-ins can matter for today's week and month. */
export function lookbackStart(timezone: string, now: Date): string {
  return addDays(monthRange(localDate(timezone, now)).start, -7);
}

export function planReminder(
  user: ReminderUser,
  now: Date,
  checkins: string[],
  leave: string[],
  target: Target | null,
): ReminderPlan {
  const today = localDate(user.timezone, now);
  const p = progress(today, checkins, target, leave);
  const left = (r: PeriodProgress) => (r.required === null ? 0 : Math.max(r.required - r.days, 0));
  const week = left(p.week);
  const month = left(p.month);
  const days = (n: number) => `${n} more office day${n === 1 ? "" : "s"}`;
  let message: string | null = null;
  if (week && month) message = `${days(week)} needed this week, ${month} this month.`;
  else if (week) message = `${days(week)} needed this week.`;
  else if (month) message = `${days(month)} needed this month.`;
  return { userId: user.id, weekStart: weekRange(today).start, message };
}
