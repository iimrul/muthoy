// H-11 C5 capture executor contracts. Offline: no container, no database, no
// network. Fixtures marked "measured" are REAL output captured on 2026-10-31
// from `public.ecr.aws/supabase/postgres:17.6.1.159` on loopback with synthetic
// data only.
//
// Two review rounds shaped this file. Round 1: replacing the whole CLI with a
// throw left every test passing, because they all exercised helpers. Round 2:
// nine mutations still survived — the restore could be pointed at the SOURCE
// service, its arguments replaced with `--version`, and the manifest's hashes
// and byte sizes swapped for constants, all with 24/24 green. The restore mode
// is gone (see the module header) and the remaining mutations are covered here.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  REFUSAL,
  FORBIDDEN_ENV,
  assertArchiveInventoryUnambiguous,
  assertArchiveSourceMajor,
  assertClientMajor,
  assertNoCredentialInArgs,
  assertServerVersionNum,
  assertServiceName,
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

test("the toolchain must be PG17 — this host's own 18.6 client is refused", () => {
  assert.equal(assertClientMajor(PG17_CLIENT), 17);
  assert.throws(() => assertClientMajor(PG18_CLIENT), /client-major-18/);
  assert.throws(() => assertClientMajor('psql: command not found'), /client-version-unreadable/);
});

test('a 17.x server_version_num is required where one is measured', () => {
  assert.equal(assertServerVersionNum(170006), 170006); // the measured value
  assert.throws(() => assertServerVersionNum(180006), /server-version-180006/);
  assert.throws(() => assertServerVersionNum(169999), /server-version-169999/);
  assert.throws(() => assertServerVersionNum('seventeen'), /server-version-unreadable/);
});

test('the archive header pins the SOURCE major, so a PG16 dump cannot be filed as PG17', () => {
  assert.equal(assertArchiveSourceMajor(PG_CRON_TOC), '17.6');
  assert.throws(() => assertArchiveSourceMajor(';  Dumped from database version: 16.4'), /archive-source-major-16/);
  assert.throws(() => assertArchiveSourceMajor(';  Dumped from database version: 18.1'), /archive-source-major-18/);
  assert.throws(() => assertArchiveSourceMajor('no header here'), /archive-source-version-unreadable/);
});

test('a dump DOES carry the pg_cron schedule — cron.job appears as TABLE DATA', () => {
  const archive = classifyArchive(PG_CRON_TOC);
  assert.equal(archive.hasPgCron, true);
  assert.equal(archive.carriesCronJob, true);
  assert.equal(archive.tableDataCount, 4);
  assert.deepEqual(archive.extensions, ['pg_cron', 'pg_stat_statements']);
  assert.equal(archive.ambiguousEntries, 0);
  assert.equal(archive.unclassifiedEntries, 0);
});

test('the DEV-shaped archive has no pg_cron at all', () => {
  const archive = classifyArchive(DEV_SHAPED_TOC);
  assert.equal(archive.hasPgCron, false);
  assert.equal(archive.carriesCronJob, false);
  assert.deepEqual(archive.extensions, ['pgcrypto']);
});

test('realistic identifiers are not mistaken for cron.job or the pg_cron extension', () => {
  for (const line of [
    '3420; 0 16688 TABLE DATA cron job_run_details supabase_admin',
    '3421; 0 16689 TABLE DATA cron job-archive postgres',
    '3422; 0 16690 TABLE DATA cron job.old postgres',
    '3423; 0 16691 TABLE DATA public job postgres',
  ]) {
    assert.equal(classifyArchive(line).carriesCronJob, false, line);
  }
  const sneaky = classifyArchive('3424; 0 16692 TABLE DATA public EXTENSION - pg_cron postgres');
  assert.equal(sneaky.hasPgCron, false);
  assert.deepEqual(sneaky.extensions, []);
  assert.equal(classifyArchive('3418; 0 16669 TABLE DATA cron job supabase_admin').carriesCronJob, true);
  assert.equal(classifyArchive('6; 3079 16666 EXTENSION - pg_cron ').hasPgCron, true);
});

// pg_dump prints identifiers UNQUOTED, so a name or owner containing a space
// cannot be recovered from the listing. Guessing is what the second review
// caught; refusing is the fix.
test('unrecoverable identifiers are reported ambiguous, never guessed', () => {
  // `cron.job` owned by "reporting role" — four tokens, so name/owner is unknown.
  const ownerWithSpace = classifyArchive('3418; 0 16669 TABLE DATA cron job reporting role');
  assert.equal(ownerWithSpace.ambiguousEntries, 1);
  assert.equal(ownerWithSpace.carriesCronJob, false);
  // A double space means a field begins or ends with whitespace.
  const paddedName = classifyArchive('3418; 0 16669 TABLE DATA cron  job postgres');
  assert.equal(paddedName.ambiguousEntries, 1);
  assert.equal(paddedName.carriesCronJob, false);
  // And the capture refuses rather than recording an inventory it cannot trust.
  assert.throws(() => assertArchiveInventoryUnambiguous(ownerWithSpace), /archive-inventory-ambiguous-1/);
  assert.throws(() => assertArchiveInventoryUnambiguous(paddedName), /archive-inventory-ambiguous-1/);
  assert.equal(assertArchiveInventoryUnambiguous(classifyArchive(DEV_SHAPED_TOC)), true);
});

// An earlier revision's descriptor list was short, so these entries parsed as
// null and silently shrank entryCount.
test('entryCount counts every archive entry, including descriptors once missing', () => {
  const toc = [
    ';     Dumped from database version: 17.6',
    '2101; 2604 16720 DEFAULT public sales id postgres',
    '3701; 3256 16721 ROW SECURITY public sales postgres',
    '401; 1255 16722 PROCEDURE public do_thing() postgres',
    '402; 1247 16723 DOMAIN public paisa postgres',
    '403; 1255 16724 AGGREGATE public total(integer) postgres',
  ].join('\n');
  const archive = classifyArchive(toc);
  assert.equal(archive.entryCount, 5);
  assert.equal(archive.unclassifiedEntries, 0);
  assert.equal(archive.ambiguousEntries, 0);
  // An entry whose descriptor is genuinely unknown is counted and flagged.
  const odd = classifyArchive(';  Dumped from database version: 17.6\n9; 0 1 WIDGET public thing postgres');
  assert.equal(odd.entryCount, 1);
  assert.equal(odd.unclassifiedEntries, 1);
  assert.throws(() => assertArchiveInventoryUnambiguous(odd), /archive-inventory-unclassified-1/);
});

test('the TOC parser distinguishes longest-matching descriptors', () => {
  assert.equal(parseTocLine('3620; 0 16717 TABLE DATA public t postgres').descriptor, 'TABLE DATA');
  assert.equal(parseTocLine('200; 1259 16717 TABLE public t postgres').descriptor, 'TABLE');
  assert.equal(parseTocLine('201; 0 0 SEQUENCE OWNED BY public s postgres').descriptor, 'SEQUENCE OWNED BY');
  assert.equal(parseTocLine('202; 0 0 SEQUENCE public s postgres').descriptor, 'SEQUENCE');
  assert.equal(parseTocLine('; a comment'), null);
  assert.equal(parseTocLine(''), null);
});

test('a service name is an identifier, never a connection string', () => {
  assert.equal(assertServiceName('h9_dev_verified'), 'h9_dev_verified');
  for (const bad of ["h9_dev_verified password = 'SYNTHETIC'", 'h9 dev', 'host=127.0.0.1', '', '-starts-with-dash']) {
    assert.throws(() => assertServiceName(bad), /service-name-invalid/, JSON.stringify(bad));
  }
});

test('no password may reach argv or the environment, however it is spelled', () => {
  for (const name of FORBIDDEN_ENV) {
    assert.throws(() => assertNoCredentialInArgs([], { [name]: 'x' }), new RegExp(`env-${name.toLowerCase()}-set`));
  }
  // PGSYSCONFDIR is another service-file lookup route, missed by an earlier revision.
  assert.ok(FORBIDDEN_ENV.includes('PGSYSCONFDIR'));
  assert.throws(() => assertNoCredentialInArgs(['--dbname=host=h password=s']), /password-in-argument/);
  // Whitespace around `=`.
  assert.throws(() => assertNoCredentialInArgs(["--service=h9 password = 'x'"]), /password-in-argument/);
  // Option-prefixed URL.
  assert.throws(
    () => assertNoCredentialInArgs(['--dbname=postgresql://postgres:synthetic%40value@db.example.invalid/postgres']),
    /password-in-url/,
  );
  // Percent-encoded keyword in a URL query, which the second review walked through.
  assert.throws(
    () =>
      assertNoCredentialInArgs([
        '--dbname=postgresql://postgres@db.example.invalid/postgres?pass%77ord=SYNTHETIC',
      ]),
    /password-in-argument/,
  );
  assert.throws(
    () => assertNoCredentialInArgs(['--dbname=postgresql://postgres@h/db?ssl%70assword=SYNTHETIC']),
    /password-in-argument/,
  );
  assert.throws(() => assertNoCredentialInArgs(['--dbname=host=h sslpassword=s']), /password-in-argument/);
  // The sanctioned shape, and a passwordless URL, both pass.
  assert.equal(assertNoCredentialInArgs(['--service', 'h9_dev_verified', '--out', 'D:/run'], {}), true);
  assert.equal(assertNoCredentialInArgs(['postgresql://postgres@127.0.0.1:54329/postgres'], {}), true);
});

test('a manifest records measurements, and its fields must agree', () => {
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
  assert.equal(manifest.kind, 'h11-c5-capture');
  assert.equal(manifest.source.pgMajor, 17);
  assert.equal(manifest.restorePerformed, false);
  assert.equal(manifest.hostedRecoveryAcceptance, null);

  assert.throws(() => buildManifest({ ...base, clientMajor: 18 }), /manifest-client-major-invalid/);
  assert.throws(() => buildManifest({ ...base, serverVersionNum: 180006 }), /server-version-180006/);
  // The contradiction the second review found: a PG16 archive beside pgMajor 17.
  assert.throws(() => buildManifest({ ...base, archiveSourceVersion: '16.4' }), /manifest-archive-source-invalid/);
  assert.throws(() => buildManifest({ ...base, archiveSourceVersion: '18.1' }), /manifest-archive-source-invalid/);
  assert.throws(() => buildManifest({ ...base, capturedAtUtc: 'not-a-date' }), /manifest-timestamp-invalid/);
  // A parseable but non-UTC stamp: `Date.parse` accepts it, so only the `Z`
  // requirement rejects it. Without this case, dropping that check survives.
  assert.throws(
    () => buildManifest({ ...base, capturedAtUtc: '2026-10-31T14:06:36+06:00' }),
    /manifest-timestamp-invalid/,
  );
  // An impossible run date.
  assert.throws(
    () => buildManifest({ ...base, capturedAtUtc: '1999-01-01T00:00:00.000Z' }),
    /manifest-timestamp-implausible/,
  );
  assert.throws(() => buildManifest({ ...base, runId: 'whatever' }), /manifest-run-id-invalid/);
  assert.throws(() => buildManifest({ ...base, files: [] }), /manifest-file-evidence-incomplete/);
  assert.throws(() => buildManifest({ ...base, archive: {} }), /manifest-archive-incomplete/);
  // A negative count is not a measurement.
  assert.throws(
    () => buildManifest({ ...base, archive: { ...base.archive, entryCount: -1 } }),
    /manifest-archive-incomplete/,
  );
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
    [{ path: 'D:/run/database.dump', sha256: 'a'.repeat(64), bytes: -5 }],
    [{ path: '', sha256: 'a'.repeat(64), bytes: 10 }],
  ]) {
    assert.throws(() => buildManifest({ ...base, files }), /manifest-file-evidence-incomplete/);
  }
  assert.throws(() => buildManifest({ ...base, runId: '', files: [] }), /manifest-inputs-incomplete/);
});

// ---------------------------------------------------------------------------
// CLI enforcement. Without these, replacing main() with a throw passes.
// ---------------------------------------------------------------------------

const ARCHIVE_BYTES = Buffer.from('synthetic-archive-bytes');
const TOC_BYTES = Buffer.from('synthetic-toc-bytes');
const BYTE_SIZE = 80200;

/** A dependency double that records every command the CLI issues. */
function harness({ toc = DEV_SHAPED_TOC, version = PG17_CLIENT, restoreVersion = null, existing = false } = {}) {
  const calls = [];
  const written = new Map();
  return {
    calls,
    written,
    deps: {
      run(command, args, label) {
        calls.push({ command, args, label });
        if (label === 'pg-restore-version') return restoreVersion ?? version;
        if (label === 'pg-dump-version') return version;
        if (label === 'pg-restore-list') return toc;
        return '';
      },
      exists: () => existing,
      mkdir: () => {},
      write: (path, body) => written.set(path, body),
      read: (path) => (String(path).endsWith('archive.toc') ? TOC_BYTES : ARCHIVE_BYTES),
      size: () => BYTE_SIZE,
      now: () => new Date('2026-10-31T14:06:36.000Z'),
    },
  };
}

const CAPTURE_ARGV = ['--service', 'h9_dev_verified', '--pg-dump', '/usr/bin/pg_dump', '--out', 'D:/run'];

test('the CLI captures, checks both clients, lists the archive and writes a manifest', () => {
  const h = harness();
  const manifest = main(CAPTURE_ARGV, {}, h.deps);
  assert.equal(manifest.runId, 'h11c5-20261031T140636Z');
  assert.equal(manifest.source.archiveSourceVersion, '17.6');
  assert.equal(manifest.restorePerformed, false);
  assert.deepEqual(
    h.calls.map((call) => call.label),
    ['pg-dump-version', 'pg-restore-version', 'pg-dump', 'pg-restore-list'],
  );
  const dump = h.calls.find((call) => call.label === 'pg-dump');
  assert.ok(dump.args.includes('--dbname=service=h9_dev_verified'));
  assert.ok(!JSON.stringify(dump.args).match(/password/i));
  assert.ok([...h.written.keys()].some((path) => path.endsWith('manifest.json')));
});

// Kills "replace measured hashes with constants" and "replace byte sizes with 999":
// the manifest must carry the digest of the bytes actually read, and the size
// actually reported.
test('the manifest carries the MEASURED digest and size, not a plausible constant', () => {
  const h = harness();
  const manifest = main(CAPTURE_ARGV, {}, h.deps);
  const expectedArchive = createHash('sha256').update(ARCHIVE_BYTES).digest('hex');
  const expectedToc = createHash('sha256').update(TOC_BYTES).digest('hex');
  const dumpFile = manifest.files.find((file) => file.path.endsWith('database.dump'));
  const tocFile = manifest.files.find((file) => file.path.endsWith('archive.toc'));
  assert.equal(dumpFile.sha256, expectedArchive);
  assert.equal(tocFile.sha256, expectedToc);
  assert.notEqual(dumpFile.sha256, tocFile.sha256);
  assert.equal(dumpFile.bytes, BYTE_SIZE);
  assert.equal(tocFile.bytes, BYTE_SIZE);
});

// Kills "remove validation of pg_restore version, retaining its invocation".
test('a mixed toolchain is refused even when pg_dump itself is PG17', () => {
  const mixed = harness({ restoreVersion: PG18_CLIENT });
  assert.throws(() => main(CAPTURE_ARGV, {}, mixed.deps), /client-major-18/);
  assert.deepEqual(mixed.calls.map((call) => call.label), ['pg-dump-version', 'pg-restore-version']);
  // And a PG17 pg_dump beside a PG16 pg_restore.
  const older = harness({ restoreVersion: 'pg_restore (PostgreSQL) 16.9' });
  assert.throws(() => main(CAPTURE_ARGV, {}, older.deps), /client-major-16/);
});

test('the CLI refuses a PG18 client before it dumps anything', () => {
  const h = harness({ version: PG18_CLIENT });
  assert.throws(() => main(CAPTURE_ARGV, {}, h.deps), /client-major-18/);
  assert.deepEqual(h.calls.map((call) => call.label), ['pg-dump-version']);
});

test('the CLI refuses a non-PG17 ARCHIVE after listing, and writes no manifest', () => {
  const h = harness({ toc: ';  Dumped from database version: 16.4\n3; 3079 1 EXTENSION - pgcrypto ' });
  assert.throws(() => main(CAPTURE_ARGV, {}, h.deps), /archive-source-major-16/);
  assert.ok(![...h.written.keys()].some((path) => path.endsWith('manifest.json')));
});

test('the CLI refuses an archive whose inventory cannot be trusted', () => {
  const h = harness({
    toc: ';  Dumped from database version: 17.6\n3418; 0 16669 TABLE DATA cron job reporting role',
  });
  assert.throws(() => main(CAPTURE_ARGV, {}, h.deps), /archive-inventory-ambiguous-1/);
  assert.ok(![...h.written.keys()].some((path) => path.endsWith('manifest.json')));
});

test('the CLI refuses a credential-bearing invocation before running anything', () => {
  const h = harness();
  assert.throws(() => main(CAPTURE_ARGV, { PGPASSWORD: 'x' }, h.deps), /env-pgpassword-set/);
  assert.throws(() => main(CAPTURE_ARGV, { PGSYSCONFDIR: 'x' }, h.deps), /env-pgsysconfdir-set/);
  assert.throws(() => main([...CAPTURE_ARGV, '--pg-restore', "/x password = 'y'"], {}, h.deps), /password-in-argument/);
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

// The restore mode was removed because its gates checked what the operator
// typed. Accepting those flags silently would be worse than refusing them.
test('restore flags are refused outright rather than quietly ignored', () => {
  for (const flag of ['--restore-service', '--restore-database', '--target-schemas', '--target-relations']) {
    const h = harness();
    assert.throws(() => main([...CAPTURE_ARGV, flag, 'anything'], {}, h.deps), /restore-not-supported/, flag);
    assert.equal(h.calls.length, 0, flag);
  }
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
  try {
    assertServiceName("h9_dev_verified password = 'SYNTHETIC'");
    assert.fail('expected a refusal');
  } catch (error) {
    assert.doesNotMatch(error.message, /SYNTHETIC|password/i);
  }
});
