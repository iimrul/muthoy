// H-11 C5 capture executor contracts. Offline: no container, no database, no
// network. Fixtures marked "measured" are REAL output captured on 2026-10-31
// from `public.ecr.aws/supabase/postgres:17.6.1.159` on loopback with synthetic
// data only.
//
// Three review rounds shaped this file, and the third indicted the TESTS rather
// than the code. Its diagnosis, which was right:
//
//   - "The forbidden-variable test enumerates the implementation's own list;
//     deleting a variable deletes its test case."  -> the list below is written
//     out literally, and a separate test asserts the module's list EQUALS it.
//   - "Command doubles answer by label regardless of command or arguments."
//     -> the double now dispatches on the real command path and argv, and
//     refuses anything it was not expecting, so using the wrong binary, the
//     wrong dump format or the wrong output path fails.
//   - "Manifest assertions inspect the returned object without parsing
//     persisted JSON."  -> the written bytes are parsed and asserted.
//   - "Fractional values and malformed 17.x versions lack negative fixtures."
//     -> they have them.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  ACCEPTED_FLAGS,
  FORBIDDEN_ENV,
  REFUSAL,
  assertArchiveSourceMajor,
  assertClientMajor,
  assertNoCredentialInArgs,
  assertServerVersionNum,
  assertServiceName,
  buildManifest,
  main,
  parseArgs,
  runId,
} from '../dev-backup.mjs';

// Measured: `docker exec muthoy-h9src pg_dump --version`, and this host's own.
const PG17_CLIENT = 'pg_dump (PostgreSQL) 17.6';
const PG18_CLIENT = 'pg_dump (PostgreSQL) 18.6';

// Measured: the real archive header, which is all this module reads from a TOC.
const TOC_17 = [
  ';',
  '; Archive created at 2026-10-31 14:06:36 UTC',
  ';     TOC Entries: 204',
  ';     Dumped from database version: 17.6',
  ';     Dumped by pg_dump version: 17.6',
  ';',
  '3418; 0 16669 TABLE DATA cron job supabase_admin',
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
  assert.throws(() => assertServerVersionNum(170000.5), /server-version-unreadable/);
});

test('the archive header pins the SOURCE major, so a PG16 dump cannot be filed as PG17', () => {
  assert.equal(assertArchiveSourceMajor(TOC_17), '17.6');
  assert.throws(() => assertArchiveSourceMajor(';  Dumped from database version: 16.4'), /archive-source-major-16/);
  assert.throws(() => assertArchiveSourceMajor(';  Dumped from database version: 18.1'), /archive-source-major-18/);
  assert.throws(() => assertArchiveSourceMajor('no header here'), /archive-source-version-unreadable/);
});

test('a service name is an identifier, never a connection string', () => {
  assert.equal(assertServiceName('h9_dev_verified'), 'h9_dev_verified');
  for (const bad of ["h9_dev_verified password = 'SYNTHETIC'", 'h9 dev', 'host=127.0.0.1', '', '-starts-with-dash']) {
    assert.throws(() => assertServiceName(bad), /service-name-invalid/, JSON.stringify(bad));
  }
});

// Written out literally. Deleting an entry from the module's list must FAIL
// here, which it cannot do if the test iterates that same list.
const EXPECTED_FORBIDDEN_ENV = ['PGPASSWORD', 'PGPASSFILE', 'PGSERVICE', 'PGSERVICEFILE', 'PGSYSCONFDIR'];

test('the forbidden-variable set is exactly the five libpq credential routes', () => {
  assert.deepEqual([...FORBIDDEN_ENV].sort(), [...EXPECTED_FORBIDDEN_ENV].sort());
});

test('each forbidden variable is refused individually', () => {
  for (const name of EXPECTED_FORBIDDEN_ENV) {
    assert.throws(
      () => assertNoCredentialInArgs([], { [name]: 'x' }),
      new RegExp(`env-${name.toLowerCase()}-set`),
      name,
    );
  }
});

test('no password may reach argv, however it is spelled', () => {
  assert.throws(() => assertNoCredentialInArgs(['--dbname=host=h password=s']), /password-in-argument/);
  assert.throws(() => assertNoCredentialInArgs(["--service=h9 password = 'x'"]), /password-in-argument/);
  assert.throws(() => assertNoCredentialInArgs(['--dbname=host=h sslpassword=s']), /password-in-argument/);
  assert.throws(
    () => assertNoCredentialInArgs(['--dbname=postgresql://postgres:synthetic%40value@db.example.invalid/postgres']),
    /password-in-url/,
  );
  // Percent-encoded, which round 2 walked through.
  assert.throws(
    () => assertNoCredentialInArgs(['--dbname=postgresql://postgres@h/db?pass%77ord=SYNTHETIC']),
    /password-in-argument/,
  );
  assert.throws(() => assertNoCredentialInArgs(['--dbname=h?ssl%70assword=SYNTHETIC']), /password-in-argument/);
  // Double-encoded: `%2577` decodes to `%77`, then to `w`. Kills removal of the
  // second decoding pass.
  assert.throws(() => assertNoCredentialInArgs(['--dbname=h?pass%2577ord=SYNTHETIC']), /password-in-argument/);
  // The sanctioned shape, and a passwordless URL, both pass.
  assert.equal(assertNoCredentialInArgs(['--service', 'h9_dev_verified', '--out', 'D:/run'], {}), true);
  assert.equal(assertNoCredentialInArgs(['postgresql://postgres@127.0.0.1:54329/postgres'], {}), true);
});

test('only the four accepted flags are tolerated, in one spelling', () => {
  assert.deepEqual([...ACCEPTED_FLAGS], ['--service', '--pg-dump', '--pg-restore', '--out']);
  const good = parseArgs(['--service', 's', '--pg-dump', '/p', '--out', '/o']);
  assert.equal(good.get('--service'), 's');
  // Obsolete restore flags, which an earlier hand-written rejection list missed.
  for (const flag of [
    '--restore',
    '--restore-service',
    '--restore-database',
    '--target-schemas',
    '--target-extensions',
    '--target-relations',
    '--cron-database-name',
    '--typo',
  ]) {
    assert.throws(() => parseArgs([...['--service', 's'], flag, 'v']), /argument-unknown/, flag);
  }
  // `--flag=value` is refused so there is exactly one accepted spelling.
  assert.throws(() => parseArgs(['--service=s']), /argument-form-invalid/);
  assert.throws(() => parseArgs(['--restore-service=x']), /argument-unknown/);
  assert.throws(() => parseArgs(['bare-token']), /argument-unexpected/);
  assert.throws(() => parseArgs(['--service']), /argument-value-missing/);
  assert.throws(() => parseArgs(['--service', '--out']), /argument-value-missing/);
  assert.throws(() => parseArgs(['--service', 'a', '--service', 'b']), /argument-repeated/);
});

const GOOD_MANIFEST_INPUT = {
  serviceName: 'h9_dev_verified',
  runId: 'h11c5-20261031T140636Z',
  capturedAtUtc: '2026-10-31T14:06:36.000Z',
  serverVersionNum: 170006,
  clientMajor: 17,
  archiveSourceVersion: '17.6',
  files: [
    { path: 'D:/run/database.dump', sha256: 'a'.repeat(64), bytes: 80200 },
    { path: 'D:/run/archive.toc', sha256: 'b'.repeat(64), bytes: 4096 },
  ],
  nowMs: Date.parse('2026-10-31T15:00:00.000Z'),
};

test('a manifest records the capture and makes no claim about the archive contents', () => {
  const manifest = buildManifest(GOOD_MANIFEST_INPUT);
  assert.equal(manifest.kind, 'h11-c5-capture');
  assert.equal(manifest.source.pgMajor, 17);
  assert.equal(manifest.source.archiveSourceVersion, '17.6');
  assert.equal(manifest.restorePerformed, false);
  assert.equal(manifest.hostedRecoveryAcceptance, null);
  // The inventory is the saved file, not an interpretation of it.
  assert.equal(manifest.archive, undefined);
  assert.ok(manifest.files.some((file) => file.path.endsWith('archive.toc')));
});

test('contradictory or impossible manifest evidence is refused', () => {
  const bad = (patch, pattern) =>
    assert.throws(() => buildManifest({ ...GOOD_MANIFEST_INPUT, ...patch }), pattern, JSON.stringify(patch));
  bad({ clientMajor: 18 }, /manifest-client-major-invalid/);
  bad({ serverVersionNum: 180006 }, /server-version-180006/);
  // A PG16 archive beside pgMajor 17, and a missing one: both refused.
  bad({ archiveSourceVersion: '16.4' }, /manifest-archive-source-invalid/);
  bad({ archiveSourceVersion: null }, /manifest-archive-source-invalid/);
  bad({ archiveSourceVersion: undefined }, /manifest-archive-source-invalid/);
  // A malformed `17.x` prefix, which an "any 17. prefix" check would accept.
  bad({ archiveSourceVersion: '17.x' }, /manifest-archive-source-invalid/);
  bad({ archiveSourceVersion: '17.' }, /manifest-archive-source-invalid/);
  bad({ archiveSourceVersion: '170' }, /manifest-archive-source-invalid/);
  bad({ capturedAtUtc: 'not-a-date' }, /manifest-timestamp-invalid/);
  // Parseable but not UTC: only the `Z` requirement rejects it.
  bad({ capturedAtUtc: '2026-10-31T14:06:36+06:00' }, /manifest-timestamp-invalid/);
  bad({ capturedAtUtc: '1999-01-01T00:00:00.000Z' }, /manifest-timestamp-implausible/);
  // A capture from the future.
  bad({ capturedAtUtc: '2099-01-01T00:00:00.000Z' }, /manifest-timestamp-implausible/);
  bad({ runId: 'whatever' }, /manifest-run-id-invalid/);
  // Impossible run-id digits.
  bad({ runId: 'h11c5-20261331T140636Z' }, /manifest-run-id-invalid/);
  bad({ runId: 'h11c5-20261031T250636Z' }, /manifest-run-id-invalid/);
  bad({ runId: 'h11c5-19991031T140636Z' }, /manifest-run-id-invalid/);
  bad({ serviceName: "h9 password = 'x'" }, /service-name-invalid/);
});

test('file evidence must be the two expected artifacts, with distinct real digests', () => {
  const bad = (files, pattern) =>
    assert.throws(() => buildManifest({ ...GOOD_MANIFEST_INPUT, files }), pattern, JSON.stringify(files));
  const dump = { path: 'D:/run/database.dump', sha256: 'a'.repeat(64), bytes: 80200 };
  const toc = { path: 'D:/run/archive.toc', sha256: 'b'.repeat(64), bytes: 4096 };
  bad([], /manifest-file-evidence-incomplete/);
  bad([dump], /manifest-file-evidence-incomplete/);
  bad([dump, toc, toc], /manifest-file-evidence-incomplete/);
  // The TOC must be present: an earlier revision would have accepted the dump twice.
  bad([dump, { ...dump, path: 'D:/run/other.bin' }], /manifest-file-evidence-incomplete/);
  bad([{ ...dump, sha256: 'short' }, toc], /manifest-file-evidence-incomplete/);
  bad([{ ...dump, bytes: 0 }, toc], /manifest-file-evidence-incomplete/);
  bad([{ ...dump, bytes: -5 }, toc], /manifest-file-evidence-incomplete/);
  // Fractional byte counts are not measurements.
  bad([{ ...dump, bytes: 1.5 }, toc], /manifest-file-evidence-incomplete/);
  bad([{ ...dump, path: '' }, toc], /manifest-file-evidence-incomplete/);
  // Two files with the same digest means one was not really hashed.
  bad([dump, { ...toc, sha256: dump.sha256 }], /manifest-file-digests-identical/);
});

// ---------------------------------------------------------------------------
// CLI enforcement, through a double that checks the real command and argv.
// ---------------------------------------------------------------------------

const PG_DUMP = '/usr/bin/pg_dump';
const PG_RESTORE = '/usr/bin/pg_restore';
const ARCHIVE_BYTES = Buffer.from('synthetic-archive-bytes');
const TOC_BYTES = Buffer.from('synthetic-toc-bytes');
const DUMP_SIZE = 80200;
const TOC_SIZE = 4096;
const EXPECTED_DIR = 'D:/run\\h11c5-20261031T140636Z'.replace('/', '\\');

function harness({ toc = TOC_17, dumpVersion = PG17_CLIENT, restoreVersion = null, existing = false } = {}) {
  const calls = [];
  const written = new Map();
  return {
    calls,
    written,
    deps: {
      // Dispatch on the COMMAND and ARGV, not on a label, so a mutation that
      // swaps binaries or paths cannot be answered as if it were correct.
      run(command, args, label) {
        calls.push({ command, args, label });
        if (args.length === 1 && args[0] === '--version') {
          if (command === PG_DUMP) return dumpVersion;
          if (command === PG_RESTORE) return restoreVersion ?? dumpVersion;
          throw new Error('harness: --version from an unexpected binary: ' + command);
        }
        if (command === PG_RESTORE && args[0] === '--list') {
          if (!String(args[1]).endsWith('database.dump')) {
            throw new Error('harness: listed a file that is not the dump: ' + args[1]);
          }
          return toc;
        }
        if (command === PG_DUMP) {
          const joined = args.join(' ');
          if (!joined.includes('--format=custom')) throw new Error('harness: dump is not custom format');
          if (!args.some((arg) => String(arg).startsWith('--file=') && String(arg).endsWith('database.dump'))) {
            throw new Error('harness: dump did not write database.dump');
          }
          return '';
        }
        throw new Error('harness: unexpected call ' + command + ' ' + args.join(' ') + ' (' + label + ')');
      },
      exists: () => existing,
      mkdir: () => {},
      write: (path, body) => written.set(String(path), body),
      read: (path) => (String(path).endsWith('archive.toc') ? TOC_BYTES : ARCHIVE_BYTES),
      size: (path) => (String(path).endsWith('archive.toc') ? TOC_SIZE : DUMP_SIZE),
      now: () => new Date('2026-10-31T14:06:36.000Z'),
    },
  };
}

const CAPTURE_ARGV = ['--service', 'h9_dev_verified', '--pg-dump', PG_DUMP, '--out', 'D:/run'];

test('the CLI dumps with the right binary, format and path, then lists that dump', () => {
  const h = harness();
  main(CAPTURE_ARGV, {}, h.deps);
  const dump = h.calls.find((call) => call.label === 'pg-dump');
  assert.equal(dump.command, PG_DUMP, 'the dump must use pg_dump, not pg_restore');
  assert.ok(dump.args.includes('--dbname=service=h9_dev_verified'));
  assert.ok(dump.args.includes('--format=custom'), 'a plain-format dump is not the archive we hash');
  assert.ok(dump.args.some((arg) => arg.endsWith('database.dump')));
  assert.ok(!JSON.stringify(dump.args).match(/password/i));
  const list = h.calls.find((call) => call.label === 'pg-restore-list');
  assert.equal(list.command, PG_RESTORE);
  assert.deepEqual(list.args[0], '--list');
  assert.ok(String(list.args[1]).endsWith('database.dump'), 'it must list the dump it just wrote');
});

// Parses the PERSISTED bytes, so writing `{}` as the manifest cannot pass.
test('the manifest written to disk carries the measured digests and sizes', () => {
  const h = harness();
  main(CAPTURE_ARGV, {}, h.deps);
  const entry = [...h.written.entries()].find(([path]) => path.endsWith('manifest.json'));
  assert.ok(entry, 'a manifest must be written');
  const persisted = JSON.parse(entry[1]);
  assert.equal(persisted.kind, 'h11-c5-capture');
  assert.equal(persisted.runId, 'h11c5-20261031T140636Z');
  assert.equal(persisted.source.archiveSourceVersion, '17.6');
  const dumpFile = persisted.files.find((file) => file.path.endsWith('database.dump'));
  const tocFile = persisted.files.find((file) => file.path.endsWith('archive.toc'));
  assert.equal(dumpFile.sha256, createHash('sha256').update(ARCHIVE_BYTES).digest('hex'));
  assert.equal(tocFile.sha256, createHash('sha256').update(TOC_BYTES).digest('hex'));
  assert.equal(dumpFile.bytes, DUMP_SIZE);
  assert.equal(tocFile.bytes, TOC_SIZE);
  // And the TOC text itself is saved verbatim as the inventory evidence.
  const tocEntry = [...h.written.entries()].find(([path]) => path.endsWith('archive.toc'));
  assert.equal(tocEntry[1], TOC_17);
});

test('a mixed toolchain is refused even when pg_dump itself is PG17', () => {
  const mixed = harness({ restoreVersion: 'pg_restore (PostgreSQL) 18.6' });
  assert.throws(() => main(CAPTURE_ARGV, {}, mixed.deps), /client-major-18/);
  assert.deepEqual(mixed.calls.map((call) => call.label), ['pg-dump-version', 'pg-restore-version']);
  const older = harness({ restoreVersion: 'pg_restore (PostgreSQL) 16.9' });
  assert.throws(() => main(CAPTURE_ARGV, {}, older.deps), /client-major-16/);
});

test('the CLI refuses a PG18 client before it dumps anything', () => {
  const h = harness({ dumpVersion: PG18_CLIENT });
  assert.throws(() => main(CAPTURE_ARGV, {}, h.deps), /client-major-18/);
  assert.deepEqual(h.calls.map((call) => call.label), ['pg-dump-version']);
});

test('the CLI refuses a non-PG17 ARCHIVE after listing, and writes no manifest', () => {
  const h = harness({ toc: ';  Dumped from database version: 16.4' });
  assert.throws(() => main(CAPTURE_ARGV, {}, h.deps), /archive-source-major-16/);
  assert.ok(![...h.written.keys()].some((path) => path.endsWith('manifest.json')));
});

test('an archive with no readable source header is refused', () => {
  const h = harness({ toc: '; nothing useful here' });
  assert.throws(() => main(CAPTURE_ARGV, {}, h.deps), /archive-source-version-unreadable/);
});

test('the CLI refuses a credential-bearing invocation before running anything', () => {
  for (const name of EXPECTED_FORBIDDEN_ENV) {
    const h = harness();
    assert.throws(() => main(CAPTURE_ARGV, { [name]: 'x' }, h.deps), new RegExp(`env-${name.toLowerCase()}-set`));
    assert.equal(h.calls.length, 0, name);
  }
  const h = harness();
  assert.throws(() => main([...CAPTURE_ARGV, '--pg-restore', "/x password = 'y'"], {}, h.deps), /password-in-argument/);
  assert.equal(h.calls.length, 0);
});

test('the CLI refuses unknown and obsolete flags rather than ignoring them', () => {
  for (const flag of ['--restore', '--target-extensions', '--cron-database-name', '--restore-database']) {
    const h = harness();
    assert.throws(() => main([...CAPTURE_ARGV, flag, 'v'], {}, h.deps), /argument-unknown/, flag);
    assert.equal(h.calls.length, 0, flag);
  }
  const eq = harness();
  assert.throws(() => main(['--service=h9_dev_verified', '--pg-dump', PG_DUMP, '--out', 'D:/run'], {}, eq.deps), /argument-form-invalid/);
});

test('the CLI refuses a service name that is really a connection string', () => {
  const h = harness();
  assert.throws(
    () => main(['--service', 'host=127.0.0.1', '--pg-dump', PG_DUMP, '--out', 'D:/run'], {}, h.deps),
    /service-name-invalid/,
  );
  assert.equal(h.calls.length, 0);
});

test('the CLI will not overwrite an existing run directory', () => {
  const h = harness({ existing: true });
  assert.throws(() => main(CAPTURE_ARGV, {}, h.deps), /run-directory-exists/);
});

test('a pg-dump path that yields no distinct pg-restore path is refused', () => {
  const h = harness();
  assert.throws(
    () => main(['--service', 'h9_dev_verified', '--pg-dump', '/usr/bin/pgdump', '--out', 'D:/run'], {}, h.deps),
    /pg-restore-path-indistinct/,
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
  try {
    assertServiceName("h9_dev_verified password = 'SYNTHETIC'");
    assert.fail('expected a refusal');
  } catch (error) {
    assert.doesNotMatch(error.message, /SYNTHETIC|password/i);
  }
});

// Regression guards for round 3's findings 1 and 2: the archive classifier that
// caused them no longer exists, so no legitimate descriptor can be refused.
test('ordinary PG17 descriptors no longer affect a capture at all', () => {
  for (const descriptor of [
    'EVENT TRIGGER',
    'STATISTICS',
    'COLLATION',
    'RULE',
    'TEXT SEARCH CONFIGURATION',
    'SECURITY LABEL',
    'DEFAULT',
    'ROW SECURITY',
  ]) {
    const h = harness({
      toc: [';     Dumped from database version: 17.6', '5; 0 1 ' + descriptor + ' public thing postgres'].join('\n'),
    });
    const manifest = main(CAPTURE_ARGV, {}, h.deps);
    assert.equal(manifest.source.archiveSourceVersion, '17.6', descriptor);
  }
  // And a whitespace-bearing identifier, which cannot be parsed from unquoted
  // output, is likewise no longer a reason to refuse a real backup.
  const spaced = harness({
    toc: [';     Dumped from database version: 17.6', '1; 0 1 TABLE DATA  cron job reporting role'].join('\n'),
  });
  assert.equal(main(CAPTURE_ARGV, {}, spaced.deps).source.archiveSourceVersion, '17.6');
});
