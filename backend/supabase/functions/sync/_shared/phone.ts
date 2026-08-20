// _shared/phone.ts — the server's copy of the canonical Bangladeshi phone form.
//
// A COPY, deliberately, of packages/validation/src/phone.ts: Deno Edge
// Functions cannot resolve a pnpm workspace package, and the two must not drift.
// device-login.test.ts asserts the two normalizers agree on a shared table of
// inputs, so a change made to one and not the other fails the suite rather than
// silently splitting the login identity in half.
//
// Why this exists at all: phone is a CREDENTIAL here. It names the account on a
// fresh device, it carries a UNIQUE index, and it keys the brute-force lockout.
// Stored as typed, `01712345678`, `8801712345678` and `+8801712345678` were
// three strings for one subscriber — which let one person hold several
// accounts, refused a legitimate login as though the PIN were wrong, and handed
// an attacker three separate lockout budgets against the same account.

const CANONICAL_PREFIX = "+880";

/**
 * The canonical `+8801XXXXXXXXX` form, or null if this is not a Bangladeshi
 * mobile number.
 *
 * Accepts the three forms that actually reach this code: what the user typed,
 * what Supabase stores on a verified phone (`8801712345678`, no plus), and full
 * E.164 — plus any punctuation.
 */
export function normalizeBdPhone(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const digits = value.replace(/\D/g, "");

  if (/^01[3-9]\d{8}$/.test(digits)) {
    return `${CANONICAL_PREFIX}${digits.slice(1)}`;
  }
  if (/^8801[3-9]\d{8}$/.test(digits)) {
    return `${CANONICAL_PREFIX}${digits.slice(3)}`;
  }
  return null;
}

/**
 * Whether two numbers identify the same subscriber.
 *
 * NOT a "last N digits" comparison. Owner PIN recovery used to compare the last
 * 10 digits, which made `+91 1712345678` equal to `+880 1712345678`: an
 * attacker could OTP-verify their own Indian number and use it to recover a
 * Bangladeshi owner's account. Equality is on the FULL canonical string, and a
 * non-Bangladeshi number normalizes to null and therefore matches nothing —
 * including another null.
 */
export function isSameBdPhone(left: unknown, right: unknown): boolean {
  const a = normalizeBdPhone(left);
  const b = normalizeBdPhone(right);
  return a !== null && a === b;
}
