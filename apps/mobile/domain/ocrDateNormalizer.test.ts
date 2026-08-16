import { describe, expect, it } from 'vitest';
import { normalizeScannedExpiryDate } from './ocrDateNormalizer';

describe('normalizeScannedExpiryDate', () => {
  it('passes through a valid YYYY-MM-DD date', () => {
    expect(normalizeScannedExpiryDate('2026-12-31')).toBe('2026-12-31');
  });

  it('normalizes DD-MM-YYYY (day-first)', () => {
    expect(normalizeScannedExpiryDate('31-12-2026')).toBe('2026-12-31');
  });

  it('normalizes DD/MM/YYYY with slash separators', () => {
    expect(normalizeScannedExpiryDate('05/06/2027')).toBe('2027-06-05');
  });

  it('normalizes MM/YYYY to the last day of that month', () => {
    expect(normalizeScannedExpiryDate('12/2027')).toBe('2027-12-31');
  });

  it('normalizes MM/YY (2-digit year) to the last day of that month, assuming 20YY', () => {
    expect(normalizeScannedExpiryDate('03/27')).toBe('2027-03-31');
  });

  it('normalizes DD/MM/YY (2-digit year)', () => {
    expect(normalizeScannedExpiryDate('15/08/26')).toBe('2026-08-15');
  });

  it('returns null for an impossible calendar date (Feb 31)', () => {
    expect(normalizeScannedExpiryDate('31/02/2027')).toBeNull();
  });

  it('returns null for an invalid month (13)', () => {
    expect(normalizeScannedExpiryDate('13/2027')).toBeNull();
  });

  it('returns null for a month value of 0', () => {
    expect(normalizeScannedExpiryDate('00/2027')).toBeNull();
  });

  it('returns null for unrecognized text', () => {
    expect(normalizeScannedExpiryDate('not a date')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(normalizeScannedExpiryDate('')).toBeNull();
  });

  it('trims surrounding whitespace before parsing', () => {
    expect(normalizeScannedExpiryDate('  2027-04-30  ')).toBe('2027-04-30');
  });
});
