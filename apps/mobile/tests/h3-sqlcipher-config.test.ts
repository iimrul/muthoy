// H-3, the configuration half — asserted as text, like
// tests/dev-production-safety.test.ts asserts the DEV boundary.
//
// Worth a suite of its own because encryption here is almost entirely a
// BUILD decision. `useSQLCipher` is what makes expo-sqlite compile
// vendor/sqlcipher instead of vendor/sqlite3; delete that one line and every
// runtime test in this repo still passes, the app still works, and the
// database is silently plaintext again. There is no other symptom. Same for
// allowBackup: without the plugin, Android quietly uploads the whole
// app-private directory to Google Drive.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const MOBILE = 'apps/mobile';

function readText(...segments: string[]): string {
  return readFileSync(resolve(MOBILE, ...segments), 'utf8');
}

interface ExpoConfig {
  expo: {
    plugins: (string | [string, Record<string, unknown>])[];
    android?: Record<string, unknown>;
  };
}

function appConfig(): ExpoConfig {
  return JSON.parse(readText('app.json')) as ExpoConfig;
}

function pluginEntry(name: string): string | [string, Record<string, unknown>] | undefined {
  return appConfig().expo.plugins.find((plugin) =>
    Array.isArray(plugin) ? plugin[0] === name : plugin === name,
  );
}

describe('SQLCipher is enabled in the Expo config', () => {
  test('expo-sqlite is configured with props, not as a bare string', () => {
    const entry = pluginEntry('expo-sqlite');

    expect(Array.isArray(entry)).toBe(true);
  });

  test('android.useSQLCipher is true', () => {
    const entry = pluginEntry('expo-sqlite') as [string, { android?: { useSQLCipher?: boolean } }];

    expect(entry[1].android?.useSQLCipher).toBe(true);
  });

  test('the expo-sqlite plugin actually reads that prop', () => {
    // Guards against the prop being renamed upstream and silently ignored:
    // an unknown key in app.json produces no warning and no encryption.
    const plugin = readFileSync(
      resolve(MOBILE, 'node_modules/expo-sqlite/plugin/build/withSQLite.js'),
      'utf8',
    );

    expect(plugin).toContain('expo.sqlite.useSQLCipher');
  });

  test('the gradle build selects the sqlcipher vendor sources from that property', () => {
    const gradle = readFileSync(
      resolve(MOBILE, 'node_modules/expo-sqlite/android/build.gradle'),
      'utf8',
    );

    expect(gradle).toContain("findProperty('expo.sqlite.useSQLCipher') == 'true'");
    expect(gradle).toContain('vendor/sqlcipher');
  });

  test('the vendored SQLCipher amalgamation is present in the installed package', () => {
    // No submodule fetch, no download step — if this ever stops being true the
    // build breaks in CI rather than shipping an unencrypted database.
    expect(() =>
      readFileSync(resolve(MOBILE, 'node_modules/expo-sqlite/vendor/sqlcipher/sqlite3.h')),
    ).not.toThrow();
  });

  test('FTS5 is not disabled, so medicines_fts survives the cipher build', () => {
    const entry = pluginEntry('expo-sqlite') as [string, { android?: { enableFTS?: boolean } }];

    expect(entry[1].android?.enableFTS).not.toBe(false);
  });
});

describe('Android backup protection ships with it', () => {
  test('the backup-protection plugin is registered', () => {
    expect(pluginEntry('./plugins/withAndroidBackupProtection')).toBeDefined();
  });

  test('the plugin sets allowBackup to false', () => {
    const plugin = readText('plugins/withAndroidBackupProtection.js');

    expect(plugin).toContain("application.$['android:allowBackup'] = 'false'");
  });

  test('the plugin wires both the modern and legacy rule resources', () => {
    const plugin = readText('plugins/withAndroidBackupProtection.js');

    expect(plugin).toContain('android:dataExtractionRules');
    expect(plugin).toContain('android:fullBackupContent');
  });

  test('the rules exclude the SQLite directory and the wrapped key', () => {
    const plugin = readText('plugins/withAndroidBackupProtection.js');

    expect(plugin).toContain('<exclude domain="file" path="SQLite" />');
    expect(plugin).toContain('muthoy_db_key_v1.xml');
    // Both transfer surfaces, not just cloud backup.
    expect(plugin).toContain('<device-transfer>');
    expect(plugin).toContain('<cloud-backup>');
  });

  test('cloud, D2D, and legacy rules exclude the complete files/mmkv directory', () => {
    const plugin = readText('plugins/withAndroidBackupProtection.js');
    const exclusions = plugin.match(/<exclude domain="file" path="mmkv\/" \/>/g) ?? [];

    expect(exclusions).toHaveLength(3);
    expect(plugin).not.toContain('path="muthoy-session"');
    expect(plugin).not.toContain('path="muthoy-supabase-auth"');
  });

  test('the installed MMKV module really stores all instances under files/mmkv', () => {
    const mmkvPlatform = readFileSync(
      resolve(
        MOBILE,
        'node_modules/react-native-mmkv/android/src/main/java/com/margelo/nitro/mmkv/HybridMMKVPlatformContext.kt',
      ),
      'utf8',
    );

    expect(mmkvPlatform).toContain('context.filesDir.absolutePath + "/mmkv"');
  });

  test('protection is a config plugin, not an edit to the generated manifest', () => {
    // android/ is gitignored and regenerated by prebuild; a hand edit there
    // would vanish on the next `expo prebuild --clean`.
    const gitignore = readText('.gitignore');

    expect(gitignore).toMatch(/^\/android$/m);
  });
});

describe('the key reaches SQLite before anything else does', () => {
  test('openKeyedDatabase applies the key before returning the connection', () => {
    const environment = readText('db/encryptionEnvironment.ts');
    const openIndex = environment.indexOf('export function openKeyedDatabase');
    const body = environment.slice(openIndex, openIndex + 400);

    expect(body).toContain('applyKeyAndProbe');
  });

  test('a probe read follows PRAGMA key, so a wrong key fails at open', () => {
    // PRAGMA key alone never throws — SQLCipher defers verification to the
    // first page read. Without the probe a wrong key yields a connection that
    // looks healthy and explodes somewhere deep in a screen later.
    const environment = readText('db/encryptionEnvironment.ts');
    const probeIndex = environment.indexOf('function applyKeyAndProbe');
    const body = environment.slice(probeIndex, probeIndex + 400);

    expect(body).toContain('buildKeyPragma');
    expect(body).toContain('sqlite_master');
    expect(body.indexOf('buildKeyPragma')).toBeLessThan(body.indexOf('sqlite_master'));
  });

  test('journal_mode and foreign_keys run after the key, never before', () => {
    const client = readText('db/client.ts');
    const keyedOpen = client.indexOf('openKeyedDatabase(fileName');
    const journalMode = client.indexOf('PRAGMA journal_mode');
    const foreignKeys = client.indexOf('PRAGMA foreign_keys');

    expect(keyedOpen).toBeGreaterThan(-1);
    expect(keyedOpen).toBeLessThan(journalMode);
    expect(keyedOpen).toBeLessThan(foreignKeys);
  });

  test('foreign_keys is still set on the open path (CLAUDE.md rule 2)', () => {
    // The H-3 reordering must not lose it: without this every onDelete policy
    // in schema.ts parses and enforces nothing.
    expect(readText('db/client.ts')).toContain("execSync('PRAGMA foreign_keys = ON;')");
  });
});

describe('the database key is never exposed', () => {
  test('no source file logs the key', () => {
    for (const file of ['db/databaseKey.ts', 'db/client.ts', 'db/encryptionEnvironment.ts']) {
      const source = readText(file);
      expect(source).not.toMatch(/console\.(log|warn|error)\([^)]*keyHex/);
    }
  });

  test('the encryption event union carries no key material', () => {
    const migration = readText('db/encryptionMigration.ts');
    const unionStart = migration.indexOf('export type EncryptionEvent');
    const union = migration.slice(unionStart, migration.indexOf(';', unionStart));

    expect(union).not.toContain('key');
  });

  test('the native module is the only place the key is unwrapped', () => {
    const module = readText(
      'modules/muthoy-db-key/android/src/main/java/com/muthoy/dbkey/MuthoyDbKeyModule.kt',
    );

    expect(module).toContain('AndroidKeyStore');
    expect(module).toContain('setUserAuthenticationRequired(false)');
    expect(module).not.toMatch(/Log\.[dviwe]\(/);
  });

  test('recovery alternates wrapping aliases and retains the old alias until completion', () => {
    const module = readText(
      'modules/muthoy-db-key/android/src/main/java/com/muthoy/dbkey/MuthoyDbKeyModule.kt',
    );

    expect(module).toContain('WRAPPING_KEY_ALIAS_PRIMARY');
    expect(module).toContain('WRAPPING_KEY_ALIAS_SECONDARY');
    expect(module).toContain('PREF_RECOVERY_WRAPPING_ALIAS');
    expect(module).toContain('alternateWrappingAlias(oldAlias)');
    expect(module.indexOf('completeDatabaseKeyRecovery()')).toBeGreaterThan(
      module.indexOf('beginDatabaseKeyRecovery()'),
    );
  });
});

describe('API 24/25 swap primitive', () => {
  test('uses same-directory POSIX rename plus directory fsync', () => {
    const native = readText(
      'modules/muthoy-db-key/android/src/main/java/com/muthoy/dbkey/MuthoyDbKeyModule.kt',
    );

    expect(native).toContain('File(context().filesDir, "SQLite")');
    expect(native).toContain('Os.rename(source.absolutePath, target.absolutePath)');
    expect(native).toContain('Os.fsync(directoryDescriptor)');
    expect(native).toContain('OsConstants.O_RDONLY');
    expect(native).toContain('"-journal", "-wal", "-shm"');
  });

  test('production swap never uses Expo File.rename copy/delete', () => {
    const environment = readText('db/encryptionEnvironment.ts');

    expect(environment).toContain('atomicRenameDatabaseFileNative');
    expect(environment).not.toMatch(/\.rename\(/);
  });
});

describe('the close workaround stays scoped to throwaway connections', () => {
  // `finalizeUnusedStatementsBeforeClosing: false` makes expo-sqlite skip
  // `sqlite3_finalize_all_statement()` before `sqlite3_close()`. That walk is
  // what never returned on-device for the written, encrypted, checkpointed
  // candidate, so skipping it is load-bearing for the migration.
  //
  // It is only SAFE where every statement is already finalized. The migration
  // connections qualify structurally: MigrationConnection exposes exec/getAll/
  // getFirst and nothing else, and each of those finalizes in a `finally`
  // inside expo-sqlite. The LIVE connection does not qualify — Drizzle sits on
  // it and may hold prepared statements — so it must keep expo's defaults and
  // let the walk run.
  //
  // Nothing at runtime would report that boundary being crossed: skipping the
  // walk only shows up as `sqlite3_close()` returning SQLITE_BUSY, which
  // closeQuietly deliberately swallows so the original error stays
  // authoritative. These assertions are therefore the only guard.
  function environmentSource(): string {
    return readText('db/encryptionEnvironment.ts');
  }

  function functionBody(source: string, marker: string, length = 700): string {
    const index = source.indexOf(marker);
    expect(index).toBeGreaterThan(-1);
    return source.slice(index, index + length);
  }

  /** Comments discuss the option at length; only real code may set it. */
  function codeOnly(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  }

  test('the option is declared exactly once, as a shared constant', () => {
    const occurrences = codeOnly(environmentSource()).match(
      /finalizeUnusedStatementsBeforeClosing:/g,
    );

    expect(occurrences).toHaveLength(1);
    expect(environmentSource()).toContain('const MIGRATION_OPEN_OPTIONS = {');
  });

  test('MIGRATION_OPEN_OPTIONS skips the walk and stays out of the connection cache', () => {
    const options = functionBody(environmentSource(), 'const MIGRATION_OPEN_OPTIONS = {');

    expect(options).toContain('finalizeUnusedStatementsBeforeClosing: false');
    // Without useNewConnection, expo could hand this very connection back as
    // the app's live one, carrying the option with it.
    expect(options).toContain('useNewConnection: true');
  });

  test('both temporary migration/recovery opens use it', () => {
    const source = environmentSource();

    expect(functionBody(source, 'openPlaintext(fileName: string)')).toContain(
      'MIGRATION_OPEN_OPTIONS',
    );
    expect(functionBody(source, 'openEncrypted(fileName: string, keyHex: string)')).toContain(
      'MIGRATION_OPEN_OPTIONS',
    );
  });

  test('the live connection does NOT use it', () => {
    const body = functionBody(environmentSource(), 'export function openKeyedDatabase');

    expect(body).toContain('openDatabaseSync(fileName)');
    expect(body).not.toContain('MIGRATION_OPEN_OPTIONS');
    expect(body).not.toContain('finalizeUnusedStatementsBeforeClosing');
  });

  test('no open site other than those three exists', () => {
    // A fourth openDatabaseSync would be an unreviewed connection whose close
    // behaviour nobody has decided on.
    const opens = environmentSource().match(/openDatabaseSync\(/g);

    expect(opens).toHaveLength(3);
  });

  test('the migration connection cannot hold an unfinalized statement', () => {
    // The whole safety argument for skipping the walk. prepareSync would let a
    // caller keep a live statement past close, and SQLITE_BUSY would then be
    // swallowed rather than surfaced.
    const connection = readText('db/encryptionVerify.ts');
    const contract = functionBody(connection, 'export interface SqlConnection {', 220);

    expect(contract).toContain('execSync');
    expect(contract).toContain('getAllSync');
    expect(contract).toContain('getFirstSync');
    expect(contract).not.toContain('prepareSync');
  });
});
