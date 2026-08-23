import { describe, expect, it } from 'vitest';
import {
  businessDateDifference,
  deviceDailyTriggerForDhakaClosing,
  dhakaBusinessDate,
  dhakaHour,
  isBeforeDhakaClosing,
  nextDhakaClosingInstant,
} from './businessDate';

describe('Dhaka business dates', () => {
  it('rolls over at Asia/Dhaka midnight', () => {
    expect(dhakaBusinessDate(new Date('2026-08-20T17:59:59Z'))).toBe('2026-08-20');
    expect(dhakaBusinessDate(new Date('2026-08-20T18:00:00Z'))).toBe('2026-08-21');
  });
  it('computes calendar-day distance', () => expect(businessDateDifference('2026-09-01', '2026-08-21')).toBe(11));

  it('reads the Dhaka hour at the business-date boundary', () => {
    expect(dhakaHour(new Date('2026-08-20T17:59:59Z'))).toBe(23);
    expect(dhakaHour(new Date('2026-08-20T18:00:00Z'))).toBe(0);
  });

  it.each([
    { closingHour: 0, before: false },
    { closingHour: 20, before: true },
    { closingHour: 23, before: true },
  ])('drives Today-so-far for closing hour $closingHour', ({ closingHour, before }) => {
    expect(isBeforeDhakaClosing(new Date('2026-08-20T13:00:00Z'), closingHour)).toBe(before);
  });

  it('changes Today-so-far exactly at the Dhaka closing boundary', () => {
    expect(isBeforeDhakaClosing(new Date('2026-08-20T13:59:59Z'), 20)).toBe(true);
    expect(isBeforeDhakaClosing(new Date('2026-08-20T14:00:00Z'), 20)).toBe(false);
  });

  it('computes the next absolute Dhaka closing instant', () => {
    expect(nextDhakaClosingInstant(new Date('2026-08-20T13:59:59Z'), 20).toISOString()).toBe('2026-08-20T14:00:00.000Z');
    expect(nextDhakaClosingInstant(new Date('2026-08-20T14:00:00Z'), 20).toISOString()).toBe('2026-08-21T14:00:00.000Z');
  });

  it('converts the absolute close to the current device wall clock', () => {
    const now = new Date('2026-08-20T12:00:00Z');
    const next = nextDhakaClosingInstant(now, 20);
    expect(deviceDailyTriggerForDhakaClosing(now, 20)).toEqual({
      hour: next.getHours(),
      minute: next.getMinutes(),
    });
  });
});
