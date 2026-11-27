// domain/storedTimestamp.ts — read a STORED timestamp as the instant it is.
//
// SQLite's `current_timestamp` (the schema default for every `created_at` /
// `updated_at` a write leaves out, e.g. notifications) is UTC written as
// "YYYY-MM-DD HH:MM:SS" with no zone, and Postgres text is "… HH:MM:SS.ffffff+00".
// JavaScript engines — Hermes included — read a zone-less date-time as LOCAL
// time, so every such stamp showed six hours early in Dhaka (notification at
// 9:55 read "3:55 AM", device test 2026-11-27). Both shapes are normalised to
// ISO-8601 before parsing; anything else (ISO strings, date-only "YYYY-MM-DD",
// Date objects) is passed through unchanged.

const STORED_TIMESTAMP =
  /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(:\d{2})?(\.\d+)?(Z|[+-]\d{2}(?::?\d{2})?)?$/;

export function parseStoredTimestamp(value: string | Date): Date {
  if (value instanceof Date) return value;
  const match = STORED_TIMESTAMP.exec(value.trim());
  if (!match) return new Date(value);
  const [, date, hoursMinutes, seconds = ":00", fraction = "", zone] = match;
  // Millisecond precision is all Date keeps; Postgres sends microseconds.
  const millis = fraction ? fraction.slice(0, 4).padEnd(4, "0") : "";
  return new Date(`${date}T${hoursMinutes}${seconds}${millis}${normaliseZone(zone)}`);
}

function normaliseZone(zone: string | undefined): string {
  // No zone at all is SQLite's UTC, never device-local time.
  if (zone === undefined || zone === "Z") return "Z";
  if (/^[+-]\d{2}$/.test(zone)) return `${zone}:00`;
  if (/^[+-]\d{4}$/.test(zone)) return `${zone.slice(0, 3)}:${zone.slice(3)}`;
  return zone;
}
