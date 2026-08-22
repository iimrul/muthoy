import { describe, expect, it } from "vitest";
import { asPaisa, ZERO_PAISA } from "@muthoy/types";
import {
  ALERT_PREVIEW_ROWS,
  alertPreview,
  averageSale,
  formatUnreadBadge,
  greetingKeyForHour,
  overdueBeforeDate,
  relativeTime,
  shiftBusinessDate,
  trendPercent,
} from "./dashboard";

describe("formatUnreadBadge", () => {
  const latin = (value: number) => String(value);

  it("uses one shared 10+ boundary", () => {
    expect(formatUnreadBadge(0, latin)).toBe("");
    expect(formatUnreadBadge(9, latin)).toBe("9");
    expect(formatUnreadBadge(10, latin)).toBe("10+");
    expect(formatUnreadBadge(42, latin)).toBe("10+");
  });

  it("delegates digits to the active locale", () => {
    const bangla = (value: number) =>
      new Intl.NumberFormat("bn-BD").format(value);
    expect(formatUnreadBadge(8, bangla)).toBe("৮");
    expect(formatUnreadBadge(10, bangla)).toBe("১০+");
  });
});

describe("greetingKeyForHour", () => {
  it("uses the prototype bands, including the 19:00 night boundary", () => {
    expect(greetingKeyForHour(5)).toBe("goodMorning");
    expect(greetingKeyForHour(11)).toBe("goodMorning");
    expect(greetingKeyForHour(12)).toBe("goodAfternoon");
    expect(greetingKeyForHour(16)).toBe("goodAfternoon");
    expect(greetingKeyForHour(17)).toBe("goodEvening");
    expect(greetingKeyForHour(18)).toBe("goodEvening");
    // The old production screen said evening until 20:00. The prototype does not.
    expect(greetingKeyForHour(19)).toBe("goodNight");
    expect(greetingKeyForHour(23)).toBe("goodNight");
    expect(greetingKeyForHour(0)).toBe("goodNight");
    expect(greetingKeyForHour(4)).toBe("goodNight");
  });

  it("rejects an hour outside the clock", () => {
    expect(() => greetingKeyForHour(24)).toThrow("between 0 and 23");
    expect(() => greetingKeyForHour(-1)).toThrow("between 0 and 23");
    expect(() => greetingKeyForHour(12.5)).toThrow("between 0 and 23");
  });
});

describe("relativeTime", () => {
  const now = new Date("2026-08-22T12:00:00.000Z");

  it("labels each band the way the prototype does", () => {
    expect(relativeTime("2026-08-22T11:59:30.000Z", now)).toEqual({
      unit: "justNow",
      value: 0,
    });
    expect(relativeTime("2026-08-22T11:59:00.000Z", now)).toEqual({
      unit: "minutes",
      value: 1,
    });
    expect(relativeTime("2026-08-22T11:01:00.000Z", now)).toEqual({
      unit: "minutes",
      value: 59,
    });
    expect(relativeTime("2026-08-22T11:00:00.000Z", now)).toEqual({
      unit: "hours",
      value: 1,
    });
    expect(relativeTime("2026-08-21T13:00:00.000Z", now)).toEqual({
      unit: "hours",
      value: 23,
    });
    expect(relativeTime("2026-08-21T12:00:00.000Z", now)).toEqual({
      unit: "days",
      value: 1,
    });
    expect(relativeTime("2026-08-01T12:00:00.000Z", now)).toEqual({
      unit: "days",
      value: 21,
    });
  });

  it("reads a clock-skewed future sale as just now, never a negative age", () => {
    expect(relativeTime("2026-08-22T12:05:00.000Z", now)).toEqual({
      unit: "justNow",
      value: 0,
    });
  });

  it("rejects an unparseable timestamp instead of rendering NaN", () => {
    expect(() => relativeTime("not-a-date", now)).toThrow("unparseable");
  });
});

describe("alertPreview", () => {
  const batches = ["a", "b", "c", "d", "e"];

  it("shows three rows and counts the remainder from the true total", () => {
    expect(ALERT_PREVIEW_ROWS).toBe(3);
    expect(alertPreview(batches, 40)).toEqual({
      rows: ["a", "b", "c"],
      moreCount: 37,
    });
  });

  it("shows no more-count when the total fits", () => {
    expect(alertPreview(["a", "b"], 2)).toEqual({
      rows: ["a", "b"],
      moreCount: 0,
    });
    expect(alertPreview(batches, 3)).toEqual({
      rows: ["a", "b", "c"],
      moreCount: 0,
    });
  });

  it("renders an empty alert without a negative remainder", () => {
    expect(alertPreview([], 0)).toEqual({ rows: [], moreCount: 0 });
  });

  it("never reports a negative remainder when the total lags the rows", () => {
    expect(alertPreview(batches, 1).moreCount).toBe(0);
  });

  it("rejects a nonsense total or window", () => {
    expect(() => alertPreview(batches, -1)).toThrow("non-negative integer");
    expect(() => alertPreview(batches, 5, 0)).toThrow("positive integer");
  });
});

describe("trendPercent", () => {
  it("reports the absolute percentage and its direction", () => {
    expect(trendPercent(asPaisa(15_000), asPaisa(10_000))).toEqual({
      percent: 50,
      isUp: true,
    });
    expect(trendPercent(asPaisa(7_500), asPaisa(10_000))).toEqual({
      percent: 25,
      isUp: false,
    });
  });

  it("treats an unchanged day as up, matching the prototype's >= 0 test", () => {
    expect(trendPercent(asPaisa(10_000), asPaisa(10_000))).toEqual({
      percent: 0,
      isUp: true,
    });
  });

  it("has no trend against a day that sold nothing", () => {
    expect(trendPercent(asPaisa(10_000), ZERO_PAISA)).toBeNull();
  });
});

describe("averageSale", () => {
  it("divides integer paisa without leaking a float", () => {
    expect(averageSale(asPaisa(10_000), 4)).toBe(2_500);
    // 1000/3 = 333.33... — rounded to the paisa, never stored fractional.
    expect(averageSale(asPaisa(1_000), 3)).toBe(333);
    expect(Number.isInteger(averageSale(asPaisa(1_000), 3))).toBe(true);
  });

  it("is zero for a day with no transactions", () => {
    expect(averageSale(asPaisa(0), 0)).toBe(ZERO_PAISA);
    expect(averageSale(asPaisa(9_999), 0)).toBe(ZERO_PAISA);
  });

  it("rejects a negative or fractional count", () => {
    expect(() => averageSale(asPaisa(100), -1)).toThrow("non-negative integer");
    expect(() => averageSale(asPaisa(100), 1.5)).toThrow(
      "non-negative integer",
    );
  });
});

describe("shiftBusinessDate", () => {
  it("moves whole days across month and year boundaries", () => {
    expect(shiftBusinessDate("2026-08-22", -1)).toBe("2026-08-21");
    expect(shiftBusinessDate("2026-08-22", -2)).toBe("2026-08-20");
    expect(shiftBusinessDate("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftBusinessDate("2026-01-01", -1)).toBe("2025-12-31");
    expect(shiftBusinessDate("2024-03-01", -1)).toBe("2024-02-29");
    expect(shiftBusinessDate("2026-08-22", 0)).toBe("2026-08-22");
  });

  it("rejects a malformed date", () => {
    expect(() => shiftBusinessDate("22-08-2026", -1)).toThrow("YYYY-MM-DD");
    expect(() => shiftBusinessDate("2026-08-22T00:00:00Z", -1)).toThrow(
      "YYYY-MM-DD",
    );
  });
});

describe("overdueBeforeDate", () => {
  it("is inclusive through created + creditMaxDays", () => {
    // Default period of 7 days on 2026-08-22: a credit created on 2026-08-15
    // is still inside the window; 2026-08-14 is overdue.
    expect(overdueBeforeDate("2026-08-22", 7)).toBe("2026-08-15");
    expect("2026-08-15" < overdueBeforeDate("2026-08-22", 7)).toBe(false);
    expect("2026-08-14" < overdueBeforeDate("2026-08-22", 7)).toBe(true);
  });

  it("makes every prior day overdue at a zero-day period", () => {
    expect(overdueBeforeDate("2026-08-22", 0)).toBe("2026-08-22");
    expect("2026-08-21" < overdueBeforeDate("2026-08-22", 0)).toBe(true);
    expect("2026-08-22" < overdueBeforeDate("2026-08-22", 0)).toBe(false);
  });

  it("rejects a negative or fractional credit period", () => {
    expect(() => overdueBeforeDate("2026-08-22", -1)).toThrow("non-negative");
    expect(() => overdueBeforeDate("2026-08-22", 2.5)).toThrow("non-negative");
  });
});
