import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  files: new Set<string>(),
  operations: [] as string[],
  initialize: vi.fn(),
  close: vi.fn(),
  verify: vi.fn(),
  checkpoint: vi.fn(),
}));

vi.mock('./encryptionEnvironment', () => ({
  createEncryptionEnvironment: () => ({
    exists: (name: string) => mocks.files.has(name),
    classify: (name: string) => (mocks.files.has(name) ? 'encrypted' : 'missing'),
    deleteFile: (name: string) => {
      mocks.operations.push(`delete:${name}`);
      mocks.files.delete(name);
    },
    deleteSidecars: (name: string) => {
      for (const suffix of ['-journal', '-wal', '-shm']) {
        mocks.operations.push(`delete:${name}${suffix}`);
        mocks.files.delete(`${name}${suffix}`);
      }
    },
    rename: (from: string, to: string) => {
      mocks.operations.push(`rename:${from}->${to}`);
      if (!mocks.files.has(from) || mocks.files.has(to)) throw new Error('unsafe rename');
      mocks.files.delete(from);
      mocks.files.add(to);
    },
  }),
}));
vi.mock('./encryptionVerify', () => ({ verifyHydratedDatabase: mocks.verify }));
vi.mock('./init', () => ({
  initializeRecoveryDatabase: mocks.initialize,
  closeDatabaseInitializationForRecovery: mocks.close,
}));
vi.mock('./client', () => ({ sqliteConnection: { getFirstSync: mocks.checkpoint } }));

const {
  openDatabaseRecoveryTarget,
  promoteHydratedRecoveryDatabase,
} = await import('./databaseRecovery');
const {
  DATABASE_FILE_NAME,
  LOCKED_DATABASE_BACKUP_FILE_NAME,
  RECOVERY_DATABASE_FILE_NAME,
} = await import('./encryptionPlan');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.files.clear();
  mocks.operations.length = 0;
  mocks.verify.mockImplementation(() => {
    mocks.operations.push('verify');
    return [];
  });
  mocks.initialize.mockImplementation(async () => {
    mocks.operations.push('initialize');
  });
  mocks.checkpoint.mockReturnValue({ busy: 0, log: 0, checkpointed: 0 });
});

describe('recovery file-state handling', () => {
  test('restarts a stranded pre-promotion target without touching locked main', async () => {
    mocks.files.add(DATABASE_FILE_NAME);
    mocks.files.add(RECOVERY_DATABASE_FILE_NAME);

    await expect(openDatabaseRecoveryTarget('ab'.repeat(32))).resolves.toBe('needs-hydration');

    expect(mocks.operations).toContain(`delete:${RECOVERY_DATABASE_FILE_NAME}`);
    expect(mocks.files.has(DATABASE_FILE_NAME)).toBe(true);
    expect(mocks.initialize).toHaveBeenCalledWith(RECOVERY_DATABASE_FILE_NAME, 'ab'.repeat(32));
  });

  test('never creates an empty target when no locked database exists', async () => {
    await expect(openDatabaseRecoveryTarget('ab'.repeat(32))).rejects.toThrow(
      'locked-database-missing',
    );
    expect(mocks.initialize).not.toHaveBeenCalled();
  });

  test('resumes after old-main rename and preserves rollback/WAL sidecars', async () => {
    mocks.files.add(LOCKED_DATABASE_BACKUP_FILE_NAME);
    mocks.files.add(`${DATABASE_FILE_NAME}-journal`);
    mocks.files.add(`${DATABASE_FILE_NAME}-wal`);
    mocks.files.add(RECOVERY_DATABASE_FILE_NAME);

    await expect(openDatabaseRecoveryTarget('ab'.repeat(32))).resolves.toBe('promoted');

    expect(mocks.operations).toContain(
      `rename:${DATABASE_FILE_NAME}-journal->${LOCKED_DATABASE_BACKUP_FILE_NAME}-journal`,
    );
    expect(mocks.operations).toContain(
      `rename:${DATABASE_FILE_NAME}-wal->${LOCKED_DATABASE_BACKUP_FILE_NAME}-wal`,
    );
    expect(mocks.operations).toContain(
      `rename:${RECOVERY_DATABASE_FILE_NAME}->${DATABASE_FILE_NAME}`,
    );
    expect(mocks.files.has(LOCKED_DATABASE_BACKUP_FILE_NAME)).toBe(true);
  });

  test('deletes a stranded candidate only after promoted main verifies', async () => {
    mocks.files.add(LOCKED_DATABASE_BACKUP_FILE_NAME);
    mocks.files.add(DATABASE_FILE_NAME);
    mocks.files.add(RECOVERY_DATABASE_FILE_NAME);

    await openDatabaseRecoveryTarget('ab'.repeat(32));

    expect(mocks.initialize).toHaveBeenCalledBefore(mocks.verify);
    const deleteIndex = mocks.operations.indexOf(`delete:${RECOVERY_DATABASE_FILE_NAME}`);
    expect(deleteIndex).toBeGreaterThan(-1);
    expect(mocks.operations.indexOf('verify')).toBeLessThan(deleteIndex);
  });

  test('checkpoints and verifies candidate before archiving/promoting main', async () => {
    mocks.files.add(DATABASE_FILE_NAME);
    mocks.files.add(RECOVERY_DATABASE_FILE_NAME);

    await promoteHydratedRecoveryDatabase('ab'.repeat(32));

    expect(mocks.verify).toHaveBeenCalled();
    expect(mocks.checkpoint).toHaveBeenCalledWith('PRAGMA wal_checkpoint(TRUNCATE)');
    expect(mocks.close).toHaveBeenCalled();
    expect(mocks.operations).toContain(
      `rename:${DATABASE_FILE_NAME}->${LOCKED_DATABASE_BACKUP_FILE_NAME}`,
    );
    expect(mocks.operations).toContain(
      `rename:${RECOVERY_DATABASE_FILE_NAME}->${DATABASE_FILE_NAME}`,
    );
    expect(mocks.files.has(LOCKED_DATABASE_BACKUP_FILE_NAME)).toBe(true);
  });

  test('a busy WAL checkpoint fails before any recovery rename', async () => {
    mocks.files.add(DATABASE_FILE_NAME);
    mocks.files.add(RECOVERY_DATABASE_FILE_NAME);
    mocks.checkpoint.mockReturnValueOnce({ busy: 1, log: 4, checkpointed: 2 });

    await expect(promoteHydratedRecoveryDatabase('ab'.repeat(32))).rejects.toThrow(
      'checkpoint-incomplete',
    );

    expect(mocks.operations.some((operation) => operation.startsWith('rename:'))).toBe(false);
    expect(mocks.files.has(DATABASE_FILE_NAME)).toBe(true);
    expect(mocks.files.has(RECOVERY_DATABASE_FILE_NAME)).toBe(true);
  });
});
