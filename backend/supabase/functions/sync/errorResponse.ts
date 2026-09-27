import type { Caller } from './_shared/auth.ts';

export function httpErrorBody(
  error: Error & { code?: string; details?: Record<string, unknown> },
  caller?: Caller,
): Record<string, unknown> {
  if (!error.code) return { error: error.message };
  const verifiedIdentity = caller?.appUserId && caller.shopId
    ? { actorUserId: caller.appUserId, shopId: caller.shopId }
    : {};
  // A2.3. `details` carries the device authority snapshot on a device refusal,
  // and nothing else. Spread FIRST so it can never overwrite the message, the
  // code, or the verified identity: a snapshot is evidence the device must
  // persist, not a place from which to redefine who the caller is.
  return {
    ...(error.details ?? {}),
    error: error.message,
    code: error.code,
    ...verifiedIdentity,
  };
}
