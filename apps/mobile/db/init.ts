import { migrate } from 'drizzle-orm/expo-sqlite/migrator';
import { useCallback, useEffect, useState } from 'react';
import {
  closeDatabaseForRecovery,
  db,
  ensureDatabaseReady,
  initializeDatabaseFileForRecovery,
} from './client';
import { DatabaseRecoveryPendingError } from './errors';
import migrations from './migrations/migrations';

export interface DatabaseInitState {
  /** True once the schema is present and the app may safely read/write. */
  isReady: boolean;
  /** Non-null if initialization failed — the app must NOT continue silently. */
  error: Error | undefined;
  /** Explicit retry for transient Keystore/init errors and completed restore. */
  retry: () => void;
}

let initialization: Promise<void> | null = null;
let isInitialized = false;
let isRecoveryMode = false;

/**
 * Brings the local database all the way up: unlocks it (H-3), runs any
 * pending schema migrations, and leaves it safe to read and write.
 *
 * Two stages, in this order and no other:
 *
 *  1. `ensureDatabaseReady()` — fetches the SQLCipher key, performs the
 *     one-time plaintext upgrade if this device still has a pre-H-3 database,
 *     and opens the encrypted file with `PRAGMA key` first.
 *  2. Drizzle migrations — recorded in `__drizzle_migrations`, so anything
 *     already applied is skipped and a normal reopen is a no-op.
 *
 * Callable from anywhere, including outside React. Concurrent callers share
 * ONE attempt: the headless notification task and the app's own boot can
 * legitimately race on a cold start, and two parallel migration runs against
 * the same file is precisely the situation to avoid.
 *
 * Lives here rather than in app/_layout.tsx so that db/ stays the only place
 * importing Drizzle (Volume 2's folder responsibilities) — the root layout
 * just calls the hook below.
 */
export async function ensureDatabaseInitialized(): Promise<void> {
  if (isRecoveryMode) {
    throw new DatabaseRecoveryPendingError();
  }
  if (isInitialized) {
    return;
  }
  initialization ??= (async () => {
    await ensureDatabaseReady();
    await migrate(db, migrations);
    isInitialized = true;
  })();
  try {
    await initialization;
  } catch (error) {
    initialization = null;
    throw error;
  }
}

/** Recovery-only: install schema into the isolated, authenticated target. */
export async function initializeRecoveryDatabase(
  fileName: string,
  keyHex: string,
): Promise<void> {
  closeDatabaseInitializationForRecovery();
  isRecoveryMode = true;
  try {
    initializeDatabaseFileForRecovery(fileName, keyHex);
    await migrate(db, migrations);
    isInitialized = true;
  } catch (error) {
    try {
      closeDatabaseInitializationForRecovery();
    } catch {
      // Preserve the migration/open failure. No handle remains published.
    }
    throw error;
  }
}

/** Recovery-only: close all handles before same-directory atomic rename. */
export function closeDatabaseInitializationForRecovery(): void {
  initialization = null;
  isInitialized = false;
  isRecoveryMode = false;
  closeDatabaseForRecovery();
}

/**
 * React entry point. Same `{ isReady, error }` contract the root layout has
 * always consumed, so the boot gate and its error screen are unchanged — only
 * what happens behind it grew an unlock step.
 */
export function useDatabaseMigrations(): DatabaseInitState {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<Omit<DatabaseInitState, 'retry'>>({
    isReady: false,
    error: undefined,
  });
  const retry = useCallback(() => {
    initialization = null;
    setState({ isReady: false, error: undefined });
    setAttempt((value) => value + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    ensureDatabaseInitialized().then(
      () => {
        if (!cancelled) {
          setState({ isReady: true, error: undefined });
        }
      },
      (error: unknown) => {
        if (!cancelled) {
          // Surfaced, never swallowed: a failed unlock or migration must stop
          // the app at the boot gate rather than let screens open over a
          // database that is not there.
          setState({
            isReady: false,
            error: error instanceof Error ? error : new Error(String(error)),
          });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [attempt, retry]);

  return { ...state, retry };
}
