import { describe, expect, it } from 'vitest';
import type { Caller } from './_shared/auth.ts';
import { httpErrorBody } from './errorResponse.ts';

const caller = {
  appUserId: 'verified-staff',
  shopId: 'shop-a',
} as Caller;

function controlError(message: string, code: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

describe('verified actor identity on sync control errors', () => {
  it('attaches only the actor/shop from a verified caller', () => {
    expect(httpErrorBody(
      controlError('inactive', 'account_inactive'),
      caller,
    )).toEqual({
      error: 'inactive',
      code: 'account_inactive',
      actorUserId: 'verified-staff',
      shopId: 'shop-a',
    });
  });

  it('never invents an actor for JWT verification failures', () => {
    expect(httpErrorBody(
      controlError('invalid', 'access_invalidated'),
      undefined,
    )).toEqual({ error: 'invalid', code: 'access_invalidated' });
  });
});
