import type { Caller } from './_shared/auth.ts';

export function httpErrorBody(
  error: Error & { code?: string },
  caller?: Caller,
): Record<string, unknown> {
  if (!error.code) return { error: error.message };
  const verifiedIdentity = caller?.appUserId && caller.shopId
    ? { actorUserId: caller.appUserId, shopId: caller.shopId }
    : {};
  return { error: error.message, code: error.code, ...verifiedIdentity };
}
