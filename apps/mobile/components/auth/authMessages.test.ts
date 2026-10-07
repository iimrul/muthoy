import { describe, expect, it } from 'vitest';
import {
  OTP_EXPIRY_SECONDS,
  OTP_RESEND_COOLDOWN_SECONDS,
  OtpCodeRejectedError,
  OtpRateLimitedError,
  OtpSendFailedError,
  OtpVerifyFailedError,
} from '../../sync/otpPolicy';
import { catalog } from '../../i18n/catalog';
import { otpSendErrorKey, otpVerifyErrorKey } from './authMessages';

// H-5. What an OTP screen says, decided from the typed failures sync/otp.ts
// raises — never from a message's wording.

const SENT_AT = 1_800_000_000_000;

describe('a send or resend that succeeded', () => {
  // Success only means Supabase took the request. The SMS may be late, its
  // outcome unknown to the hook (pending or ambiguous), or — for a number with
  // no account — the code may lead nowhere. The copy must hold in every case.
  const SUCCESS_COPY = ['otpCheckMessages', 'otpResendRequested'] as const;

  it.each(['en', 'bn'] as const)('never claims an SMS was sent or delivered (%s)', (locale) => {
    for (const key of SUCCESS_COPY) {
      expect(catalog[locale][key]).not.toMatch(/\b(?:sent|delivered|texted)\b|পাঠিয়েছি|পাঠানো হয়েছে|পৌঁছেছে/i);
    }
  });

  it.each(['en', 'bn'] as const)('never mentions an account or a registered number (%s)', (locale) => {
    for (const key of SUCCESS_COPY) {
      expect(catalog[locale][key]).not.toMatch(/account|registered|অ্যাকাউন্ট|নিবন্ধিত/i);
    }
  });

  it('points to the messages and says the code may take a moment, in both languages', () => {
    expect(catalog.en.otpCheckMessages).toBe(
      'Check your messages for a verification code. It may take a moment to arrive.',
    );
    expect(catalog.bn.otpCheckMessages).toBe(
      'যাচাই কোডের জন্য আপনার মেসেজ দেখুন। কোডটি আসতে একটু সময় লাগতে পারে।',
    );
  });
});

describe('the locked OTP timing', () => {
  it('mirrors the hosted Supabase settings: five-minute codes, one-minute resend', () => {
    expect(OTP_EXPIRY_SECONDS).toBe(300);
    expect(OTP_RESEND_COOLDOWN_SECONDS).toBe(60);
  });
});

describe('a failed send or resend', () => {
  it('names a rate limit, the one failure where waiting is the answer', () => {
    expect(otpSendErrorKey(new OtpRateLimitedError())).toBe('otpRateLimited');
    expect(otpSendErrorKey(new OtpRateLimitedError(), 'otpResendFailed')).toBe('otpRateLimited');
  });

  it.each([
    ['a failed send', new OtpSendFailedError()],
    ['an untyped error', new Error('anything')],
    ['a non-error', 'boom'],
  ])('reads %s as the one generic failure, so no number is revealed as registered', (_label, cause) => {
    expect(otpSendErrorKey(cause)).toBe('otpSendFailed');
    expect(otpSendErrorKey(cause, 'otpResendFailed')).toBe('otpResendFailed');
  });
});

describe('a failed verification', () => {
  const lifetime = OTP_EXPIRY_SECONDS * 1000;

  it('calls a refused code incorrect while it can still be valid', () => {
    expect(otpVerifyErrorKey(new OtpCodeRejectedError(), SENT_AT, SENT_AT + 5_000)).toBe('otpIncorrect');
    expect(otpVerifyErrorKey(new OtpCodeRejectedError(), SENT_AT, SENT_AT + lifetime - 1)).toBe('otpIncorrect');
  });

  it('calls a refused code expired from the moment its lifetime ends', () => {
    expect(otpVerifyErrorKey(new OtpCodeRejectedError(), SENT_AT, SENT_AT + lifetime)).toBe('otpExpired');
    expect(otpVerifyErrorKey(new OtpCodeRejectedError(), SENT_AT, SENT_AT + 20 * 60_000)).toBe('otpExpired');
  });

  it('calls a refused code incorrect when the send time is unknown', () => {
    expect(otpVerifyErrorKey(new OtpCodeRejectedError(), null, SENT_AT)).toBe('otpIncorrect');
  });

  it('names a rate limit', () => {
    expect(otpVerifyErrorKey(new OtpRateLimitedError(), SENT_AT, SENT_AT)).toBe('otpRateLimited');
  });

  it.each([
    ['a check that never reached the server', new OtpVerifyFailedError()],
    ['an untyped error', new Error('network')],
  ])('never calls %s a wrong code', (_label, cause) => {
    expect(otpVerifyErrorKey(cause, SENT_AT, SENT_AT + lifetime * 2)).toBe('otpVerifyFailed');
  });
});
