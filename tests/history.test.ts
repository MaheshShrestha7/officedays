import { describe, expect, it } from "vitest";
import { history, monthWeeks, targetAt, weekdayCounts, type TargetRow } from "../src/server/history";

const weekly: TargetRow[] = [{ week_days: 2, month_days: null, workdays: "12345", effective_from: "0000-01-01" }];

describe("targetAt", () => {
  it("picks the latest target on or before the date", () => {
    const rows: TargetRow[] = [...weekly, { week_days: null, month_days: 8, workdays: "12345", effective_from: "2026-10-01" }];
    expect(targetAt(rows, "2026-09-30")?.week_days).toBe(2);
    expect(targetAt(rows, "2026-10-01")?.month_days).toBe(8);
  });
});

describe("history", () => {
  // Today is Thu 8 Oct 2026. Weeks start 21 Sep, 28 Sep, 5 Oct.
  const today = "2026-10-08";

  it("scores each week and counts a streak of met weeks", () => {
    const checkins = ["2026-09-21", "2026-09-22", "2026-09-29", "2026-09-30", "2026-10-06"];
    const h = history(today, "2026-09-21", checkins, [], weekly);
    expect(h.weeks.map((w) => [w.start, w.days, w.met])).toEqual([
      ["2026-09-21", 2, true],
      ["2026-09-28", 2, true],
      ["2026-10-05", 1, null],
    ]);
    expect(h.streak).toBe(2);
    expect(h.hit).toEqual({ met: 2, total: 2 });
    expect(h.totalDays).toBe(5);
  });

  it("a missed week breaks the streak and leave lowers that week's target", () => {
    const checkins = ["2026-09-21", "2026-09-22", "2026-10-01"];
    const leave = ["2026-09-28"];
    const h = history(today, "2026-09-21", checkins, leave, weekly);
    expect(h.weeks[1]).toMatchObject({ days: 1, required: 1, met: true });

    const h2 = history(today, "2026-09-21", ["2026-09-21", "2026-09-22", "2026-10-01"], [], weekly);
    expect(h2.weeks[1].met).toBe(false);
    expect(h2.streak).toBe(0);
  });

  it("stops at the sign-up date and caps the range", () => {
    expect(history(today, "2026-10-07", [], [], weekly).weeks).toHaveLength(1);
    const long = history(today, "2020-01-01", [], [], weekly);
    expect(long.weeks).toHaveLength(26);
    expect(long.months).toHaveLength(12);
    expect(long.months.at(-1)?.start).toBe("2026-10-01");
    expect(long.months[0].start).toBe("2025-11-01");
  });

  it("uses months for the streak when the target is monthly", () => {
    const monthly: TargetRow[] = [{ week_days: null, month_days: 1, workdays: "12345", effective_from: "0000-01-01" }];
    const h = history(today, "2026-08-01", ["2026-08-10", "2026-09-10"], [], monthly);
    expect(h.streakUnit).toBe("month");
    expect(h.streak).toBe(2);
  });
});

describe("history with both targets", () => {
  it("scores weeks and months and keeps the streak in weeks", () => {
    const both: TargetRow[] = [{ week_days: 1, month_days: 3, workdays: "12345", effective_from: "0000-01-01" }];
    const h = history("2026-10-08", "2026-09-01", ["2026-09-21", "2026-09-29", "2026-10-06"], [], both);
    expect(h.streakUnit).toBe("week");
    expect(h.weeks.at(-1)).toMatchObject({ required: 1, met: true });
    expect(h.months.at(-2)).toMatchObject({ start: "2026-09-01", days: 2, required: 3, met: false });
    expect(monthWeeks("2026-10-08", "2026-10-08", [], [], both)[0].required).toBe(1);
  });
});

describe("monthWeeks", () => {
  const three: TargetRow[] = [{ week_days: 3, month_days: null, workdays: "12345", effective_from: "0000-01-01" }];

  it("cuts weeks at the month's edges and scores each part on its own days", () => {
    // October 2026 starts on a Thursday: parts are 1-4, 5-11, 12-18, 19-25, 26-31.
    const w = monthWeeks("2026-10-08", "2026-10-08", ["2026-10-01", "2026-10-06"], ["2026-10-02", "2026-10-05"], three);
    expect(w.map((p) => [p.start, p.end])).toEqual([
      ["2026-10-01", "2026-10-04"],
      ["2026-10-05", "2026-10-11"],
      ["2026-10-12", "2026-10-18"],
      ["2026-10-19", "2026-10-25"],
      ["2026-10-26", "2026-10-31"],
    ]);
    // 1-2 Oct: two workdays cap the target at 2, the sick day lowers it to 1, and the 1st meets it.
    expect(w[0]).toMatchObject({ days: 1, required: 1, met: true });
    // This week: 3 less the holiday, 1 so far, still running.
    expect(w[1]).toMatchObject({ days: 1, required: 2, met: null });
    // 26-31 Oct has five workdays, so the full target applies.
    expect(w[4]).toMatchObject({ required: 3, met: null });
  });

  it("marks a part missed only once it has ended", () => {
    const w = monthWeeks("2026-09-15", "2026-10-08", ["2026-09-01"], [], three);
    expect(w.at(-1)).toMatchObject({ start: "2026-09-28", end: "2026-09-30", required: 3, met: false });
    expect(monthWeeks("2026-10-08", "2026-10-08", [], [], three)[1].met).toBeNull();
  });

  it("gives parts no target when the target is monthly", () => {
    const monthly: TargetRow[] = [{ week_days: null, month_days: 8, workdays: "12345", effective_from: "0000-01-01" }];
    expect(monthWeeks("2026-10-08", "2026-10-08", [], [], monthly).every((p) => p.required === null)).toBe(true);
  });
});

describe("bestStreak and weekdayCounts", () => {
  it("finds the longest run of met weeks", () => {
    const two: TargetRow[] = [{ week_days: 1, month_days: null, workdays: "12345", effective_from: "0000-01-01" }];
    // Weeks of 7, 14, 21 Sep met; 28 Sep missed; 5 Oct running.
    const h = history("2026-10-08", "2026-09-07", ["2026-09-07", "2026-09-14", "2026-09-21"], [], two);
    expect(h.bestStreak).toBe(3);
    expect(h.streak).toBe(0);
  });

  it("counts office days by weekday", () => {
    expect(weekdayCounts(["2026-10-05", "2026-10-06", "2026-10-13"])).toEqual([1, 2, 0, 0, 0, 0, 0]);
  });
});
