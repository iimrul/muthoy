import { describe, expect, it } from 'vitest';
import { businessDateDifference, dhakaBusinessDate } from './businessDate';

describe('Dhaka business dates', () => {
  it('rolls over at Asia/Dhaka midnight', () => {
    expect(dhakaBusinessDate(new Date('2026-08-20T17:59:59Z'))).toBe('2026-08-20');
    expect(dhakaBusinessDate(new Date('2026-08-20T18:00:00Z'))).toBe('2026-08-21');
  });
  it('computes calendar-day distance', () => expect(businessDateDifference('2026-09-01', '2026-08-21')).toBe(11));
});
