import {
  createPinLookupTagNative,
  hashPinNative,
  verifyPinNative,
} from '../modules/muthoy-pin-crypto';

// native/crypto.ts — the ONLY file that hashes or verifies a PIN.
// CLAUDE.md rule 8: PINs are bcrypt-hashed, never logged or stored in plain
// text — this file is the sole place a raw PIN is ever handed to a hashing
// function; callers must not log its arguments.
//
// db/auth.ts and db/staff.ts call ONLY these two functions — never bcrypt
// directly — so their SQL logic stays unit-testable in Node and the hashing
// implementation can change without touching them (it already has once).
//
// Android uses at.favre.lib:bcrypt in a local Expo native module. This keeps
// standard bcrypt compatibility while moving the expensive work off Hermes.
// The module is mandatory and fails closed when absent (including Expo Go).
const BCRYPT_COST_FACTOR = 10;

export async function hashPin(rawPin: string): Promise<string> {
  return hashPinNative(rawPin, BCRYPT_COST_FACTOR);
}

export async function verifyPinHash(rawPin: string, hash: string): Promise<boolean> {
  return verifyPinNative(rawPin, hash);
}

/**
 * Non-recoverable lookup key for O(1) local PIN routing. The HMAC key is
 * generated inside Android Keystore and cannot be exported. The returned tag
 * is local-only and never enters the sync payload.
 */
export async function createPinLookupTag(rawPin: string): Promise<string> {
  return createPinLookupTagNative(rawPin);
}
