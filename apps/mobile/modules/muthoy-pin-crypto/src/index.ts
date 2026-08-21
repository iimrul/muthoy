import { requireNativeModule } from 'expo';

interface MuthoyPinCryptoNativeModule {
  hashPinAsync(rawPin: string, cost: number): Promise<string>;
  verifyPinAsync(rawPin: string, hash: string): Promise<boolean>;
  createLookupTagAsync(rawPin: string): Promise<string>;
}

let nativeModule: MuthoyPinCryptoNativeModule | null = null;

function requireModule(): MuthoyPinCryptoNativeModule {
  nativeModule ??= requireNativeModule<MuthoyPinCryptoNativeModule>('MuthoyPinCrypto');
  return nativeModule;
}

export function hashPinNative(rawPin: string, cost: number): Promise<string> {
  return requireModule().hashPinAsync(rawPin, cost);
}

export function verifyPinNative(rawPin: string, hash: string): Promise<boolean> {
  return requireModule().verifyPinAsync(rawPin, hash);
}

export function createPinLookupTagNative(rawPin: string): Promise<string> {
  return requireModule().createLookupTagAsync(rawPin);
}
