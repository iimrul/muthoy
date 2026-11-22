import { describe, expect, it } from "vitest";
import { isDateInRange, monthGrid, parseIsoDate, shiftMonth, toIsoDate } from "./calendarMonth";

describe("parseIsoDate / toIsoDate", () => {
  it("round-trips a real date", () => {
    expect(parseIsoDate("2027-01-15")).toEqual({ year: 2027, month: 0, day: 15 });
    expect(toIsoDate(2027, 0, 15)).toBe("2027-01-15");
  });

  it("rejects dates that do not exist and anything not YYYY-MM-DD", () => {
    expect(parseIsoDate("2026-02-30")).toBeNull();
    expect(parseIsoDate("2026-13-01")).toBeNull();
    expect(parseIsoDate("2026-1-5")).toBeNull();
    expect(parseIsoDate("15/01/2027")).toBeNull();
    expect(parseIsoDate("")).toBeNull();
  });

  it("accepts 29 February only in a leap year", () => {
    expect(parseIsoDate("2028-02-29")).not.toBeNull();
    expect(parseIsoDate("2027-02-29")).toBeNull();
  });
});

describe("shiftMonth", () => {
  it("crosses year boundaries both ways", () => {
    expect(shiftMonth({ year: 2026, month: 11 }, 1)).toEqual({ year: 2027, month: 0 });
    expect(shiftMonth({ year: 2026, month: 0 }, -1)).toEqual({ year: 2025, month: 11 });
    expect(shiftMonth({ year: 2026, month: 10 }, 12)).toEqual({ year: 2027, month: 10 });
  });
});

describe("monthGrid", () => {
  it("lays November 2026 out from Sunday with six full weeks", () => {
    const weeks = monthGrid({ year: 2026, month: 10 });
    expect(weeks).toHaveLength(6);
    expect(weeks.every((week) => week.length === 7)).toBe(true);
    // 1 November 2026 is a Sunday.
    expect(weeks[0]?.[0]).toEqual({ iso: "2026-11-01", day: 1, isInMonth: true });
    expect(weeks[4]?.[1]).toEqual({ iso: "2026-11-30", day: 30, isInMonth: true });
    expect(weeks[4]?.[2]).toEqual({ iso: "2026-12-01", day: 1, isInMonth: false });
  });

  it("fills the first week with the previous month's days", () => {
    // 1 January 2027 is a Friday.
    const [firstWeek] = monthGrid({ year: 2027, month: 0 });
    expect(firstWeek?.map((day) => day.iso)).toEqual([
      "2026-12-27",
      "2026-12-28",
      "2026-12-29",
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
    ]);
    expect(firstWeek?.filter((day) => day.isInMonth)).toHaveLength(2);
  });

  it("can start the week on Saturday", () => {
    const [firstWeek] = monthGrid({ year: 2026, month: 10 }, 6);
    expect(firstWeek?.[0]?.iso).toBe("2026-10-31");
    expect(firstWeek?.[1]?.iso).toBe("2026-11-01");
  });

  it("lists every day of the month exactly once", () => {
    const inMonth = monthGrid({ year: 2028, month: 1 })
      .flat()
      .filter((day) => day.isInMonth)
      .map((day) => day.day);
    expect(inMonth).toEqual(Array.from({ length: 29 }, (_, index) => index + 1));
  });
});

describe("isDateInRange", () => {
  it("is inclusive and treats a missing bound as open", () => {
    expect(isDateInRange("2026-11-21", "2026-11-21", "2026-11-21")).toBe(true);
    expect(isDateInRange("2026-11-20", "2026-11-21")).toBe(false);
    expect(isDateInRange("2026-11-22", undefined, "2026-11-21")).toBe(false);
    expect(isDateInRange("1999-01-01")).toBe(true);
  });
});
