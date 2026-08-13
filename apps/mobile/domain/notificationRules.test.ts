import { describe, expect, it } from 'vitest';
import { daysUntilExpiry } from '@muthoy/utils';
import {
  EXPIRY_CRITICAL_DAYS_DEFAULT,
  EXPIRY_WINDOW_DAYS_DEFAULT,
  expirySeverity,
  isBatchInExpiryWindow,
  isLowStockCrossing,
  isStockRecovered,
} from './notificationRules';

describe('low-stock hysteresis', () => {
  it.each([
    {
      stock: 9,
      threshold: 10,
      unresolved: false,
      crossing: true,
      recovered: false,
    },
    {
      stock: 9,
      threshold: 10,
      unresolved: true,
      crossing: false,
      recovered: false,
    },
    {
      stock: 10,
      threshold: 10,
      unresolved: true,
      crossing: false,
      recovered: true,
    },
    {
      stock: 11,
      threshold: 10,
      unresolved: true,
      crossing: false,
      recovered: true,
    },
    {
      stock: 10,
      threshold: 10,
      unresolved: false,
      crossing: false,
      recovered: false,
    },
  ])('handles stock $stock / threshold $threshold / unresolved $unresolved', (value) => {
    expect(isLowStockCrossing(value.stock, value.threshold, value.unresolved)).toBe(value.crossing);
    expect(isStockRecovered(value.stock, value.threshold, value.unresolved)).toBe(value.recovered);
  });

  it('re-arms after recovery so a second drop crosses again', () => {
    expect(isLowStockCrossing(4, 5, false)).toBe(true);
    expect(isStockRecovered(5, 5, true)).toBe(true);
    expect(isLowStockCrossing(4, 5, false)).toBe(true);
  });
});

describe('expiry notification window', () => {
  it.each([
    { days: null, expected: false },
    { days: -1, expected: false },
    { days: 0, expected: true },
    { days: EXPIRY_WINDOW_DAYS_DEFAULT, expected: true },
    { days: EXPIRY_WINDOW_DAYS_DEFAULT + 1, expected: false },
  ])('returns $expected for $days days', ({ days, expected }) => {
    expect(isBatchInExpiryWindow(days)).toBe(expected);
  });

  it('uses a caller-supplied window', () => {
    expect(isBatchInExpiryWindow(14, 14)).toBe(true);
    expect(isBatchInExpiryWindow(15, 14)).toBe(false);
  });

  it('recomputes from the real expiry date as now changes', () => {
    const expiryDate = '2027-02-01';
    const atWindowStart = daysUntilExpiry(expiryDate, new Date('2027-01-02T12:00:00'));
    const nextDay = daysUntilExpiry(expiryDate, new Date('2027-01-03T12:00:00'));
    expect(atWindowStart).toBe(30);
    expect(nextDay).toBe(29);
    expect(isBatchInExpiryWindow(atWindowStart)).toBe(true);
    expect(isBatchInExpiryWindow(nextDay)).toBe(true);
  });
});

describe('expiry severity', () => {
  it.each([
    { days: 0, severity: 'critical' },
    { days: EXPIRY_CRITICAL_DAYS_DEFAULT, severity: 'critical' },
    { days: EXPIRY_CRITICAL_DAYS_DEFAULT + 1, severity: 'warning' },
    { days: EXPIRY_WINDOW_DAYS_DEFAULT, severity: 'warning' },
  ] as const)('returns $severity at $days days', ({ days, severity }) => {
    expect(expirySeverity(days)).toBe(severity);
  });
});
