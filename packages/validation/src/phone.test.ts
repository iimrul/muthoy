import { describe, expect, it } from 'vitest';
import { isSameBdPhone, normalizeBdPhone, normalizeBdPhoneInput, parseBdPhoneInput } from './phone';

// Phone is a CREDENTIAL: it names the account on a fresh device, it carries a
// unique index, and it keys the login lockout. Everything here is about the two
// ways that went wrong before it was canonicalised — one subscriber holding
// several accounts, and one attacker holding several attempt budgets.

const CANONICAL = '+8801712345678';

describe('normalizeBdPhone', () => {
  it.each([
    ['local, as most people type it', '01712345678'],
    ['country code without the plus, as Supabase stores a verified phone', '8801712345678'],
    ['full E.164', '+8801712345678'],
    ['pasted with spaces and a dash', ' +880 1712-345678 '],
    ['spaced country-code form', '880 1712 345678'],
  ])('%s resolves to the one canonical form', (_label, input) => {
    expect(normalizeBdPhone(input)).toBe(CANONICAL);
  });

  it.each([
    ['a foreign number whose last ten digits collide', '+911712345678'],
    ['too short', '0171234567'],
    ['too long', '017123456789'],
    ['an operator prefix Bangladesh does not issue', '01212345678'],
    ['letters', 'not-a-number'],
    ['empty', ''],
  ])('%s has no canonical form', (_label, input) => {
    expect(normalizeBdPhone(input)).toBeNull();
  });

  it('returns null rather than throwing for a missing value', () => {
    // Callers each answer a bad number differently — an inline field error, a
    // generic login refusal, a rejected sync row — and none of them wants an
    // exception unwinding through.
    expect(normalizeBdPhone(null)).toBeNull();
    expect(normalizeBdPhone(undefined)).toBeNull();
  });
});

describe('isSameBdPhone', () => {
  it('matches the same subscriber written three different ways', () => {
    expect(isSameBdPhone('01712345678', '+8801712345678')).toBe(true);
    expect(isSameBdPhone('8801712345678', '01712345678')).toBe(true);
  });

  it('does NOT match a foreign number sharing the last ten digits', () => {
    // The bug this replaced: owner PIN recovery compared the last 10 digits, so
    // an attacker could OTP-verify their own Indian number and use it to
    // recover a Bangladeshi owner's account.
    expect(isSameBdPhone('+911712345678', '+8801712345678')).toBe(false);
  });

  it('treats two unparseable values as different, not as equal nulls', () => {
    // Otherwise every invalid input would match every other one, and a
    // comparison against a MISSING verified phone would silently pass.
    expect(isSameBdPhone(null, null)).toBe(false);
    expect(isSameBdPhone('rubbish', 'rubbish')).toBe(false);
  });
});

describe('normalizeBdPhoneInput (auth entry boundary)', () => {
  it.each([
    ['local 017…', '01712345678'],
    ['national without the trunk 0, as typed after a fixed +880', '1712345678'],
    ['country code without the plus', '8801712345678'],
    ['full E.164', '+8801712345678'],
    ['pasted with spaces', ' +880 1712-345678 '],
    ['national with spacing', '1712 345678'],
    ['+88 followed by the local number', '+88 01712345678'],
    ['local, bracketed and dashed', '(017) 1234-5678'],
  ])('%s resolves to the canonical form', (_label, input) => {
    expect(normalizeBdPhoneInput(input)).toBe(CANONICAL);
  });

  it.each([
    ['a foreign number whose last ten digits collide', '+911712345678'],
    ['a plus-prefixed bare national number (a foreign code)', '+1712345678'],
    ['national, too short', '171234567'],
    ['national, too long', '17123456789'],
    ['an operator prefix Bangladesh does not issue', '1212345678'],
    ['letters', 'not-a-number'],
    ['empty', ''],
    ['missing', undefined],
    // An explicit '+' is validated as written, never re-read as Bangladeshi.
    ['a bracketed foreign code', '(+1) 712345678'],
    ['a spaced foreign code', '+ 1712345678'],
    ['a code that does not exist', '+0 1712345678'],
    ['a plus in the middle', '017+12345678'],
    ['a scheme prefix', 'tel:+8801712345678'],
    ['an international dialling prefix', '00880 1712345678'],
    ['a local number with a digit too many (never cut to fit)', '017123456789'],
    // Malformed +880, embedded '+', letters and doubled prefixes: never cleaned up.
    ['a trunk 0 after +880', '+88001712345678'],
    ['a second + after the code', '+880+1712345678'],
    ['letters inside the digits', '017abc12345678'],
    ['a letter O for the zero', 'O1712345678'],
    ['the country code twice', '880880 1712345678'],
    ['+880 then the country code again', '+880880 1712345678'],
    ['a doubled trunk 0', '0017 1234 5678'],
    ['an operator digit Bangladesh does not issue, after +880', '+8801212345678'],
  ])('%s is rejected', (_label, input) => {
    expect(normalizeBdPhoneInput(input)).toBeNull();
  });

  it('leaves the storage/lookup normalizer as narrow as it was', () => {
    // The lockout key and unique index keep their exact contract.
    expect(normalizeBdPhone('1712345678')).toBeNull();
  });
});

// The one rule set PhoneField reads every keystroke with. A number still being
// typed is readable as far as it goes; anything that could never become a
// valid number as written is null — so the field has nothing to "clean up".
describe('parseBdPhoneInput (an entry as far as it has been typed)', () => {
  const FORMS = ['01712345678', '1712345678', '8801712345678', '+8801712345678'];

  it.each(FORMS)('reads every prefix of %s as a number on its way', (complete) => {
    for (let length = 0; length <= complete.length; length += 1) {
      const typed = complete.slice(0, length);
      const entry = parseBdPhoneInput(typed);
      expect(entry, `"${typed}"`).not.toBeNull();
      expect('1712345678'.startsWith(entry!.national), `"${typed}"`).toBe(true);
    }
    expect(parseBdPhoneInput(complete)?.national).toBe('1712345678');
  });

  it.each([
    '+88001712345678',
    '+880+1712345678',
    '017abc12345678',
    '880880 1712345678',
    '0017',
    '+1',
    '+91',
    '881',
    '012',
    '017123456789',
  ])('cannot read %j as a Bangladeshi number in any accepted form', (value) => {
    expect(parseBdPhoneInput(value)).toBeNull();
  });

  it('is the rule normalizeBdPhoneInput completes: canonical exactly when ten subscriber digits are read', () => {
    const corpus = [
      ...FORMS,
      ' +880 1712-345678 ',
      '+88 01712345678',
      '(017) 1234-5678',
      '0171',
      '+880',
      '+88001712345678',
      '+880+1712345678',
      '017abc12345678',
      '+1712345678',
      '017123456789',
    ];
    for (const value of corpus) {
      const entry = parseBdPhoneInput(value);
      const expected = entry !== null && entry.national.length === 10 ? `+880${entry.national}` : null;
      expect(normalizeBdPhoneInput(value), `"${value}"`).toBe(expected);
    }
  });
});
