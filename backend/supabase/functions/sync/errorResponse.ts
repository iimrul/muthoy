import type { Caller } from './_shared/auth.ts';

export function httpErrorBody(
  error: Error & { code?: string; details?: Record<string, unknown> },
  caller?: Caller,
): Record<string, unknown> {
  if (!error.code) return { error: error.message };
  const verifiedIdentity = caller?.appUserId && caller.shopId
    ? { actorUserId: caller.appUserId, shopId: caller.shopId }
    : {};
  // A2.3 authority details and the post-commit, server-derived recoveryShopId
  // spread FIRST. Neither can overwrite the verified caller's actor/shop or
  // the error code. Recovery's target is deliberately NOT called shopId.
  return {
    ...(error.details ?? {}),
    error: error.message,
    code: error.code,
    ...verifiedIdentity,
  };
}
