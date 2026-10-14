import Constants from 'expo-constants';
import { digestStringAsync, CryptoDigestAlgorithm } from 'expo-crypto';
import { publicEnvironment } from '../config/publicEnvironment';
import { EnvironmentRefusalError, validatePublicEnvironment, validatePublicKeyFingerprint, type EnvironmentBinding } from '../config/environmentPolicy';

export { EnvironmentRefusalError };

/** Synchronous configuration validity is not permission to restore credentials. */
export function readEnvironmentConfiguration(): EnvironmentBinding {
  try {
    const config = Constants.expoConfig;
    const extra = config?.extra;
    const identity = validatePublicEnvironment(extra?.appVariant, publicEnvironment.url, publicEnvironment.publicKey);
    if (extra?.nativeApplicationId !== identity.nativeApplicationId || extra?.supabaseProjectRef !== identity.supabaseProjectRef || extra?.environmentPolicyVersion !== identity.policyVersion) {
      throw new EnvironmentRefusalError('configuration-invalid');
    }
    if (config?.android?.package !== identity.nativeApplicationId || config?.ios?.bundleIdentifier !== identity.nativeApplicationId) {
      throw new EnvironmentRefusalError('native-identity-invalid');
    }
    return { appVariant: identity.appVariant, nativeApplicationId: identity.nativeApplicationId, supabaseProjectRef: identity.supabaseProjectRef, version: identity.version };
  } catch (error) {
    if (error instanceof EnvironmentRefusalError) throw error;
    throw new EnvironmentRefusalError('native-identity-invalid');
  }
}

export async function verifyEnvironmentIdentity(): Promise<EnvironmentBinding> {
  const identity = readEnvironmentConfiguration();
  try {
    // An older native client may lack the new module. Refuse with localized
    // startup copy instead of throwing an import-time native exception.
    const { applicationId } = await import('expo-application');
    if (!applicationId || applicationId !== identity.nativeApplicationId) throw new Error();
  } catch { throw new EnvironmentRefusalError('native-identity-invalid'); }
  try {
    const hash = await digestStringAsync(CryptoDigestAlgorithm.SHA256, publicEnvironment.publicKey);
    validatePublicKeyFingerprint(identity.appVariant, hash);
    return identity;
  } catch { throw new EnvironmentRefusalError('configuration-invalid'); }
}
