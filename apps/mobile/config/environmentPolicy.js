// One policy for Node preflight and the native runtime. Keys never live here.
/** @typedef {import('./environmentPolicy').EnvironmentPolicies} EnvironmentPolicies */
/** @typedef {import('./environmentPolicy').EnvironmentRefusalCode} EnvironmentRefusalCode */
// Bundle metadata ↔ policy agreement. A reviewed policy edit may bump this.
const POLICY_VERSION = 1;
// Schema of the binding persisted on the device. Deliberately independent of
// POLICY_VERSION: a policy edit (e.g. the approved PROD identity) must never
// strand existing installations behind a binding mismatch that has no override.
const BINDING_VERSION = 1;
const DEV_PROJECT_REF = 'btfprhticjgeihcngpif';
const DEV_PUBLIC_KEY_SHA256 = '8c231a25bde4192528bf81f94888ee5f5760ec347586d72d644534119a870ec7';
const ENVIRONMENT_POLICIES = Object.freeze({
  development: Object.freeze({ displayName: 'Muthoy POS Dev', nativeApplicationId: 'com.muthoy.pos.dev', scheme: 'muthoy-dev', supabaseProjectRef: DEV_PROJECT_REF, publicKeySha256: Object.freeze([DEV_PUBLIC_KEY_SHA256]) }),
  preview: Object.freeze({ displayName: 'Muthoy POS Preview', nativeApplicationId: 'com.muthoy.pos.preview', scheme: 'muthoy-preview', supabaseProjectRef: DEV_PROJECT_REF, publicKeySha256: Object.freeze([DEV_PUBLIC_KEY_SHA256]) }),
  production: Object.freeze({ displayName: 'Muthoy POS', nativeApplicationId: 'com.muthoy.pos', scheme: 'muthoy', supabaseProjectRef: null, publicKeySha256: Object.freeze([]) }),
});

class EnvironmentRefusalError extends Error {
  /** @param {EnvironmentRefusalCode} code */
  constructor(code) {
    super('Muthoy environment check refused startup.');
    this.name = 'EnvironmentRefusalError';
    this.code = code;
  }
}
function refuse(code = 'configuration-invalid') { throw new EnvironmentRefusalError(code); }
/** @param {unknown} variant @param {EnvironmentPolicies} policies */
function selectEnvironment(variant, policies = ENVIRONMENT_POLICIES) {
  if (typeof variant !== 'string' || !['development', 'preview', 'production'].includes(variant) || !Object.prototype.hasOwnProperty.call(policies, variant)) refuse();
  return policies[variant];
}
function decodeLegacyPayload(key) {
  const parts = key.split('.');
  if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) refuse();
  // Decode for configuration classification only; this does not verify a JWT.
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let bits = 0; let accumulator = 0; const bytes = [];
  for (const char of parts[1].replace(/-/g, '+').replace(/_/g, '/')) {
    const value = alphabet.indexOf(char);
    if (value < 0) refuse();
    accumulator = (accumulator << 6) | value; bits += 6;
    if (bits >= 8) { bits -= 8; bytes.push((accumulator >> bits) & 255); }
  }
  try {
    return JSON.parse(decodeURIComponent(bytes.map(byte => `%${byte.toString(16).padStart(2, '0')}`).join('')));
  } catch { return refuse(); }
}
/** @param {unknown} variant @param {unknown} url @param {unknown} publicKey @param {EnvironmentPolicies} policies */
function validatePublicEnvironment(variant, url, publicKey, policies = ENVIRONMENT_POLICIES) {
  const policy = selectEnvironment(variant, policies);
  if (!policy.supabaseProjectRef || !policy.publicKeySha256.length) refuse();
  if (typeof url !== 'string' || typeof publicKey !== 'string') refuse();
  const expectedUrl = `https://${policy.supabaseProjectRef}.supabase.co`;
  // Exact string equality also rejects userinfo, alternate origins and paths.
  if (url.trim() !== expectedUrl || !publicKey.trim()) refuse();
  const key = publicKey.trim();
  let keyKind;
  if (/^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(key)) {
    keyKind = 'publishable';
  } else {
    const payload = decodeLegacyPayload(key);
    if (!payload || payload.role !== 'anon' || payload.ref !== policy.supabaseProjectRef) refuse();
    keyKind = 'legacy';
  }
  return { appVariant: variant, nativeApplicationId: policy.nativeApplicationId, supabaseProjectRef: policy.supabaseProjectRef, version: BINDING_VERSION, policyVersion: POLICY_VERSION, keyKind };
}
/** @param {unknown} variant @param {string} fingerprint @param {EnvironmentPolicies} policies */
function validatePublicKeyFingerprint(variant, fingerprint, policies = ENVIRONMENT_POLICIES) {
  if (!selectEnvironment(variant, policies).publicKeySha256.includes(fingerprint)) refuse();
}
function validateBuildProfile(profileName, variant, easConfig) {
  const expected = { development: ['development', 'development'], internal: ['preview', 'preview'], production: ['production', 'production'], 'production-smoke': ['production', 'production'] }[profileName];
  const profile = easConfig.build?.[profileName];
  if (!expected || !profile) refuse();
  const base = profile.extends ? easConfig.build?.[profile.extends] : {};
  if (profile.extends && (profileName !== 'production-smoke' || profile.extends !== 'production')) refuse();
  const env = { ...base?.env, ...profile.env };
  if (variant !== expected[0] || env.APP_VARIANT !== variant || (profile.environment ?? base?.environment) !== expected[1]) refuse();
  if (env.EXPO_PUBLIC_SUPABASE_URL !== undefined || env.EXPO_PUBLIC_SUPABASE_ANON_KEY !== undefined) refuse();
  if (easConfig.cli?.requireCommit !== false) refuse();
  return expected[1];
}
module.exports = { POLICY_VERSION, BINDING_VERSION, DEV_PROJECT_REF, ENVIRONMENT_POLICIES, EnvironmentRefusalError, selectEnvironment, validatePublicEnvironment, validatePublicKeyFingerprint, validateBuildProfile };
