// H-11 C5 backup executor contracts. Offline: no container, no database, no
// network. Fixtures marked "measured" are REAL output captured on 2026-10-31
// from `public.ecr.aws/supabase/postgres:17.6.1.159` on loopback with synthetic
// data only.
//
// The independent review of the first revision made one point that reshaped this
// file: replacing the entire CLI with an immediate throw still left every test
// passing, because they all exercised helpers. `main()` is now driven through
// injected dependencies, so CLI enforcement is asserted rather than assumed.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  REFUSAL,
  FORBIDDEN_ENV,
  assertArchiveSourceMajor,
  assertClientMajor,
  assertNoCredentialInArgs,
  assertRestoreTargetCompatible,
  assertServerVersionNum,
  assertServiceName,
  assertTargetEmpty,
  buildManifest,
  classifyArchive,
  main,
  parseTocLine,
  runId,
} from '../dev-backup.mjs';

// Measured: `docker exec muthoy-h9src pg_dump --version`, and this host's own.
const PG17_CLIENT = 'pg_dump (PostgreSQL) 17.6';
const PG18_CLIENT = 'pg_dump (PostgreSQL) 18.6';

// Measured: the pg_cron-enabled source's `pg_restore --list`, verbatim.
const PG_CRON_TOC = [
  ';',
  '; Archive created at 2026-10-31 14:06:36 UTC',
  ';     TOC Entries: 204',
  ';     Dumped from database version: 17.6',
  ';     Dumped by pg_dump version: 17.6',
  ';',
  '6; 3079 16666 EXTENSION - pg_cron ',
  '3630; 0 0 COMMENT - EXTENSION pg_cron ',
  '3631; 0 0 ACL - SCHEMA cron supabase_admin',
  '4; 3079 16515 EXTENSION - pg_stat_statements ',
  '3418; 0 16669 TABLE DATA cron job supabase_admin',
  '3420; 0 16688 TABLE DATA cron job_run_details supabase_admin',
  '3620; 0 16717 TABLE DATA public sync_operation_staging postgres',
  '3614; 0 16458 TABLE DATA auth users supabase_auth_admin',
].join('\n');

// Measured: the DEV-shaped source (no pg_cron), which restored cleanly.
const DEV_SHAPED_TOC = [
  ';     TOC Entries: 12',
  ';     Dumped from database version: 17.6',
  '3; 3079 16406 EXTENSION - pgcrypto ',
  '200; 1259 16717 TABLE public sync_operation_staging postgres',
  '3620; 0 16717 TABLE DATA public sync_operation_staging postgres',
].join('\n');

const FRESH_TARGET = { schemas: ['public'], extensions: ['plpgsql'], relationCount: 0 };
// Measured: the image's own `postgres` database, which is why a restore there failed.
const IMAGE_POSTGRES_TARGET = {
  schemas: ['auth', 'cron', 'extensions', 'public', 'storage', 'vault'],
  extensions: ['pg_cron', 'pg_stat_statements', 'pgcrypto', 'plpgsql', 'supabase_vault'],
  relationCount: 184,
};

test("the toolchain must be PG17 — this host's own 18.6 client is refused", () => {
  assert.equal(assertClientMajor(PG17_CLIENT), 17);
  assert.throws(() => assertClientMajor(PG18_CLIENT), /client-major-18/);
  assert.throws(() => assertClientMajor('psql: command not found'), /client-version-unreadable/);
});

test('a 17.x server_version_num is required, and a tag is not proof', () => {
  assert.equal(assertServerVersionNum(170006), 170006); // the measured value
  assert.throws(() => assertServerVersionNum(180006), /server-version-180006/);
  assert.throws(() => assertServerVersionNum(169999), /server-version-169999/);
  assert.throws(() => assertServerVersionNum('seventeen'), /server-version-unreadable/);
});

test('the archive header pins the SOURCE major, so a PG16 dump cannot be filed as PG17', () => {
  assert.equal(assertArchiveSourceMajor(PG_CRON_TOC), '17.6');
  assert.throws(
    () => assertArchiveSourceMajor(';     Dumped from database version: 16.4'),
    /archive-source-major-16/,
  );
  assert.throws(
    () => assertArchiveSourceMajor(';     Dumped from database version: 18.1'),
    /archive-source-major-18/,
  );
  assert.throws(() => assertArchiveSourceMajor('no header here'), /archive-source-version-unreadable/);
});

test('emptiness needs POSITIVE evidence, not an absence of surprises', () => {
  assert.equal(assertTargetEmpty(FRESH_TARGET), true);
  // No argument at all must not read as empty.
  assert.throws(() => assertTargetEmpty(), /target-inventory-missing/);
  assert.throws(() => assertTargetEmpty({}), /target-inventory-missing/);
  assert.throws(() => assertTargetEmpty({ schemas: [], extensions: [], relationCount: 0 }), /target-inventory-missing/);
  // A `public`-only inventory is identical whether public is empty or populated,
  // so the relation count is required and decisive.
  assert.throws(
    () => assertTargetEmpty({ schemas: ['public'], extensions: ['plpgsql'] }),
    /target-relation-count-missing/,
  );
  assert.throws(
    () => assertTargetEmpty({ schemas: ['public'], extensions: ['plpgsql'], relationCount: 42 }),
    /target-not-empty-relations-42/,
  );
  assert.throws(() => assertTargetEmpty(IMAGE_POSTGRES_TARGET), /target-not-empty-relations-184/);
});

// The extension branch needs its own case: the image fixture above fails on the
// relation count first, so without this the extension rejection is never reached
// and removing it would survive.
test('an unexpected EXTENSION alone fails the emptiness gate', () => {
  assert.throws(
    () => assertTargetEmpty({ schemas: ['public'], extensions: ['plpgsql', 'pg_cron'], relationCount: 0 }),
    /target-not-empty-extensions-1/,
  );
});

// Likewise an unexpected schema alone, so that branch is reached too.
test('an unexpected SCHEMA alone fails the emptiness gate', () => {
  assert.throws(
    () => assertTargetEmpty({ schemas: ['public', 'auth'], extensions: ['plpgsql'], relationCount: 0 }),
    /target-not-empty-schemas-1/,
  );
});

test('a dump DOES carry the pg_cron schedule — cron.job appears as TABLE DATA', () => {
  const archive = classifyArchive(PG_CRON_TOC);
  assert.equal(archive.hasPgCron, true);
  assert.equal(archive.carriesCronJob, true);
  assert.equal(archive.tableDataCount, 4);
  assert.deepEqual(archive.extensions, ['pg_cron', 'pg_stat_statements']);
});

test('the DEV-shaped archive has no pg_cron at all', () => {
  const archive = classifyArchive(DEV_SHAPED_TOC);
  assert.equal(archive.hasPgCron, false);
  assert.equal(archive.carriesCronJob, false);
  assert.deepEqual(archive.extensions, ['pgcrypto']);
});

// The review produced three real TOC lines that an unanchored matcher
// misclassified. PostgreSQL prints raw identifier text, so these are legal.
test('realistic identifiers are not mistaken for cron.job or the pg_cron extension', () => {
  for (const line of [
    '3420; 0 16688 TABLE DATA cron job_run_details supabase_admin',
    '3421; 0 16689 TABLE DATA cron job-archive postgres',
    '3422; 0 16690 TABLE DATA cron job.old postgres',
    '3423; 0 16691 TABLE DATA public job postgres',
  ]) {
    assert.equal(classifyArchive(line).carriesCronJob, false, line);
  }
  // An ordinary table whose NAME contains the words: still not the extension.
  const sneaky = classifyArchive('3424; 0 16692 TABLE DATA public EXTENSION - pg_cron postgres');
  assert.equal(sneaky.hasPgCron, false);
  assert.deepEqual(sneaky.extensions, []);
  assert.equal(sneaky.tableDataCount, 1);
  // And the genuine article is still detected.
  assert.equal(classifyArchive('3418; 0 16669 TABLE DATA cron job supabase_admin').carriesCronJob, true);
  assert.equal(classifyArchive('6; 3079 16666 EXTENSION - pg_cron ').hasPgCron, true);
});

test('the TOC parser keeps names with spaces and hyphens intact', () => {
  assert.deepEqual(parseTocLine('3421; 0 16689 TABLE DATA cron job-archive postgres'), {
    descriptor: 'TABLE DATA',
    schema: 'cron',
    name: 'job-archive',
    owner: 'postgres',
  });
  assert.deepEqual(parseTocLine('3424; 0 16692 TABLE DATA public EXTENSION - pg_cron postgres'), {
    descriptor: 'TABLE DATA',
    schema: 'public',
    name: 'EXTENSION - pg_cron',
    owner: 'postgres',
  });
  assert.equal(parseTocLine('; a comment'), null);
  assert.equal(parseTocLine(''), null);
});

test('a pg_cron archive may only be restored into the EFFECTIVE cron database', () => {
  assert.throws(
    () =>
      assertRestoreTargetCompatible({
        archiveHasPgCron: true,
        targetDatabase: 'h9_restore_c5c',
        cronDatabaseName: 'postgres',
      }),
    /pg-cron-archive-needs-cron-database/,
  );
  // A local operator who reconfigured cron.database_name and restarted passes.
  assert.deepEqual(
    assertRestoreTargetCompatible({
      archiveHasPgCron: true,
      targetDatabase: 'h9_restore_c5c',
      cronDatabaseName: 'h9_restore_c5c',
    }),
    { route: 'cron-database-only', pgCron: true },
  );
  assert.throws(
    () => assertRestoreTargetCompatible({ archiveHasPgCron: true, targetDatabase: 'postgres', cronDatabaseName: '' }),
    /cron-database-name-unset/,
  );
  assert.throws(
    () => assertRestoreTargetCompatible({ archiveHasPgCron: false, targetDatabase: '' }),
    /restore-target-database-missing/,
  );
  assert.deepEqual(
    assertRestoreTargetCompatible({
      archiveHasPgCron: false,
      targetDatabase: 'h9_restore_dev2',
      cronDatabaseName: 'postgres',
    }),
    { route: 'fresh-database', pgCron: false },
  );
});

test('a service name is an identifier, never a connection string', () => {
  assert.equal(assertServiceName('h9_dev_verified'), 'h9_dev_verified');
  // The review's counterexample: libpq accepts whitespace around `=`, so a
  // substring check for `password=` let this through.
  for (const bad of [
    "h9_dev_verified password = 'SYNTHETIC'",
    'h9 dev',
    'host=127.0.0.1',
    '',
    '-starts-with-dash',
  ]) {
    assert.throws(() => assertServiceName(bad), /service-name-invalid/, JSON.stringify(bad));
  }
});

test('no password may reach argv or the environment', () => {
  for (const name of FORBIDDEN_ENV) {
    assert.throws(() => assertNoCredentialInArgs([], { [name]: 'x' }), new RegExp(`env-${name.toLowerCase()}-set`));
  }
  assert.throws(() => assertNoCredentialInArgs(['--dbname=host=h password=s']), /password-in-argument/);
  // Whitespace around `=`, which the first revision missed.
  assert.throws(() => assertNoCredentialInArgs(["--service=h9 password = 'x'"]), /password-in-argument/);
  // Option-prefixed URL, which the first revision also missed because its
  // pattern was anchored at the start of the argument.
  assert.throws(
    () => assertNoCredentialInArgs(['--dbname=postgresql://postgres:synthetic%40value@db.example.invalid/postgres']),
    /password-in-url/,
  );
  assert.throws(() => assertNoCredentialInArgs(['--dbname=host=h sslpassword=s']), /password-in-argument/);
  // The sanctioned shape: a service name and nothing else.
  assert.equal(assertNoCredentialInArgs(['--service', 'h9_dev_verified', '--out', 'D:/run'], {}), true);
  // A passwordless URL is not a credential leak.
  assert.equal(assertNoCredentialInArgs(['postgresql://postgres@127.0.0.1:54329/postgres'], {}), true);
});

test('a manifest records measurements and its fields must agree', () => {
  const files = [{ path: 'D:/run/database.dump', sha256: 'a'.repeat(64), bytes: 80200 }];
  const base = {
    serviceName: 'h9_dev_verified',
    runId: 'h11c5-20261031T140636Z',
    capturedAtUtc: '2026-10-31T14:06:36.000Z',
    serverVersionNum: 170006,
    clientMajor: 17,
    archiveSourceVersion: '17.6',
    files,
    archive: classifyArchive(DEV_SHAPED_TOC),
  };
  const manifest = buildManifest(base);
  assert.equal(manifest.version, 1);
  assert.equal(manifest.source.pgMajor, 17);
  assert.equal(manifest.source.archiveSourceVersion, '17.6');
  assert.equal(manifest.hostedRecoveryAcceptance, null);
  assert.match(manifest.retentionNote, /never deletes/);

  // Each contradiction the review demonstrated is now refused.
  assert.throws(() => buildManifest({ ...base, clientMajor: 18 }), /manifest-client-major-invalid/);
  assert.throws(() => buildManifest({ ...base, serverVersionNum: 180006 }), /server-version-180006/);
  assert.throws(() => buildManifest({ ...base, capturedAtUtc: 'not-a-date' }), /manifest-timestamp-invalid/);
  assert.throws(() => buildManifest({ ...base, runId: 'whatever' }), /manifest-run-id-invalid/);
  assert.throws(() => buildManifest({ ...base, files: [] }), /manifest-file-evidence-incomplete/);
  assert.throws(() => buildManifest({ ...base, archive: {} }), /manifest-archive-incomplete/);
  assert.throws(() => buildManifest({ ...base, serviceName: "h9 password = 'x'" }), /service-name-invalid/);
});

test('incomplete file evidence is refused rather than recorded', () => {
  const base = {
    serviceName: 'h9_dev_verified',
    runId: 'h11c5-20261031T140636Z',
    capturedAtUtc: '2026-10-31T14:06:36.000Z',
    clientMajor: 17,
    archive: classifyArchive(DEV_SHAPED_TOC),
  };
  for (const files of [
    [{ path: 'D:/run/database.dump', sha256: 'short', bytes: 10 }],
    [{ path: 'D:/run/database.dump', sha256: 'a'.repeat(64), bytes: 0 }],
    [{ path: '', sha256: 'a'.repeat(64), bytes: 10 }],
  ]) {
    assert.throws(() => buildManifest({ ...base, files }), /manifest-file-evidence-incomplete/);
  }
  assert.throws(() => buildManifest({ ...base, runId: '', files: [] }), /manifest-inputs-incomplete/);
});

// ---------------------------------------------------------------------------
// CLI enforcement. Without these, replacing main() with a throw passes.
// ---------------------------------------------------------------------------

/** A dependency double that records every command the CLI issues. */
function harness({ toc = DEV_SHAPED_TOC, version = PG17_CLIENT, targetVersion = '170006\n', existing = false } = {}) {
  const calls = [];
  const written = new Map();
  return {
    calls,
    written,
    deps: {
      run(command, args, label) {
        calls.push({ command, args, label });
        // `target-version` is checked FIRST: it also ends with `-version`, and
        // matching the client branch made it answer with the client string.
        if (label === 'target-version') return targetVersion;
        if (label.endsWith('-version')) return version;
        if (label === 'pg-restore-list') return toc;
        return '';
      },
      exists: () => existing,
      mkdir: () => {},
      write: (path, body) => written.set(path, body),
      read: () => Buffer.from('archive-bytes'),
      size: () => 80200,
      now: () => new Date('2026-10-31T14:06:36.000Z'),
    },
  };
}

const CAPTURE_ARGV = ['--service', 'h9_dev_verified', '--pg-dump', '/usr/bin/pg_dump', '--out', 'D:/run'];

test('the CLI captures, checks the client, lists the archive and writes a manifest', () => {
  const h = harness();
  const manifest = main(CAPTURE_ARGV, {}, h.deps);
  assert.equal(manifest.runId, 'h11c5-20261031T140636Z');
  assert.equal(manifest.source.archiveSourceVersion, '17.6');
  assert.equal(manifest.restore, null);
  // Both binaries version-checked, then dump, then list. No restore.
  assert.deepEqual(
    h.calls.map((call) => call.label),
    ['pg-dump-version', 'pg-restore-version', 'pg-dump', 'pg-restore-list'],
  );
  // The dump names the service and never a password.
  const dump = h.calls.find((call) => call.label === 'pg-dump');
  assert.ok(dump.args.includes('--dbname=service=h9_dev_verified'));
  assert.ok(!JSON.stringify(dump.args).match(/password/i));
  assert.ok([...h.written.keys()].some((path) => path.endsWith('manifest.json')));
});

test('the CLI refuses a PG18 client before it dumps anything', () => {
  const h = harness({ version: PG18_CLIENT });
  assert.throws(() => main(CAPTURE_ARGV, {}, h.deps), /client-major-18/);
  assert.deepEqual(h.calls.map((call) => call.label), ['pg-dump-version']);
});

test('the CLI refuses a non-PG17 ARCHIVE after listing, and writes no manifest', () => {
  const h = harness({ toc: ';     Dumped from database version: 16.4\n3; 3079 1 EXTENSION - pgcrypto ' });
  assert.throws(() => main(CAPTURE_ARGV, {}, h.deps), /archive-source-major-16/);
  assert.ok(![...h.written.keys()].some((path) => path.endsWith('manifest.json')));
});

test('the CLI refuses a credential-bearing invocation before running anything', () => {
  const h = harness();
  assert.throws(() => main(CAPTURE_ARGV, { PGPASSWORD: 'x' }, h.deps), /env-pgpassword-set/);
  assert.throws(() => main(CAPTURE_ARGV, { PGSERVICEFILE: 'x' }, h.deps), /env-pgservicefile-set/);
  assert.throws(
    () => main([...CAPTURE_ARGV, '--pg-restore', "/x password = 'y'"], {}, h.deps),
    /password-in-argument/,
  );
  assert.equal(h.calls.length, 0);
});

test('the CLI refuses a service name that is really a connection string', () => {
  const h = harness();
  assert.throws(
    () => main(['--service', 'host=127.0.0.1', '--pg-dump', '/usr/bin/pg_dump', '--out', 'D:/run'], {}, h.deps),
    /service-name-invalid/,
  );
  assert.equal(h.calls.length, 0);
});

test('the CLI will not overwrite an existing run directory', () => {
  const h = harness({ existing: true });
  assert.throws(() => main(CAPTURE_ARGV, {}, h.deps), /run-directory-exists/);
});

test('the restore path enforces the target version, emptiness and cron rules', () => {
  const restoreArgv = [
    ...CAPTURE_ARGV,
    '--restore-service', 'h9_restore_verified',
    '--restore-database', 'h9_restore_dev2',
    '--target-schemas', 'public',
    '--target-extensions', 'plpgsql',
    '--target-relations', '0',
  ];
  const ok = harness();
  const manifest = main(restoreArgv, {}, ok.deps);
  assert.deepEqual(manifest.restore, { route: 'fresh-database', pgCron: false });
  assert.ok(ok.calls.some((call) => call.label === 'pg-restore'));

  // A PG18 target is refused, and no restore runs.
  const wrongVersion = harness({ targetVersion: '180006\n' });
  assert.throws(() => main(restoreArgv, {}, wrongVersion.deps), /server-version-180006/);
  assert.ok(!wrongVersion.calls.some((call) => call.label === 'pg-restore'));

  // A non-empty target is refused, and no restore runs.
  const populated = harness();
  assert.throws(
    () => main([...restoreArgv.slice(0, -1), '7'], {}, populated.deps),
    /target-not-empty-relations-7/,
  );
  assert.ok(!populated.calls.some((call) => call.label === 'pg-restore'));

  // A pg_cron archive aimed at a database that is not the cron database.
  const cron = harness({ toc: PG_CRON_TOC });
  assert.throws(
    () => main([...restoreArgv, '--cron-database-name', 'postgres'], {}, cron.deps),
    /pg-cron-archive-needs-cron-database/,
  );
  assert.ok(!cron.calls.some((call) => call.label === 'pg-restore'));

  // Declaring a restore database without its service is refused.
  const noService = harness();
  assert.throws(
    () => main([...CAPTURE_ARGV, '--restore-database', 'h9_restore_dev2'], {}, noService.deps),
    /restore-service-missing/,
  );
});

test('run ids are UTC and manifest-shaped', () => {
  assert.equal(runId(new Date('2026-10-31T14:06:36.000Z')), 'h11c5-20261031T140636Z');
  assert.match(runId(new Date()), /^h11c5-\d{8}T\d{6}Z$/);
});

test('every refusal carries the fixed prefix and no value', () => {
  assert.match(REFUSAL, /^h11-backup refused$/);
  try {
    assertClientMajor(PG18_CLIENT);
    assert.fail('expected a refusal');
  } catch (error) {
    assert.ok(error.message.startsWith(`${REFUSAL}: `));
    assert.doesNotMatch(error.message, /pg_dump|PostgreSQL/);
  }
  // A refused service name must not echo the attempted value.
  try {
    assertServiceName("h9_dev_verified password = 'SYNTHETIC'");
    assert.fail('expected a refusal');
  } catch (error) {
    assert.doesNotMatch(error.message, /SYNTHETIC|password/i);
  }
});
