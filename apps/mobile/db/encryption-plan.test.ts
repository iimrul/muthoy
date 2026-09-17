// H-3, layer B: the startup decision, exhaustively.
//
// planDatabaseStartup is pure, so every crash and restart shape in the H-3
// brief is just an input here. That is the point of extracting it: these are
// states a device reaches once, unpredictably, usually with real money and
// stock inside — not something to discover in the field.
//
// The property every case below defends: no reachable state answers
// "unreadable data" with "start empty".

import { describe, expect, test } from 'vitest';

import {
  classifyDatabaseHeader,
  planDatabaseStartup,
  SQLITE_PLAINTEXT_HEADER,
  type DatabaseDiskState,
  type DatabaseFileClass,
} from './encryptionPlan';

function header(text: string): Uint8Array {
  return new Uint8Array([...text].map((character) => character.charCodeAt(0)));
}

function disk(
  main: DatabaseFileClass,
  candidate: DatabaseFileClass = 'missing',
  backup: DatabaseFileClass = 'missing',
): DatabaseDiskState {
  return { main, candidate, backup };
}

describe('classifyDatabaseHeader', () => {
  test('recognises a plaintext SQLite file by its magic string', () => {
    expect(classifyDatabaseHeader(header(SQLITE_PLAINTEXT_HEADER))).toBe('plaintext');
  });

  test('a SQLCipher file is encrypted from byte 0, so the magic is absent', () => {
    // Real ciphertext is indistinguishable from random; any non-magic prefix
    // exercises the same branch.
    const ciphertext = new Uint8Array([
      0x9f, 0x2c, 0x01, 0xbe, 0x44, 0x7a, 0x11, 0xe0, 0x33, 0x5d, 0x90, 0x02, 0xaa, 0x6b, 0xcc,
      0x71,
    ]);

    expect(classifyDatabaseHeader(ciphertext)).toBe('encrypted');
  });

  test('an absent file is missing', () => {
    expect(classifyDatabaseHeader(null)).toBe('missing');
  });

  test('a zero-length file is missing, not unreadable', () => {
    // expo-sqlite's ensureDatabasePathExistsSync can leave an empty file
    // behind. Calling that "encrypted" would brick a fresh install.
    expect(classifyDatabaseHeader(new Uint8Array(0))).toBe('missing');
  });

  test('a short non-empty file is treated as encrypted, never overwritten', () => {
    expect(classifyDatabaseHeader(new Uint8Array([1, 2, 3]))).toBe('encrypted');
  });

  test('a near-miss header is not mistaken for plaintext', () => {
    expect(classifyDatabaseHeader(header('SQLite format 4\0'))).toBe('encrypted');
  });
});

describe('the steady states', () => {
  test('nothing on disk is a fresh install', () => {
    expect(planDatabaseStartup(disk('missing'), false)).toMatchObject({
      action: 'open-fresh',
      discardStaleCandidate: false,
    });
  });

  test('an encrypted database with a key just opens', () => {
    expect(planDatabaseStartup(disk('encrypted'), true)).toMatchObject({
      action: 'open-encrypted',
    });
  });

  test('a pre-H-3 plaintext database triggers the migration', () => {
    expect(planDatabaseStartup(disk('plaintext'), false)).toMatchObject({
      action: 'migrate-plaintext',
    });
  });

  test('a plaintext database migrates whether or not a key already exists', () => {
    expect(planDatabaseStartup(disk('plaintext'), true).action).toBe('migrate-plaintext');
  });
});

describe('the unrecoverable states write nothing', () => {
  test('encrypted data with no key refuses rather than starting empty', () => {
    const plan = planDatabaseStartup(disk('encrypted'), false);

    expect(plan.action).toBe('fail-unrecoverable');
    expect(plan.reason).toBe('encrypted-without-key');
    // Critically: it does not even clean up. Everything is preserved.
    expect(plan.discardStaleCandidate).toBe(false);
  });

  test('encrypted data with no key refuses whenever no readable copy exists', () => {
    // A candidate is encrypted too, so it is no help without the key.
    expect(planDatabaseStartup(disk('encrypted', 'encrypted'), false).action).toBe(
      'fail-unrecoverable',
    );
  });

  test('a candidate with no original and no backup is not guessed at', () => {
    // Unreachable from our own sequence, so its contents are unknown and may
    // be the only copy of something. Preserve and escalate.
    const plan = planDatabaseStartup(disk('missing', 'encrypted'), true);

    expect(plan.action).toBe('fail-unrecoverable');
    expect(plan.reason).toBe('orphan-candidate');
    expect(plan.discardStaleCandidate).toBe(false);
  });

  test('an encrypted file in the backup slot is refused, not promoted', () => {
    // The backup slot only ever holds the pre-encryption original. Something
    // else moved files around; picking one would risk promoting the wrong.
    const plan = planDatabaseStartup(disk('plaintext', 'missing', 'encrypted'), true);

    expect(plan.action).toBe('fail-unrecoverable');
    expect(plan.reason).toBe('corrupt-backup');
  });
});

describe('an unreadable main prefers the readable original (H-3 review HIGH-1)', () => {
  test('encrypted main with no key but a plaintext backup is restored, not abandoned', () => {
    const plan = planDatabaseStartup(disk('encrypted', 'missing', 'plaintext'), false);

    expect(plan.action).toBe('restore-plaintext-backup');
    // Nothing is cleaned up on the way in; the candidate may still matter.
    expect(plan.discardStaleCandidate).toBe(false);
  });

  test('a stranded candidate does not change the decision', () => {
    expect(planDatabaseStartup(disk('encrypted', 'encrypted', 'plaintext'), false).action).toBe(
      'restore-plaintext-backup',
    );
  });

  test('an encrypted backup slot is still refused, never restored from', () => {
    // The backup slot holds the pre-encryption original and nothing else, so
    // ciphertext there means something outside this machine moved files.
    const plan = planDatabaseStartup(disk('encrypted', 'missing', 'encrypted'), false);

    expect(plan.action).toBe('fail-unrecoverable');
    expect(plan.reason).toBe('encrypted-without-key');
  });

  test('a key that exists takes the ordinary finalize path instead', () => {
    expect(planDatabaseStartup(disk('encrypted', 'missing', 'plaintext'), true).action).toBe(
      'finalize-previous-migration',
    );
  });
});

describe('crash and restart recovery', () => {
  test('crash before export: plain main, nothing else — just migrate', () => {
    expect(planDatabaseStartup(disk('plaintext'), true).action).toBe('migrate-plaintext');
  });

  test('crash after the candidate was created: the candidate is discarded and redone', () => {
    const plan = planDatabaseStartup(disk('plaintext', 'encrypted'), true);

    expect(plan.action).toBe('migrate-plaintext');
    expect(plan.discardStaleCandidate).toBe(true);
  });

  test('crash after verification but before the swap: same safe path', () => {
    // Indistinguishable on disk from the previous case, deliberately — the
    // plan does not trust a verification it cannot re-confirm.
    const plan = planDatabaseStartup(disk('plaintext', 'encrypted'), true);

    expect(plan.action).toBe('migrate-plaintext');
  });

  test('crash between the two renames: the original is restored first', () => {
    const plan = planDatabaseStartup(disk('missing', 'encrypted', 'plaintext'), true);

    expect(plan.action).toBe('restore-backup-then-migrate');
    expect(plan.discardStaleCandidate).toBe(true);
  });

  test('crash after the first rename, before the candidate existed', () => {
    const plan = planDatabaseStartup(disk('missing', 'missing', 'plaintext'), true);

    expect(plan.action).toBe('restore-backup-then-migrate');
  });

  test('restart with a completed migration: verify, then release the backup', () => {
    const plan = planDatabaseStartup(disk('encrypted', 'missing', 'plaintext'), true);

    expect(plan.action).toBe('finalize-previous-migration');
  });

  test('restart with a completed migration and a leftover candidate', () => {
    const plan = planDatabaseStartup(disk('encrypted', 'encrypted', 'plaintext'), true);

    expect(plan.action).toBe('finalize-previous-migration');
    expect(plan.discardStaleCandidate).toBe(true);
  });

  test('restart with the encrypted database already settled', () => {
    const plan = planDatabaseStartup(disk('encrypted', 'encrypted'), true);

    expect(plan.action).toBe('open-encrypted');
    expect(plan.discardStaleCandidate).toBe(true);
  });
});

describe('the safety property holds across the whole state space', () => {
  const classes: DatabaseFileClass[] = ['missing', 'plaintext', 'encrypted'];

  test('no state that holds data is answered with a fresh empty database', () => {
    for (const main of classes) {
      for (const candidate of classes) {
        for (const backup of classes) {
          for (const keyPresent of [true, false]) {
            const plan = planDatabaseStartup({ main, candidate, backup }, keyPresent);
            if (plan.action !== 'open-fresh') {
              continue;
            }
            // open-fresh creates a brand new database. It is only ever
            // acceptable when there is genuinely nothing on disk.
            expect({ main, candidate, backup }).toEqual({
              main: 'missing',
              candidate: 'missing',
              backup: 'missing',
            });
          }
        }
      }
    }
  });

  test('a candidate is only ever discarded while a full copy still exists', () => {
    for (const main of classes) {
      for (const backup of classes) {
        for (const keyPresent of [true, false]) {
          const plan = planDatabaseStartup({ main, candidate: 'encrypted', backup }, keyPresent);
          if (!plan.discardStaleCandidate) {
            continue;
          }
          const survivorExists = main !== 'missing' || backup === 'plaintext';
          expect(survivorExists).toBe(true);
        }
      }
    }
  });

  test('every state resolves to exactly one action', () => {
    for (const main of classes) {
      for (const candidate of classes) {
        for (const backup of classes) {
          for (const keyPresent of [true, false]) {
            const plan = planDatabaseStartup({ main, candidate, backup }, keyPresent);
            expect(plan.action).toBeTruthy();
          }
        }
      }
    }
  });
});
