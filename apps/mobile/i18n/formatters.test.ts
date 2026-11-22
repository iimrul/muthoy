import { describe, expect, it, vi } from "vitest";
import {
  dateTimeFormatter,
  dayMonthFormatter,
  moneyFormatter,
  numberFormatter,
  percentFormatter,
  timeFormatter,
} from "./formatters";

const when = new Date("2026-11-21T09:05:00+06:00");

describe("cached Intl formatters", () => {
  it("format exactly like a freshly built formatter with the same locale and options", () => {
    expect(numberFormatter("en").format(1234567)).toBe(new Intl.NumberFormat("en-IN").format(1234567));
    expect(numberFormatter("bn").format(1234567)).toBe(new Intl.NumberFormat("bn-BD").format(1234567));
    expect(moneyFormatter("en").format(100000.5)).toBe(
      new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(100000.5),
    );
    expect(percentFormatter("en", "always").format(0.12)).toBe(
      new Intl.NumberFormat("en-BD", { style: "percent", maximumFractionDigits: 0, signDisplay: "always" }).format(0.12),
    );
    expect(dayMonthFormatter("bn").format(when)).toBe(
      new Intl.DateTimeFormat("bn-BD", { day: "numeric", month: "short" }).format(when),
    );
    expect(dateTimeFormatter("en").format(when)).toBe(
      new Intl.DateTimeFormat("en-BD", { dateStyle: "medium", timeStyle: "short" }).format(when),
    );
    expect(timeFormatter("en").format(when)).toBe(
      new Intl.DateTimeFormat("en-BD", { hour: "2-digit", minute: "2-digit" }).format(when),
    );
  });

  it("keeps the lakh grouping for money in English (1,00,000.00)", () => {
    expect(moneyFormatter("en").format(100000)).toBe("1,00,000.00");
  });

  it("builds each formatter once per locale and style", () => {
    const spy = vi.spyOn(Intl, "NumberFormat");
    numberFormatter("en");
    numberFormatter("bn");
    percentFormatter("bn", "auto");
    const built = spy.mock.calls.length;
    for (let index = 0; index < 50; index += 1) {
      numberFormatter("en").format(index);
      numberFormatter("bn").format(index);
      percentFormatter("bn", "auto").format(index / 100);
    }
    expect(spy.mock.calls.length).toBe(built);
    expect(numberFormatter("en")).toBe(numberFormatter("en"));
    expect(numberFormatter("en")).not.toBe(numberFormatter("bn"));
    expect(percentFormatter("en", "auto")).not.toBe(percentFormatter("en", "always"));
    spy.mockRestore();
  });
});
