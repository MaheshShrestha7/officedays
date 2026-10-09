import { describe, expect, it } from "vitest";
import { isValidDate, isoWeekday, localDate, monthRange, weekRange } from "../src/server/dates";
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

  it("numbers weekdays Monday 1 to Sunday 7", () => {
    expect(isoWeekday("2026-10-05")).toBe(1);
    expect(isoWeekday("2026-10-11")).toBe(7);
  });

  it("validates calendar dates", () => {
    expect(isValidDate("2026-02-28")).toBe(true);
    expect(isValidDate("2026-02-30")).toBe(false);
    expect(isValidDate("2026-2-3")).toBe(false);
    expect(isValidDate("nope")).toBe(false);
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
    const p = progress("2026-10-08", dates, { week_days: 3, month_days: null, workdays: "12345" });
    expect(p.checkedInToday).toBe(true);
    expect(p.week).toMatchObject({ days: 2, required: 3 });
    expect(p.month).toMatchObject({ days: 3, required: null });
  });

  it("applies a monthly target to the month", () => {
    const p = progress("2026-10-09", dates, { week_days: null, month_days: 10, workdays: "12345" });
    expect(p.checkedInToday).toBe(false);
    expect(p.week.required).toBeNull();
    expect(p.month).toMatchObject({ days: 3, required: 10 });
  });

  it("lowers the target by days off on workdays only", () => {
    // Mon 5 Oct leave, Sat 10 Oct holiday (not a workday).
    const p = progress("2026-10-08", dates, { week_days: 3, month_days: null, workdays: "12345" }, ["2026-10-05", "2026-10-10"]);
    expect(p.week).toMatchObject({ days: 2, daysOff: 1, required: 2 });
  });

  it("never asks for fewer than zero days", () => {
    const off = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"];
    const p = progress("2026-10-08", [], { week_days: 3, month_days: null, workdays: "12345" }, off);
    expect(p.week.required).toBe(0);
  });

  it("applies weekly and monthly targets together", () => {
    const p = progress("2026-10-08", dates, { week_days: 3, month_days: 10, workdays: "12345" }, ["2026-10-05"]);
    expect(p.week).toMatchObject({ days: 2, daysOff: 1, required: 2 });
    expect(p.month).toMatchObject({ days: 3, daysOff: 1, required: 9 });
  });

  it("counts days off for a monthly target", () => {
    const p = progress("2026-10-08", dates, { week_days: null, month_days: 10, workdays: "135" }, ["2026-10-05", "2026-10-06"]);
    expect(p.month).toMatchObject({ daysOff: 1, required: 9 });
  });
});
