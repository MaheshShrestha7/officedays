import { describe, expect, it } from "vitest";
import { buildCalendar } from "../src/server/ical";

describe("buildCalendar", () => {
  const ics = buildCalendar(
    "OfficeDays",
    [
      { date: "2026-10-08", uid: "a@officedays", summary: "Office, desk 24.002" },
      { date: "2026-12-31", uid: "b@officedays", summary: "Leave" },
    ],
    new Date("2026-10-08T10:00:00Z"),
  );

  it("writes all-day events with CRLF line endings", () => {
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("DTSTART;VALUE=DATE:20261008\r\nDTEND;VALUE=DATE:20261009");
    expect(ics).toContain("DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101");
    expect(ics).toContain("SUMMARY:Office\\, desk 24.002");
    expect(ics).toContain("DTSTAMP:20261008T100000Z");
    expect(ics.split("\r\n").every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
  });

  it("folds long lines", () => {
    const long = buildCalendar("x", [{ date: "2026-10-08", uid: "u", summary: "y".repeat(200) }]);
    const unfolded = long.replace(/\r\n /g, "");
    expect(unfolded).toContain(`SUMMARY:${"y".repeat(200)}`);
    expect(long.split("\r\n").every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
  });
});
