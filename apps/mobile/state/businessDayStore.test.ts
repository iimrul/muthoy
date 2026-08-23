import { describe, expect, it } from 'vitest';
import { checkDayRollover, getLastSeenBusinessDate, markBusinessDateSeen } from './businessDayStore';

// B3 Group 2: this service already existed (built for the dashboard's
// previous-day-summary + opening-cash prompt sequence) but had no dedicated
// test file. Each test uses its own shopId — the react-native-mmkv test
// stub (db/test/react-native-mmkv.ts) keeps one process-wide store, so a
// fresh key per test isolates them, the same way cash.sqlite.test.ts uses a
// fresh shop per test.

let shopCounter = 0;
function nextShopId(): string {
  shopCounter += 1;
  return `rollover-shop-${shopCounter}`;
}

describe('checkDayRollover', () => {
  it('yields no prompt on the very first run for a shop (no previous day to summarise)', () => {
    const shopId = nextShopId();
    expect(checkDayRollover(shopId, '2026-08-23')).toEqual({ previousBusinessDate: null, isFirstRun: true });
  });

  it('yields no prompt on the same business date as last seen', () => {
    const shopId = nextShopId();
    markBusinessDateSeen(shopId, '2026-08-23');
    expect(checkDayRollover(shopId, '2026-08-23')).toEqual({ previousBusinessDate: null, isFirstRun: false });
  });

  it('yields exactly one previous-day prompt when local midnight has passed', () => {
    const shopId = nextShopId();
    markBusinessDateSeen(shopId, '2026-08-22');
    expect(checkDayRollover(shopId, '2026-08-23')).toEqual({ previousBusinessDate: '2026-08-22', isFirstRun: false });
  });

  it('stops re-prompting for the same rollover once markBusinessDateSeen is called for the new day', () => {
    const shopId = nextShopId();
    markBusinessDateSeen(shopId, '2026-08-22');
    expect(checkDayRollover(shopId, '2026-08-23').previousBusinessDate).toBe('2026-08-22');

    markBusinessDateSeen(shopId, '2026-08-23');
    expect(checkDayRollover(shopId, '2026-08-23')).toEqual({ previousBusinessDate: null, isFirstRun: false });
  });

  it('treats a stored date in the future as "same day", not a rollover (a clock wound back)', () => {
    const shopId = nextShopId();
    markBusinessDateSeen(shopId, '2026-08-25');
    expect(checkDayRollover(shopId, '2026-08-23')).toEqual({ previousBusinessDate: null, isFirstRun: false });
  });

  it('keeps rollover state isolated per shop — a second owner on the same device never inherits it', () => {
    const shopA = nextShopId();
    const shopB = nextShopId();
    markBusinessDateSeen(shopA, '2026-08-22');

    expect(checkDayRollover(shopB, '2026-08-23')).toEqual({ previousBusinessDate: null, isFirstRun: true });
    expect(getLastSeenBusinessDate(shopB)).toBeNull();
    expect(getLastSeenBusinessDate(shopA)).toBe('2026-08-22');
  });
});

describe('markBusinessDateSeen / getLastSeenBusinessDate', () => {
  it('round-trips the stored date, defaulting to null before anything is written', () => {
    const shopId = nextShopId();
    expect(getLastSeenBusinessDate(shopId)).toBeNull();
    markBusinessDateSeen(shopId, '2026-08-23');
    expect(getLastSeenBusinessDate(shopId)).toBe('2026-08-23');
  });
});
