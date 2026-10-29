import { describe, expect, it } from 'vitest';
import { assertSyncPayloadIdentity } from './syncPayload';

describe('sync wire identity', () => {
  it('accepts same-shop rows and the shop root', () => {
    expect(() => assertSyncPayloadIdentity('customers', {
      id: 'customer', shop_id: 'shop-A',
    }, { shopId: 'shop-A', rowId: 'customer' })).not.toThrow();
    expect(() => assertSyncPayloadIdentity('shops', {
      id: 'shop-A',
    }, { shopId: 'shop-A', rowId: 'shop-A' })).not.toThrow();
  });

  it.each([
    ['customers', { id: 'row', shop_id: 'shop-B' }],
    ['customers', { id: 'row' }],
    ['shops', { id: 'shop-B' }],
    ['permissions', { id: 'row' }],
  ])('refuses an unbound %s payload', (tableName, payload) => {
    expect(() => assertSyncPayloadIdentity(tableName, payload, {
      shopId: 'shop-A',
    })).toThrow();
  });

  it('requires the envelope row identity and a real permissions parent', () => {
    expect(() => assertSyncPayloadIdentity('customers', {
      id: 'other-row', shop_id: 'shop-A',
    }, { shopId: 'shop-A', rowId: 'row' })).toThrow(/identity/);
    expect(() => assertSyncPayloadIdentity('permissions', {
      id: 'permission', role_id: 'role-A',
    }, { shopId: 'shop-A', rowId: 'permission' })).not.toThrow();
  });
});
