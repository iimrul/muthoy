export type AppVariant = 'development' | 'preview' | 'production';
export type EnvironmentRefusalCode = 'configuration-invalid' | 'native-identity-invalid' | 'unclassified-data' | 'binding-mismatch' | 'inspection-failed' | 'binding-write-failed';
export interface EnvironmentBinding { appVariant: AppVariant; nativeApplicationId: string; supabaseProjectRef: string; version: number }
export interface EnvironmentPolicy { displayName: string; nativeApplicationId: string; scheme: string; supabaseProjectRef: string | null; publicKeySha256: readonly string[] }
export type EnvironmentPolicies = Readonly<Record<AppVariant, EnvironmentPolicy>>;
export const POLICY_VERSION: number;
export const BINDING_VERSION: number;
export const DEV_PROJECT_REF: string;
export const ENVIRONMENT_POLICIES: EnvironmentPolicies;
export class EnvironmentRefusalError extends Error { readonly code: EnvironmentRefusalCode; constructor(code: EnvironmentRefusalCode) }
export function selectEnvironment(variant: unknown, policies?: EnvironmentPolicies): EnvironmentPolicy;
export function validatePublicEnvironment(variant: unknown, url: unknown, publicKey: unknown, policies?: EnvironmentPolicies): EnvironmentBinding & { keyKind: 'legacy' | 'publishable'; policyVersion: number };
export function validatePublicKeyFingerprint(variant: unknown, fingerprint: string, policies?: EnvironmentPolicies): void;
export function validateBuildProfile(profile: string, variant: unknown, easConfig: object): string;
