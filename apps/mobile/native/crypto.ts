import * as bcrypt from 'bcryptjs';
import { getRandomBytes } from 'expo-crypto';

// native/crypto.ts — the ONLY file that hashes or verifies a PIN.
// CLAUDE.md rule 8: PINs are bcrypt-hashed, never logged or stored in plain
// text — this file is the sole place a raw PIN is ever handed to a hashing
// function; callers must not log its arguments.
//
// db/auth.ts and db/staff.ts call ONLY these two functions — never bcrypt
// directly — so their SQL logic stays unit-testable in Node and the hashing
// implementation can change without touching them (it already has once).
//
// WHY bcryptjs (pure JS) rather than a native module:
// react-native-bcrypt-cpp was the original choice, but its Android side was
// never finished by its author — the JNI bridge registering the TurboModule
// with React Native simply doesn't exist upstream, so every call failed with
// "TurboModuleRegistry.getEnforcing('BcryptCpp') could not be found". iOS
// shipped a working registration; Android had no equivalent file at all.
// Patching it in required rebuilding that bridge plus its entire Android
// build configuration (Prefab, STL, CMake targets, codegen wiring). That
// work is kept, unreferenced, at patches/react-native-bcrypt-cpp@0.2.3.patch
// (it is no longer wired into pnpm-workspace.yaml, so it does not apply) in
// case the native route is ever revisited — see DECISIONS.md for the full
// account of what each part of it fixed.
//
// SECURITY — the salt RNG:
// bcryptjs v3 sources salt entropy from Web Crypto, then Node's crypto, and
// THROWS if neither exists. It does NOT silently fall back to Math.random
// (that was v2's behaviour and the reason pure-JS bcrypt had a bad
// reputation). React Native has no global Web Crypto, so without the line
// below every hash call would throw. getRandomBytes() is expo-crypto's
// wrapper over the platform CSPRNG (SecRandomCopyBytes / SecureRandom), so
// salts come from the OS secure source — equivalent to what the native
// module would have used.
bcrypt.setRandomFallback((length: number) => Array.from(getRandomBytes(length)));

// Cost 10 (~2^10 rounds). Deliberately lower than bcrypt's common 12 because
// hashing runs on the JS thread here: 12 costs roughly 1-3s on the low-end
// Android hardware this app targets, which is too slow for a POS login, while
// 10 lands around 300-600ms. Note that for a 4-digit PIN the practical
// defence against an attacker who has stolen the database is the small
// keyspace (10,000 combinations), not the cost factor — that threat is
// addressed by attempt rate-limiting and by encrypting the database at rest
// (SQLCipher, tracked as a pre-pilot requirement in DECISIONS.md), not here.
const BCRYPT_COST_FACTOR = 10;

// The async variants are used on purpose: bcryptjs splits the work into
// chunks scheduled across ticks, so PIN entry doesn't hard-block the UI
// thread the way hashSync/compareSync would.
export async function hashPin(rawPin: string): Promise<string> {
  return bcrypt.hash(rawPin, BCRYPT_COST_FACTOR);
}

export async function verifyPinHash(rawPin: string, hash: string): Promise<boolean> {
  return bcrypt.compare(rawPin, hash);
}
