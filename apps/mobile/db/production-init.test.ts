import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ready: vi.fn(),
  migrate: vi.fn(),
  initializeRecovery: vi.fn(),
  closeRecovery: vi.fn(),
  allow: vi.fn(),
}));
vi.mock('./environmentBinding', () => ({ ensureEnvironmentAllowed: mocks.allow }));

vi.mock('./client', () => ({
  db: { kind: 'db' },
  ensureDatabaseReady: mocks.ready,
  closeDatabaseForRecovery: mocks.closeRecovery,
  initializeDatabaseFileForRecovery: mocks.initializeRecovery,
}));
vi.mock('drizzle-orm/expo-sqlite/migrator', () => ({ migrate: mocks.migrate }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.ready.mockResolvedValue(undefined);
  mocks.allow.mockResolvedValue({ appVariant: 'development', nativeApplicationId: 'com.muthoy.pos.dev', supabaseProjectRef: 'btfprhticjgeihcngpif', version: 1 });
  mocks.migrate.mockResolvedValue(undefined);
});

describe('production schema initialization single-flight', () => {
  test('recovery environment refusal preserves current handles and schema', async () => {
    const { EnvironmentRefusalError } = await import('../config/environmentPolicy');
    mocks.allow.mockRejectedValueOnce(new EnvironmentRefusalError('binding-mismatch'));
    const init = await import('./test/production-init-entry');
    await expect(init.initializeRecoveryDatabase('muthoy.restore.db', 'ab'.repeat(32))).rejects.toBeInstanceOf(EnvironmentRefusalError);
    expect(mocks.closeRecovery).not.toHaveBeenCalled();
    expect(mocks.initializeRecovery).not.toHaveBeenCalled();
    expect(mocks.migrate).not.toHaveBeenCalled();
  });
  test('concurrent UI/headless initialization runs migrations once', async () => {
    let resolveReady!: () => void;
    mocks.ready.mockReturnValueOnce(new Promise<void>((resolve) => {
      resolveReady = resolve;
    }));
    const init = await import('./test/production-init-entry');

    const ui = init.ensureDatabaseInitialized();
    const headless = init.ensureDatabaseInitialized();
    expect(mocks.ready).toHaveBeenCalledTimes(1);

    resolveReady();
    await Promise.all([ui, headless]);
    expect(mocks.migrate).toHaveBeenCalledTimes(1);
  }, 30_000);

  test('a transient migration failure is retryable', async () => {
    mocks.migrate
      .mockRejectedValueOnce(new Error('transient migration I/O'))
      .mockResolvedValueOnce(undefined);
    const init = await import('./test/production-init-entry');

    await expect(init.ensureDatabaseInitialized()).rejects.toThrow('transient migration I/O');
    await expect(init.ensureDatabaseInitialized()).resolves.toBeUndefined();

    expect(mocks.ready).toHaveBeenCalledTimes(2);
    expect(mocks.migrate).toHaveBeenCalledTimes(2);
  });

  test('headless/normal initialization is blocked while recovery owns db/', async () => {
    const init = await import('./test/production-init-entry');
    const { DatabaseRecoveryPendingError } = await import('./errors');

    await init.initializeRecoveryDatabase('muthoy.restore.db', 'ab'.repeat(32));

    await expect(init.ensureDatabaseInitialized()).rejects.toBeInstanceOf(
      DatabaseRecoveryPendingError,
    );
    expect(mocks.initializeRecovery).toHaveBeenCalledTimes(1);
  });
});
