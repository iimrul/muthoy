import { describe, expect, it } from 'vitest';
import { isSameBdPhone, normalizeBdPhone } from './phone';

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
