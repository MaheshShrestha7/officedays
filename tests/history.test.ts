import { describe, expect, it } from "vitest";
import { history, targetAt, type TargetRow } from "../src/server/history";

const weekly: TargetRow[] = [{ period: "week", days_required: 2, workdays: "12345", effective_from: "0000-01-01" }];

describe("targetAt", () => {
  it("picks the latest target on or before the date", () => {
    const rows: TargetRow[] = [...weekly, { period: "month", days_required: 8, workdays: "12345", effective_from: "2026-10-01" }];
    expect(targetAt(rows, "2026-09-30")?.period).toBe("week");
    expect(targetAt(rows, "2026-10-01")?.period).toBe("month");
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
    const monthly: TargetRow[] = [{ period: "month", days_required: 1, workdays: "12345", effective_from: "0000-01-01" }];
    const h = history(today, "2026-08-01", ["2026-08-10", "2026-09-10"], [], monthly);
    expect(h.streakUnit).toBe("month");
    expect(h.streak).toBe(2);
  });
});
