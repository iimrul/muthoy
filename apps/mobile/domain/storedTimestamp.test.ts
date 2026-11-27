import { describe, expect, it } from "vitest";
import { parseStoredTimestamp } from "./storedTimestamp";

const INSTANT = Date.UTC(2026, 10, 27, 3, 55, 21);

describe("parseStoredTimestamp", () => {
  it("reads SQLite's zone-less current_timestamp as UTC, not device-local time", () => {
    // The device-test bug: 9:55 in Dhaka (03:55 UTC) displayed as "3:55 AM".
    expect(parseStoredTimestamp("2026-11-27 03:55:21").getTime()).toBe(INSTANT);
  });

  it("reads a zone-less minute-precision stamp as UTC", () => {
    expect(parseStoredTimestamp("2026-11-27 03:55").getTime()).toBe(Date.UTC(2026, 10, 27, 3, 55, 0));
  });

  it("reads Postgres text with microseconds and a short offset", () => {
    expect(parseStoredTimestamp("2026-11-27 04:44:49.968334+00").getTime()).toBe(
      Date.UTC(2026, 10, 27, 4, 44, 49, 968),
    );
    expect(parseStoredTimestamp("2026-11-27 10:44:49+06").getTime()).toBe(
      Date.UTC(2026, 10, 27, 4, 44, 49),
    );
    expect(parseStoredTimestamp("2026-11-27 10:44:49+0600").getTime()).toBe(
      Date.UTC(2026, 10, 27, 4, 44, 49),
    );
  });

  it("leaves ISO strings, date-only strings and Dates exactly as before", () => {
    expect(parseStoredTimestamp("2026-11-27T03:55:21.000Z").getTime()).toBe(INSTANT);
    expect(parseStoredTimestamp("2026-11-27T09:55:21+06:00").getTime()).toBe(INSTANT);
    expect(parseStoredTimestamp("2027-01-15").getTime()).toBe(new Date("2027-01-15").getTime());
    const date = new Date(INSTANT);
    expect(parseStoredTimestamp(date)).toBe(date);
  });

  it("pads short fractions and ignores surrounding whitespace", () => {
    expect(parseStoredTimestamp(" 2026-11-27 03:55:21.9 ").getTime()).toBe(INSTANT + 900);
  });

  it("returns an invalid Date for garbage, as new Date() would", () => {
    expect(Number.isNaN(parseStoredTimestamp("not a date").getTime())).toBe(true);
  });
});
