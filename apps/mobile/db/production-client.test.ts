import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.setConfig({ testTimeout: 30_000 });

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  release: vi.fn(),
  releaseRecovery: vi.fn(),
  open: vi.fn(),
  environment: {},
}));

vi.mock('./databaseKey', () => ({
  getDatabaseKeyHex: vi.fn(),
  hasDatabaseKey: vi.fn(),
  hasPendingDatabaseKeyRecovery: vi.fn(),
}));
vi.mock('./encryptionMigration', () => ({
  prepareEncryptedDatabase: mocks.prepare,
  releaseCompletedRecoveryArtifacts: mocks.releaseRecovery,
  releaseVerifiedPlaintextBackup: mocks.release,
}));
vi.mock('./encryptionEnvironment', () => ({
  createEncryptionEnvironment: () => mocks.environment,
  openKeyedDatabase: mocks.open,
}));
vi.mock('drizzle-orm/expo-sqlite', () => ({ drizzle: vi.fn(() => ({ kind: 'drizzle' })) }));

function connection() {
  return {
    execSync: vi.fn(),
    closeSync: vi.fn(),
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.prepare.mockResolvedValue({
    keyHex: 'ab'.repeat(32),
    outcome: 'already-encrypted',
    releasePlaintextBackup: false,
  });
  mocks.open.mockReturnValue(connection());
});

describe('production database initialization path', () => {
  test('concurrent UI/headless callers share one initialization attempt', async () => {
    let resolvePreparation!: (value: object) => void;
    mocks.prepare.mockReturnValueOnce(
      new Promise((resolve) => {
        resolvePreparation = resolve;
      }),
    );
    const client = await import('./test/production-client-entry');

    const ui = client.ensureDatabaseReady();
    const headless = client.ensureDatabaseReady();
    const another = client.ensureDatabaseReady();
    expect(mocks.prepare).toHaveBeenCalledTimes(1);

    resolvePreparation({
      keyHex: 'ab'.repeat(32),
      outcome: 'already-encrypted',
      releasePlaintextBackup: false,
    });
    await Promise.all([ui, headless, another]);
    expect(mocks.open).toHaveBeenCalledTimes(1);
  });

  test('a transient Keystore failure can be retried in the same process', async () => {
    const { DatabaseKeyUnavailableError } = await import('./errors');
    mocks.prepare
      .mockRejectedValueOnce(new DatabaseKeyUnavailableError('temporarily unavailable'))
      .mockResolvedValueOnce({
        keyHex: 'ab'.repeat(32),
        outcome: 'already-encrypted',
        releasePlaintextBackup: false,
      });
    const client = await import('./test/production-client-entry');

    await expect(client.ensureDatabaseReady()).rejects.toBeInstanceOf(DatabaseKeyUnavailableError);
    await expect(client.ensureDatabaseReady()).resolves.toBeUndefined();
    expect(mocks.prepare).toHaveBeenCalledTimes(2);
  });

  test('closes a connection when post-key PRAGMA setup fails', async () => {
    const failed = connection();
    failed.execSync.mockImplementationOnce(() => {
      throw new Error('pragma failed');
    });
    mocks.open.mockReturnValueOnce(failed);
    const client = await import('./test/production-client-entry');
    const { DatabaseInitializationError } = await import('./errors');

    await expect(client.ensureDatabaseReady()).rejects.toBeInstanceOf(DatabaseInitializationError);
    expect(failed.closeSync).toHaveBeenCalledTimes(1);

    await expect(client.ensureDatabaseReady()).resolves.toBeUndefined();
    expect(mocks.open).toHaveBeenCalledTimes(2);
  });

  test('releases plainbak only after live main open and PRAGMAs succeed', async () => {
    const live = connection();
    mocks.open.mockReturnValueOnce(live);
    mocks.prepare.mockResolvedValueOnce({
      keyHex: 'ab'.repeat(32),
      outcome: 'finalized',
      releasePlaintextBackup: true,
    });
    const client = await import('./test/production-client-entry');

    await client.ensureDatabaseReady();

    expect(live.execSync).toHaveBeenCalledWith('PRAGMA journal_mode = WAL;');
    expect(live.execSync).toHaveBeenCalledWith('PRAGMA foreign_keys = ON;');
    expect(live.execSync).toHaveBeenCalledBefore(mocks.release);
  });

  test('closes the live connection when post-open cleanup fails, then retries', async () => {
    const failed = connection();
    mocks.open.mockReturnValueOnce(failed);
    mocks.prepare.mockResolvedValue({
      keyHex: 'ab'.repeat(32),
      outcome: 'finalized',
      releasePlaintextBackup: true,
    });
    mocks.release.mockImplementationOnce(() => {
      throw new Error('cleanup I/O');
    });
    const client = await import('./test/production-client-entry');

    await expect(client.ensureDatabaseReady()).rejects.toThrow('cleanup I/O');
    expect(failed.closeSync).toHaveBeenCalledTimes(1);
    await expect(client.ensureDatabaseReady()).resolves.toBeUndefined();
    expect(mocks.open).toHaveBeenCalledTimes(2);
  });

  test('cleans completed recovery artifacts only after steady-state main reopens', async () => {
    const live = connection();
    mocks.open.mockReturnValueOnce(live);
    const client = await import('./test/production-client-entry');

    await client.ensureDatabaseReady();

    expect(live.execSync).toHaveBeenCalledWith('PRAGMA foreign_keys = ON;');
    expect(live.execSync).toHaveBeenCalledBefore(mocks.releaseRecovery);
  });
});
