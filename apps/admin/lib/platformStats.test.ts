import { describe, expect, test } from 'vitest';
import {
  dhakaDayRange,
  formatPhone,
  formatPlan,
  formatRegistrationDate,
  sumSaleTotals,
} from './platformStats';

describe('dhakaDayRange', () => {
  test('starts the business day at midnight Dhaka, which is 18:00 UTC the day before', () => {
    const range = dhakaDayRange(new Date('2026-08-15T18:00:00.000Z'));

    expect(range.businessDate).toBe('2026-08-16');
    expect(range.startInclusive).toBe('2026-08-15T18:00:00.000Z');
    expect(range.endExclusive).toBe('2026-08-16T18:00:00.000Z');
  });

  test('one second before midnight Dhaka still belongs to the previous business day', () => {
    const range = dhakaDayRange(new Date('2026-08-15T17:59:59.000Z'));

    expect(range.businessDate).toBe('2026-08-15');
    expect(range.startInclusive).toBe('2026-08-14T18:00:00.000Z');
  });

  test('does not roll the day over at UTC midnight — the 06:30 Dhaka trap', () => {
    // A naive UTC day boundary would call this a new day and drop the first
    // six hours of Dhaka sales from the total.
    const range = dhakaDayRange(new Date('2026-08-16T00:30:00.000Z'));

    expect(range.businessDate).toBe('2026-08-16');
    expect(range.startInclusive).toBe('2026-08-15T18:00:00.000Z');
  });

  test('pads single-digit months and days', () => {
    const range = dhakaDayRange(new Date('2026-01-04T10:00:00.000Z'));

    expect(range.businessDate).toBe('2026-01-04');
  });
});

describe('sumSaleTotals', () => {
  test('sums integer paisa exactly, with no float drift', () => {
    // 10.10 + 20.20 in taka floats gives 30.299999999999997 (see money.ts).
    expect(sumSaleTotals([{ total: 1010 }, { total: 2020 }])).toBe(3030);
  });

  test('returns zero for an empty day', () => {
    expect(sumSaleTotals([])).toBe(0);
  });

  test('rejects a non-integer total rather than silently accepting taka', () => {
    expect(() => sumSaleTotals([{ total: 12.5 }])).toThrow(/integer number of paisa/);
  });

  test('sums a large day without losing precision', () => {
    const rows = Array.from({ length: 5000 }, () => ({ total: 12_345 }));

    expect(sumSaleTotals(rows)).toBe(61_725_000);
  });
});

describe('formatRegistrationDate', () => {
  test('renders the timestamp in Asia/Dhaka, not the server timezone', () => {
    // 18:30 UTC is already 00:30 the next day in Dhaka.
    expect(formatRegistrationDate('2026-08-15T18:30:00.000Z')).toBe('16 Aug 2026');
  });

  test('falls back to a dash on an unparseable timestamp', () => {
    expect(formatRegistrationDate('not-a-date')).toBe('—');
  });
});

describe('formatPlan', () => {
  test('capitalises the stored plan without inventing a name', () => {
    expect(formatPlan('free')).toBe('Free');
  });

  test('falls back to a dash on an empty plan', () => {
    expect(formatPlan('   ')).toBe('—');
  });
});

describe('formatPhone', () => {
  test('trims the stored phone', () => {
    expect(formatPhone(' 01700000000 ')).toBe('01700000000');
  });

  test('falls back to a dash on an empty phone', () => {
    expect(formatPhone('')).toBe('—');
  });
});
