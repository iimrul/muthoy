// RETIRED, not deleted (W4-06).
//
// This module used to hold evaluateBasicAuth: a single shared
// ADMIN_BASIC_AUTH_USER/PASSWORD pair, replayed by the browser on every
// request, with no identity, no role, no session, no logout, no lockout and no
// record of who looked at or changed anything. W4-06 replaced it with a signed
// session (lib/adminSession.ts), per-account credentials (lib/adminIdentity.ts)
// and a role table (lib/adminRoles.ts).
//
// What survives is constantTimeEquals, which is now used in two places that
// matter more than Basic Auth ever did: the password comparison in
// lib/adminLogin.ts and the session-signature comparison in
// lib/adminSession.ts. It stays here rather than moving so the one primitive
// the panel's auth depends on keeps its tests and its history.
//
// Framework-free and EDGE-SAFE: lib/adminSession.ts imports it, and that runs
// in the middleware.

/**
 * Byte-by-byte comparison that never short-circuits, so response timing does
 * not leak how many leading characters of a password or signature were correct.
 */
export function constantTimeEquals(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);

  if (left.length !== right.length) {
    return false;
  }

  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}
