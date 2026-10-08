import { describe, expect, it } from "vitest";
import { localDate, monthRange, weekRange } from "../src/server/dates";
import { progress } from "../src/server/stats";

describe("dates", () => {
  it("weeks run Monday to Sunday", () => {
    expect(weekRange("2026-10-08")).toEqual({ start: "2026-10-05", end: "2026-10-11" });
    expect(weekRange("2026-10-05")).toEqual({ start: "2026-10-05", end: "2026-10-11" });
    expect(weekRange("2026-10-11")).toEqual({ start: "2026-10-05", end: "2026-10-11" });
    expect(weekRange("2026-11-01")).toEqual({ start: "2026-10-26", end: "2026-11-01" });
  });

  it("months cover the whole calendar month", () => {
    expect(monthRange("2026-02-14")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
    expect(monthRange("2028-02-14")).toEqual({ start: "2028-02-01", end: "2028-02-29" });
  });

  it("uses the user's timezone for today", () => {
    const at = new Date("2026-10-08T22:30:00Z");
    expect(localDate("UTC", at)).toBe("2026-10-08");
    expect(localDate("Australia/Sydney", at)).toBe("2026-10-09");
    expect(localDate("America/Los_Angeles", at)).toBe("2026-10-08");
  });
});

describe("progress", () => {
  const dates = ["2026-09-30", "2026-10-01", "2026-10-06", "2026-10-08"];

  it("counts the week and month and applies a weekly target", () => {
    const p = progress("2026-10-08", dates, { period: "week", days_required: 3 });
    expect(p.checkedInToday).toBe(true);
    expect(p.week).toMatchObject({ days: 2, required: 3 });
    expect(p.month).toMatchObject({ days: 3, required: null });
  });

  it("applies a monthly target to the month", () => {
    const p = progress("2026-10-09", dates, { period: "month", days_required: 10 });
    expect(p.checkedInToday).toBe(false);
    expect(p.week.required).toBeNull();
    expect(p.month).toMatchObject({ days: 3, required: 10 });
  });
});
