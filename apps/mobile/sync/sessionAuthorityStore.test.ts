import { beforeEach, describe, expect, it } from 'vitest';
import { createMMKV, __resetMMKVStores } from '../db/test/react-native-mmkv';
import {
  advanceSessionAuthorityHighWater,
  confirmSessionAuthority,
  quarantineSessionAuthority,
  readSessionAuthorityLease,
  recoverSessionAuthority,
} from './sessionAuthorityStore';

const SHOP = 'shop-1';
const USER = 'user-1';

beforeEach(() => __resetMMKVStores());

describe('session authority lease storage', () => {
  it('is isolated by both shop and actor', () => {
    confirmSessionAuthority(SHOP, USER, 100);
    expect(readSessionAuthorityLease(SHOP, USER)).toMatchObject({ status: 'valid' });
    expect(readSessionAuthorityLease(SHOP, 'user-2').status).toBe('absent');
    expect(readSessionAuthorityLease('shop-2', USER).status).toBe('absent');
  });

  it('advances but never rolls back its persisted high-water mark', () => {
    confirmSessionAuthority(SHOP, USER, 100);
    advanceSessionAuthorityHighWater(SHOP, USER, 250);
    advanceSessionAuthorityHighWater(SHOP, USER, 200);
    expect(readSessionAuthorityLease(SHOP, USER)).toEqual({
      status: 'valid',
      record: { v: 1, confirmedAtMs: 100, highWaterAtMs: 250, quarantineReason: null },
    });
  });

  it('preserves quarantine through routine confirmation and clears only on recovery', () => {
    confirmSessionAuthority(SHOP, USER, 100);
    quarantineSessionAuthority(SHOP, USER, 'actor_inactive', 200);
    expect(readSessionAuthorityLease(SHOP, USER)).toMatchObject({
      status: 'valid', record: { quarantineReason: 'actor_inactive' },
    });
    confirmSessionAuthority(SHOP, USER, 300);
    expect(readSessionAuthorityLease(SHOP, USER)).toMatchObject({
      status: 'valid', record: { quarantineReason: 'actor_inactive' },
    });
    recoverSessionAuthority(SHOP, USER, 400);
    expect(readSessionAuthorityLease(SHOP, USER)).toMatchObject({
      status: 'valid', record: { confirmedAtMs: 400, quarantineReason: null },
    });
  });

  it.each([
    'not-json',
    '{}',
    '{"v":2,"confirmedAtMs":1,"highWaterAtMs":1,"quarantineReason":null}',
    '{"v":1,"confirmedAtMs":2,"highWaterAtMs":1,"quarantineReason":null}',
    '{"v":1,"confirmedAtMs":1,"highWaterAtMs":1,"quarantineReason":null,"extra":true}',
  ])('fails closed on corrupt persisted data: %s', (raw) => {
    createMMKV({ id: 'muthoy-session-authority' }).set('authority:shop-1:user-1', raw);
    expect(readSessionAuthorityLease(SHOP, USER).status).toBe('corrupt');
  });
});
