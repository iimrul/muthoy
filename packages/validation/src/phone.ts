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

/** What people and phones put between digits: spaces, dashes, dots, brackets. */
const NUMBER_SEPARATORS = /[\s().-]/g;

/** The subscriber digits so far: 1, an operator digit 3-9, then up to eight more. */
const SUBSCRIBER_SO_FAR = /^(?:1(?:[3-9]\d{0,8})?)?$/;

/** A Bangladeshi mobile number as far as it has been entered. */
export interface BdPhoneEntry {
  /** The entry with separators removed. */
  compact: string;
  /** The subscriber digits entered so far: '' before the first, ten when complete. */
  national: string;
}

/**
 * Reads an ENTERED number — complete or still being typed — as one of the
 * four accepted forms: `017…` (trunk 0), `17…` (after a fixed +880), `880…`
 * and `+880…`, each followed directly by the subscriber digits. Null when the
 * text cannot become a Bangladeshi mobile number as written.
 *
 * Nothing is removed to make it fit except ordinary separators. Letters, a '+'
 * anywhere but in front, a country code other than 880 (`+1…`, `+91…`,
 * `+0…`), a trunk 0 after the country code (`+880 017…`), a doubled prefix
 * (`880880…`, `0017…`) and a digit too many are all null. This is the ONE
 * rule set: normalizeBdPhoneInput is built on it, and so is PhoneField's
 * handling of every keystroke, paste and autofill.
 */
export function parseBdPhoneInput(value: string | null | undefined): BdPhoneEntry | null {
  if (typeof value !== 'string') {
    return null;
  }
  const compact = value.trim().replace(NUMBER_SEPARATORS, '');
  if (!/^\+?\d*$/.test(compact)) {
    return null;
  }
  const national = subscriberDigitsOf(compact);
  return national === null ? null : { compact, national };
}

function subscriberDigitsOf(compact: string): string | null {
  if (compact.startsWith('+')) {
    return afterCountryCode(compact.slice(1));
  }
  if (compact.startsWith('8')) {
    return afterCountryCode(compact);
  }
  const subscriber = compact.startsWith('0') ? compact.slice(1) : compact;
  return SUBSCRIBER_SO_FAR.test(subscriber) ? subscriber : null;
}

/** The subscriber digits after Bangladesh's country code — or '' while 880 itself is still being typed. */
function afterCountryCode(digits: string): string | null {
  if (digits.length <= 3) {
    return '880'.startsWith(digits) ? '' : null;
  }
  if (!digits.startsWith('880')) {
    return null;
  }
  const subscriber = digits.slice(3);
  return SUBSCRIBER_SO_FAR.test(subscriber) ? subscriber : null;
}

/**
 * normalizeBdPhone for a number a person has just ENTERED at an auth
 * boundary: the canonical `+8801…` form of a COMPLETE entry that
 * parseBdPhoneInput accepts, null for anything else.
 *
 * Deliberately a separate function. normalizeBdPhone is the storage and
 * lookup contract (unique index, lockout key) and stays exactly as it is.
 * This one also accepts `17…` — what gets typed after a field's fixed "+880"
 * — and is stricter about shape: an explicit '+' code is taken as written,
 * and nothing but separators is ever dropped to make a number fit.
 */
export function normalizeBdPhoneInput(value: string | null | undefined): string | null {
  const entry = parseBdPhoneInput(value);
  return entry !== null && entry.national.length === 10 ? `${CANONICAL_PREFIX}${entry.national}` : null;
}
