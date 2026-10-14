import { createMMKV } from 'react-native-mmkv';
import { verifyEnvironmentIdentity } from '../native/environmentIdentity';
import { EnvironmentRefusalError, type EnvironmentBinding } from '../config/environmentPolicy';
import { hasDatabaseKey, hasPendingDatabaseKeyRecovery } from './databaseKey';

export const ENVIRONMENT_STORE_IDS = Object.freeze({ binding: 'muthoy-environment-binding', auth: 'muthoy-supabase-auth', session: 'muthoy-session', device: 'muthoy-device-identity', authority: 'muthoy-session-authority', cursor: 'muthoy-sync-cursor' });
export const ENVIRONMENT_BINDING_KEY = 'binding';

interface BindingStore { getAllKeys(): string[]; getString(key: string): string | undefined; set(key: string, value: string): void }
export interface BindingDependencies {
  identity(): Promise<EnvironmentBinding>;
  store(): BindingStore;
  hasArtifacts(): boolean | Promise<boolean>;
  hasKey(): Promise<boolean>;
  hasPendingRecovery(): Promise<boolean>;
  hasCredentials(): boolean;
}

/** Only reads raw stores. Never calls a credential adapter or generates an ID. */
export function hasPersistedEnvironmentCredentials(): boolean {
  for (const id of [ENVIRONMENT_STORE_IDS.auth, ENVIRONMENT_STORE_IDS.authority, ENVIRONMENT_STORE_IDS.cursor]) {
    if (createMMKV({ id }).getAllKeys().length > 0) return true;
  }
  const device = createMMKV({ id: ENVIRONMENT_STORE_IDS.device });
  if (device.getAllKeys().includes('device-id')) return true;
  const session = createMMKV({ id: ENVIRONMENT_STORE_IDS.session });
  if (!session.getAllKeys().includes('session')) return false;
  const serialized = session.getString('session');
  if (serialized === undefined) return true;
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !('state' in parsed) || !('version' in parsed) || parsed.version !== 0) return true;
    const state = parsed.state;
    if (!state || typeof state !== 'object' || !('session' in state) || !('lastShopId' in state)) return true;
    return state.session !== null || state.lastShopId !== null;
  } catch { return true; }
}

export function createEnvironmentBindingGuard(deps: BindingDependencies) {
  let attempt: Promise<EnvironmentBinding> | null = null;
  let allowed: EnvironmentBinding | null = null;
  async function check(): Promise<EnvironmentBinding> {
    const expected = await deps.identity();
    try {
      const store = deps.store();
      if (store.getAllKeys().length > 0) {
        const raw = store.getString(ENVIRONMENT_BINDING_KEY);
        let existing: unknown;
        try { existing = raw === undefined ? null : JSON.parse(raw); } catch { throw new EnvironmentRefusalError('binding-mismatch'); }
        if (!existing || typeof existing !== 'object' || Object.keys(existing).length !== 4
          || Object.entries(expected).some(([key, value]) => Reflect.get(existing as object, key) !== value)) {
          throw new EnvironmentRefusalError('binding-mismatch');
        }
      } else {
        // Presence, not file size/header, determines whether this is a new sandbox.
        if (await deps.hasArtifacts() || await deps.hasKey() || await deps.hasPendingRecovery() || deps.hasCredentials()) {
          throw new EnvironmentRefusalError('unclassified-data');
        }
        const serialized = JSON.stringify(expected);
        try {
          store.set(ENVIRONMENT_BINDING_KEY, serialized);
          if (store.getString(ENVIRONMENT_BINDING_KEY) !== serialized) throw new Error();
        } catch { throw new EnvironmentRefusalError('binding-write-failed'); }
      }
      allowed = expected;
      return expected;
    } catch (error) {
      if (error instanceof EnvironmentRefusalError) throw error;
      throw new EnvironmentRefusalError('inspection-failed');
    }
  }
  return {
    ensure(): Promise<EnvironmentBinding> {
      attempt ??= check().catch((error: unknown) => {
        // A failed read (e.g. a transient Keystore query) proves nothing about
        // this sandbox. Release it so an explicit retry re-runs EVERY probe from
        // scratch; every other refusal is a stable property of this build or data.
        if (error instanceof EnvironmentRefusalError && error.code === 'inspection-failed') attempt = null;
        throw error;
      });
      return attempt;
    },
    assertAllowed(): void { if (!allowed) throw new EnvironmentRefusalError('unclassified-data'); },
    isAllowed(): boolean { return allowed !== null; },
  };
}

const guard = createEnvironmentBindingGuard({
  identity: verifyEnvironmentIdentity,
  store: () => createMMKV({ id: ENVIRONMENT_STORE_IDS.binding }),
  hasArtifacts: async () => (await import('./encryptionEnvironment')).hasExistingEnvironmentDatabaseArtifacts(),
  hasKey: hasDatabaseKey,
  hasPendingRecovery: hasPendingDatabaseKeyRecovery,
  hasCredentials: hasPersistedEnvironmentCredentials,
});
export const ensureEnvironmentAllowed = guard.ensure;
export const assertEnvironmentAllowed = guard.assertAllowed;
export const isEnvironmentAllowed = guard.isAllowed;
