// packages/validation/src/phone.ts — ONE canonical form for a Bangladeshi
// mobile number, for the whole system.
//
// Phone stopped being contact detail at migration 0007 and became a CREDENTIAL:
// it names the account on a fresh device, it keys the login lockout, and it
// carries a UNIQUE index. Before this file it was stored as typed, which meant
// `01712345678`, `8801712345678` and `+8801712345678` were three different
// strings for one subscriber. That is not cosmetic:
//
//   - the unique index let one person hold several accounts;
//   - an exact-match login lookup refused a number the owner HAD registered,
//     indistinguishably from a wrong PIN;
//   - the lockout counter is keyed on the string, so rotating the three forms
//     bought an attacker three separate attempt budgets against one account.
//
// Everything now normalizes on the way in and on the way to a lookup.

/** The canonical form: '+880' followed by the 10-digit subscriber number. */
const CANONICAL_PREFIX = '+880';

/**
 * The canonical `+8801XXXXXXXXX` form, or null if this is not a Bangladeshi
 * mobile number.
 *
 * Accepts the three forms users and Supabase actually produce — local
 * (`01712345678`), country code without the plus (`8801712345678`, which is
 * what a Supabase-verified phone looks like), and full E.164
 * (`+8801712345678`) — plus any spacing or punctuation, since numbers get
 * pasted and dictated.
 *
 * Returns null rather than throwing: every caller has a different answer for a
 * bad number (an inline field error, a generic login refusal, a rejected sync
 * row), and none of them wants an exception.
 */
export function normalizeBdPhone(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const digits = value.replace(/\D/g, '');

  // Local form: 01[3-9] then 8 more digits.
  if (/^01[3-9]\d{8}$/.test(digits)) {
    return `${CANONICAL_PREFIX}${digits.slice(1)}`;
  }
  // Country code, with or without the '+' the strip above removed.
  if (/^8801[3-9]\d{8}$/.test(digits)) {
    return `${CANONICAL_PREFIX}${digits.slice(3)}`;
  }
  return null;
}

/**
 * Whether two numbers identify the same subscriber.
 *
 * Deliberately NOT a "last N digits" comparison. Owner PIN recovery used to
 * compare the last 10 digits, which made `+91 1712345678` equal to
 * `+880 1712345678`: an attacker could OTP-verify their own foreign number and
 * recover a Bangladeshi owner's account with it. Equality is on the full
 * canonical string, and a number that is not Bangladeshi normalizes to null and
 * therefore matches nothing — including another null.
 */
export function isSameBdPhone(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  const a = normalizeBdPhone(left);
  const b = normalizeBdPhone(right);
  return a !== null && a === b;
}
