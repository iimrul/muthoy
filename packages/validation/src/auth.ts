import { z } from 'zod';

// Bangladeshi mobile format: 11 digits starting 01[3-9], optionally prefixed
// with the country code (+880 or 880). Assumption, not specced in Volume 4 —
// flagged in the Day 4-5/11 auth plan, cheap to correct if wrong.
const BD_PHONE_REGEX = /^(?:\+?88)?01[3-9]\d{8}$/;

export const bdPhoneSchema = z
  .string()
  .trim()
  .regex(BD_PHONE_REGEX, 'Enter a valid Bangladeshi mobile number (e.g. 01712345678)');

// Every PIN field in the app is exactly 4 digits (Volume 4 AUTHENTICATION's
// dots+keypad pattern assumes a fixed-length PIN).
export const pinDigitsSchema = z.string().regex(/^\d{4}$/, 'PIN must be exactly 4 digits');

// Supabase phone verification codes are exactly six numeric digits.
export const otpCodeSchema = z.string().regex(/^\d{6}$/, 'Verification code must be exactly 6 digits');

export const registerSchema = z.object({
  shopName: z.string().trim().min(2, 'Shop name is too short'),
  phone: bdPhoneSchema,
});
export type RegisterInput = z.infer<typeof registerSchema>;

// PIN Setup asks for the PIN twice — not specced in Volume 4, added so a
// bcrypt-hashed typo can't lock the owner out of a fresh registration.
export const pinSetupSchema = z
  .object({
    pin: pinDigitsSchema,
    confirmPin: pinDigitsSchema,
  })
  .refine((data) => data.pin === data.confirmPin, {
    message: 'PINs do not match',
    path: ['confirmPin'],
  });
export type PinSetupInput = z.infer<typeof pinSetupSchema>;

// Phone is REQUIRED for staff since migration 0007. It stopped being contact
// detail and became a credential: it is what a staff member types on a FRESH
// device, before that device has any rows to match a PIN against. Volume 4's
// "Staff... never needs a phone number" held while the shop shared one handset;
// staff-owned devices cannot work that way, because nothing else identifies the
// account ahead of hydration.
export const createStaffSchema = z.object({
  name: z.string().trim().min(2, 'Name is too short'),
  phone: bdPhoneSchema,
  pin: pinDigitsSchema,
  confirmPin: pinDigitsSchema,
}).refine((data) => data.pin === data.confirmPin, {
  message: 'PINs do not match',
  path: ['confirmPin'],
});
export type CreateStaffInput = z.infer<typeof createStaffSchema>;

// Phone + PIN: the ONLY login on a device with no local data yet, for owner and
// staff alike. No OTP — staff have never had a number to receive one at, and an
// owner's routine login must not wait on an SMS.
export const deviceLoginSchema = z.object({
  phone: bdPhoneSchema,
  pin: pinDigitsSchema,
});
export type DeviceLoginInput = z.infer<typeof deviceLoginSchema>;

// Owner-only PIN recovery: the one place OTP survives after registration. The
// PIN is what was lost, so the phone number has to be re-proved some other way
// before a new one can be set.
export const recoverPinSchema = z
  .object({
    phone: bdPhoneSchema,
    newPin: pinDigitsSchema,
    confirmNewPin: pinDigitsSchema,
  })
  .refine((data) => data.newPin === data.confirmNewPin, {
    message: 'PINs do not match',
    path: ['confirmNewPin'],
  });
export type RecoverPinInput = z.infer<typeof recoverPinSchema>;

// Reused for both "owner changes own PIN" and "owner resets a staff PIN" —
// the latter simply has no currentPin field (the owner isn't proving the
// staff member's PIN, they're overriding it).
export const changeOwnPinSchema = z
  .object({
    currentPin: pinDigitsSchema,
    newPin: pinDigitsSchema,
    confirmNewPin: pinDigitsSchema,
  })
  .refine((data) => data.newPin === data.confirmNewPin, {
    message: 'PINs do not match',
    path: ['confirmNewPin'],
  });
export type ChangeOwnPinInput = z.infer<typeof changeOwnPinSchema>;

export const resetStaffPinSchema = z
  .object({
    newPin: pinDigitsSchema,
    confirmNewPin: pinDigitsSchema,
  })
  .refine((data) => data.newPin === data.confirmNewPin, {
    message: 'PINs do not match',
    path: ['confirmNewPin'],
  });
export type ResetStaffPinInput = z.infer<typeof resetStaffPinSchema>;
