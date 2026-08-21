import * as bcrypt from 'bcryptjs';
import { createHmac } from 'node:crypto';

const TEST_LOOKUP_KEY = 'unit-test-only-pin-lookup-key';
const counters = { hash: 0, verify: 0, lookupTag: 0 };

export function resetNativeCryptoTestCounters(): void {
  counters.hash = 0;
  counters.verify = 0;
  counters.lookupTag = 0;
}

export function getNativeCryptoTestCounters(): Readonly<typeof counters> {
  return { ...counters };
}

export function hashPinNative(rawPin: string, cost: number): Promise<string> {
  counters.hash += 1;
  return bcrypt.hash(rawPin, cost);
}

export function verifyPinNative(rawPin: string, hash: string): Promise<boolean> {
  counters.verify += 1;
  return bcrypt.compare(rawPin, hash);
}

export async function createPinLookupTagNative(rawPin: string): Promise<string> {
  counters.lookupTag += 1;
  return createHmac('sha256', TEST_LOOKUP_KEY)
    .update('muthoy:device-pin-lookup:v1')
    .update('\0')
    .update(rawPin)
    .digest('base64url');
}
