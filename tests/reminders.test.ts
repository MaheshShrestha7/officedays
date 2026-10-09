import { describe, expect, it } from "vitest";
import { isDue, planReminder, type ReminderUser } from "../src/server/reminders";

const user: ReminderUser = { id: 1, timezone: "Australia/Sydney", remind_day: 4, remind_hour: 8, reminded_for: null };
const weekly = { week_days: 3, month_days: null, workdays: "12345" };

describe("isDue", () => {
  // 2026-10-07T22:30Z is Thursday 8 Oct, 09:30 in Sydney.
  const thuMorning = new Date("2026-10-07T22:30:00Z");

  it("is due on the chosen day at or after the hour", () => {
    expect(isDue(user, thuMorning)).toBe(true);
    expect(isDue(user, new Date("2026-10-07T20:30:00Z"))).toBe(false); // 07:30 local
    expect(isDue({ ...user, remind_day: 5 }, thuMorning)).toBe(false);
  });

  it("is sent once a week and can be turned off", () => {
    expect(isDue({ ...user, reminded_for: "2026-10-05" }, thuMorning)).toBe(false);
    expect(isDue({ ...user, reminded_for: "2026-09-28" }, thuMorning)).toBe(true);
    expect(isDue({ ...user, remind_day: null }, thuMorning)).toBe(false);
  });
});

describe("planReminder", () => {
  const now = new Date("2026-10-07T22:30:00Z");

  it("says how many days are still needed", () => {
    const plan = planReminder(user, now, ["2026-10-06"], [], weekly);
    expect(plan).toEqual({ userId: 1, weekStart: "2026-10-05", message: "2 more office days needed this week." });
  });

  it("stays quiet when the target is met or lowered by leave", () => {
    expect(planReminder(user, now, ["2026-10-05", "2026-10-06", "2026-10-07"], [], weekly).message).toBeNull();
    expect(planReminder(user, now, ["2026-10-06"], ["2026-10-09", "2026-10-05"], weekly).message).toBeNull();
  });

  it("names both the week and the month when both are behind", () => {
    const both = { week_days: 3, month_days: 8, workdays: "12345" };
    expect(planReminder(user, now, ["2026-10-06"], [], both).message).toBe("2 more office days needed this week, 7 this month.");
    // Week on track, month behind: only the month is mentioned.
    const week = ["2026-10-05", "2026-10-06", "2026-10-07"];
    expect(planReminder(user, now, week, [], both).message).toBe("5 more office days needed this month.");
  });

  it("talks about the month for monthly targets", () => {
    const plan = planReminder(user, now, ["2026-10-01"], [], { week_days: null, month_days: 8, workdays: "12345" });
    expect(plan.message).toBe("7 more office days needed this month.");
  });
});
