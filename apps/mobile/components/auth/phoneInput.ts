// components/auth/phoneInput.ts — what PhoneField does with keystrokes.
//
// The field shows a fixed "+880" and takes the rest as digits, the way the
// prototype does. Pure and framework-free so the rules are tested directly.
//
// It follows EXACTLY the rules of normalizeBdPhoneInput: both read the entry
// through parseBdPhoneInput (packages/validation/src/phone.ts). A number that
// is, or is on its way to being, a Bangladeshi mobile number in an accepted
// form (017…, 17…, 880…, +880…) is reported in the canonical `+880…` form —
// the form an SMS provider needs, so a screen never has to know which one was
// typed. Anything else — letters, an embedded or foreign '+', a trunk 0 after
// +880, a doubled prefix, a digit too many — is shown and reported exactly as
// typed, for the caller's Zod schema to reject. Only ordinary separators are
// ever dropped; nothing else is removed to make a number fit.
//
// The field is not the only way a number reaches an auth call — route params
// (Device Login → Forgot PIN, Registration → OTP, a resumed registration) and
// submit handlers carry one too. Every such boundary goes through
// authPhoneForSubmit / phoneFieldValueFrom below, and sync/otp.ts checks once
// more before the SMS provider, so no path depends on PhoneField having run.

import { normalizeBdPhoneInput, parseBdPhoneInput, type BdPhoneEntry } from '@muthoy/validation';

const COUNTRY_PREFIX = '+880';
/** "01XXXXXXXXX": past this length an 880… entry is shown without its code. */
const LONGEST_LOCAL_FORM = 11;
/** A half-typed number exactly as a PhoneField reports it: "+880" and up to ten more digits. */
const FIELD_PARTIAL_VALUE = /^\+880\d{0,10}$/;

export interface PhoneFieldEntry {
  /** What the field shows after its fixed "+880". */
  shown: string;
  /** What the field reports to its screen. */
  reported: string;
}

function shownDigitsOf(entry: BdPhoneEntry): string {
  // An explicit +880 is the field's own prefix; so is 880 once the entry has
  // grown past the longest local form. Otherwise the digits, as typed.
  if (entry.compact.startsWith(COUNTRY_PREFIX)) {
    return entry.national;
  }
  if (entry.compact.startsWith('880') && entry.compact.length > LONGEST_LOCAL_FORM) {
    return entry.national;
  }
  return entry.compact;
}

/**
 * What PhoneField keeps from a keystroke, a paste or an autofill.
 *
 * A valid entry reports `+880` + the subscriber digits so far (exactly what is
 * shown, before the first one); an entry parseBdPhoneInput cannot read is
 * shown and reported as typed.
 */
export function phoneFieldEntryFromInput(text: string): PhoneFieldEntry {
  const entry = parseBdPhoneInput(text);
  if (entry === null) {
    const raw = text.trim();
    return { shown: raw, reported: raw };
  }
  const shown = shownDigitsOf(entry);
  return { shown, reported: entry.national === '' ? shown : `${COUNTRY_PREFIX}${entry.national}` };
}

/**
 * PhoneField's change handler, pure: the entry for `text`, or null to refuse
 * the change. Typing on past a complete number is refused, the way a length
 * limit refuses it — the extra key never lands. Cutting it off afterwards
 * instead would also cut a pasted number into one nobody typed.
 */
export function phoneFieldEntryAfterChange(previousShown: string, text: string): PhoneFieldEntry | null {
  const typedPastComplete =
    text.length > previousShown.length &&
    text.startsWith(previousShown) &&
    normalizeBdPhoneInput(previousShown) !== null;
  return typedPastComplete ? null : phoneFieldEntryFromInput(text);
}

/** What the field shows for a value it did not produce itself (a prefill). */
export function displayDigitsFromValue(value: string): string {
  return phoneFieldEntryFromInput(value).shown;
}

/** "+880 1712-345678" for a valid Bangladeshi number; anything else is shown as given. */
export function formatPhoneForDisplay(value: string): string {
  const canonical = normalizeBdPhoneInput(value);
  if (!canonical) {
    return value;
  }
  const national = canonical.slice(COUNTRY_PREFIX.length);
  return `${COUNTRY_PREFIX} ${national.slice(0, 4)}-${national.slice(4)}`;
}

/**
 * What an auth boundary validates and sends: the canonical `+8801…` form when
 * the value is a Bangladeshi mobile number in any accepted spelling (017…,
 * 17…, 880…, +880…), otherwise the value unchanged — so the caller's Zod
 * schema still rejects it with its usual, localized message.
 */
export function authPhoneForSubmit(value: string | null | undefined): string {
  return normalizeBdPhoneInput(value) ?? (value ?? '').trim();
}

/**
 * A number arriving from outside the field (a route param, a prefill).
 *
 * A valid Bangladeshi number in any accepted spelling becomes the canonical
 * form. A half-typed one exactly as a PhoneField reports it ('+880…') is kept,
 * so an owner who tapped "Forgot PIN" mid-number can finish it. Anything else
 * — a foreign country code, stray characters, digits a prefill would have to
 * cut — prefills nothing: rejected, never reinterpreted as Bangladeshi.
 */
export function phoneFieldValueFrom(value: string | null | undefined): string {
  if (typeof value !== 'string') {
    return '';
  }
  const canonical = normalizeBdPhoneInput(value);
  if (canonical) {
    return canonical;
  }
  const trimmed = value.trim();
  return FIELD_PARTIAL_VALUE.test(trimmed) ? trimmed : '';
}
