#!/usr/bin/env node
// H-11 C5 — the repeatable DEV backup and isolated-restore executor.
//
// `backend/supabase/checks/h9_pg17_restore.md` is the approved procedure and
// stays authoritative. This file is the part of it a machine can repeat: the
// version and emptiness gates, the archive inventory, the hashes, the manifest,
// and an optional restore into a declared isolated target. It performs NO hosted
// write — `pg_dump` is read-only and the restore only ever targets a loopback
// database the caller names — and it never accepts, prints or stores a password.
//
// Four of its refusals were measured on 2026-10-31 against real
// `public.ecr.aws/supabase/postgres:17.6.1.159` containers on loopback, with
// synthetic data only, and each is a way the written procedure fails when
// executed literally:
//
//  1. SUPABASE'S IMAGE IS NOT EMPTY. Step 8 wants an "EMPTY isolated target"
//     and step 9 forbids `--clean`. The image's own `postgres` database ships
//     `auth`, `cron`, `vault` and `storage` already created, so a restore there
//     dies on `schema "auth" already exists` before any data moves.
//  2. A pg_cron ARCHIVE NEEDS THE SCHEDULER'S OWN DATABASE. pg_cron refuses to
//     be created anywhere but `cron.database_name` — "the pg_cron background
//     worker reads job descriptions from this database". On a LOCAL target that
//     setting is changeable (it needs a server restart), so this is a
//     configuration requirement rather than an impossibility; on a hosted
//     project, where the setting is not yours, it is a hard stop. The guard
//     below compares the archive against the target's EFFECTIVE setting, which
//     is correct either way.
//  3. OWNER PRESERVATION NEEDS SUPERUSER. Restoring objects owned by
//     `supabase_admin` requires `SET ROLE supabase_admin`, which `postgres` is
//     not granted — it is neither a superuser nor a member. A hosted Supabase
//     project only ever gives you `postgres`.
//  4. CONSISTENT OWNERSHIP RESTORES CLEANLY. A postgres-owned synthetic source
//     restored by `postgres` into a fresh database succeeded with
//     `--exit-on-error --single-transaction`, preserving SECURITY DEFINER, the
//     owner and the ACLs. That is a SUBSET of DEV's shape, not DEV's shape:
//     DEV's recorded inventory includes `supabase_admin`-owned extensions this
//     fixture did not contain.
//
// None of the above is hosted recovery acceptance. It is tooling verification,
// and C5 additionally requires `restore_drill.md` Part B (device restore) and
// Part C (migration at scale), which need a physical handset.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const REFUSAL = 'h11-backup refused';

/** Fixed vocabulary only: a reason code, never a message carrying a value. */
export function refuse(reason) {
  throw new Error(`${REFUSAL}: ${reason}`);
}

/**
 * The toolchain must be PG17. The procedure refuses a PG18 target outright, and
 * this host's own client is 18.6 — the PG17 binaries live inside the approved
 * image, which is why the executor takes a client path rather than trusting $PATH.
 */
export function assertClientMajor(versionOutput) {
  const match = /\b(\d+)\.(\d+)\b/.exec(String(versionOutput ?? ''));
  if (!match) refuse('client-version-unreadable');
  if (Number(match[1]) !== 17) refuse(`client-major-${match[1]}`);
  return Number(match[1]);
}

/** A stock tag is not proof; the live server must report a 17.x version number. */
export function assertServerVersionNum(value) {
  const number = Number(value);
  if (!Number.isInteger(number)) refuse('server-version-unreadable');
  if (number < 170000 || number >= 180000) refuse(`server-version-${number}`);
  return number;
}

/**
 * The archive header records the server it came from. Enforcing it at capture
 * time means a PG16 or PG18 source cannot be recorded as a PG17 backup, which
 * is what made an earlier revision's manifest claim `pgMajor: 17` regardless.
 */
export function assertArchiveSourceMajor(tocText) {
  const match = /Dumped from database version:\s*(\d+)\.(\d+)/.exec(String(tocText ?? ''));
  if (!match) refuse('archive-source-version-unreadable');
  if (Number(match[1]) !== 17) refuse(`archive-source-major-${match[1]}`);
  return `${match[1]}.${match[2]}`;
}

// `pg_restore --list` descriptors this parser understands. Anchoring on these
// is what stops a table literally named `EXTENSION - pg_cron` from being read as
// the pg_cron extension, and `cron.job-archive` from being read as `cron.job`.
const DESCRIPTORS = Object.freeze([
  'TABLE DATA',
  'SEQUENCE OWNED BY',
  'FK CONSTRAINT',
  'MATERIALIZED VIEW DATA',
  'MATERIALIZED VIEW',
  'DEFAULT ACL',
  'SEQUENCE SET',
  'EXTENSION',
  'COMMENT',
  'SCHEMA',
  'TABLE',
  'INDEX',
  'CONSTRAINT',
  'TRIGGER',
  'FUNCTION',
  'VIEW',
  'TYPE',
  'SEQUENCE',
  'ACL',
  'POLICY',
  'PUBLICATION',
]);

/**
 * Parse one TOC line into {descriptor, schema, name, owner}. The format is
 * `<id>; <tableoid> <oid> <DESCRIPTOR> <schema> <name> <owner>`. A name may
 * contain spaces, so schema is the first remaining token, owner the last, and
 * the name is everything between — which keeps `job-archive` as the name rather
 * than matching a `job` prefix.
 */
export function parseTocLine(line) {
  const text = String(line ?? '');
  const head = /^\s*\d+;\s+\d+\s+\d+\s+(.*)$/.exec(text);
  if (!head) return null;
  const rest = head[1].trimEnd();
  const descriptor = DESCRIPTORS.find((item) => rest === item || rest.startsWith(`${item} `));
  if (!descriptor) return null;
  const tokens = rest.slice(descriptor.length).trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return { descriptor, schema: null, name: null, owner: null };
  if (tokens.length === 1) return { descriptor, schema: null, name: tokens[0], owner: null };
  const [schema, ...tail] = tokens;
  const owner = tail.length > 1 ? tail[tail.length - 1] : null;
  const name = (tail.length > 1 ? tail.slice(0, -1) : tail).join(' ');
  return { descriptor, schema, name, owner };
}

/**
 * Read `pg_restore --list`. The inventory is evidence in its own right: it is
 * how we know `cron.job` IS carried by a dump — pg_cron marks its job table for
 * extension config dump — rather than assuming the schedule is lost.
 */
export function classifyArchive(tocText) {
  const entries = String(tocText ?? '')
    .split(/\r?\n/)
    .map(parseTocLine)
    .filter(Boolean);
  const extensions = entries
    .filter((entry) => entry.descriptor === 'EXTENSION' && entry.name)
    .map((entry) => entry.name);
  const tableData = entries.filter((entry) => entry.descriptor === 'TABLE DATA');
  return {
    entryCount: entries.length,
    extensions: [...new Set(extensions)].sort(),
    hasPgCron: extensions.includes('pg_cron'),
    tableDataCount: tableData.length,
    // Exact schema and exact relation name. `cron.job_run_details`,
    // `cron.job-archive` and `cron."job.old"` are all correctly NOT this.
    carriesCronJob: tableData.some((entry) => entry.schema === 'cron' && entry.name === 'job'),
  };
}

// What a genuinely fresh PostgreSQL database carries, and nothing more.
export const EMPTY_SCHEMAS = Object.freeze(['public']);
export const EMPTY_EXTENSIONS = Object.freeze(['plpgsql']);

/**
 * Finding 1: the Supabase image's own `postgres` database fails this.
 *
 * Emptiness needs POSITIVE evidence, not an absence of surprises: an earlier
 * revision returned true for `assertTargetEmpty()` with no arguments at all,
 * and could not tell an empty `public` schema from a populated one. So the
 * caller must supply the inventory AND the relation count.
 */
export function assertTargetEmpty(inventory) {
  if (!inventory || typeof inventory !== 'object') refuse('target-inventory-missing');
  const { schemas, extensions, relationCount } = inventory;
  if (!Array.isArray(schemas) || !Array.isArray(extensions)) refuse('target-inventory-missing');
  if (!schemas.length) refuse('target-inventory-missing');
  if (!Number.isInteger(relationCount)) refuse('target-relation-count-missing');
  if (relationCount !== 0) refuse(`target-not-empty-relations-${relationCount}`);
  const unexpectedSchema = schemas.filter((name) => !EMPTY_SCHEMAS.includes(name));
  if (unexpectedSchema.length) refuse(`target-not-empty-schemas-${unexpectedSchema.length}`);
  const unexpectedExtension = extensions.filter((name) => !EMPTY_EXTENSIONS.includes(name));
  if (unexpectedExtension.length) refuse(`target-not-empty-extensions-${unexpectedExtension.length}`);
  return true;
}

/**
 * Finding 2. A pg_cron-enabled archive may only be restored into the database
 * pg_cron is actually configured for. This compares the archive against the
 * target's EFFECTIVE `cron.database_name`, so a local operator who has
 * reconfigured and restarted their isolated server passes, while a hosted
 * project — where that setting is not theirs to change — does not.
 */
export function assertRestoreTargetCompatible({ archiveHasPgCron, targetDatabase, cronDatabaseName }) {
  if (!targetDatabase) refuse('restore-target-database-missing');
  if (!archiveHasPgCron) return { route: 'fresh-database', pgCron: false };
  if (!cronDatabaseName) refuse('cron-database-name-unset');
  if (targetDatabase !== cronDatabaseName) refuse('pg-cron-archive-needs-cron-database');
  return { route: 'cron-database-only', pgCron: true };
}

// A libpq service name is an identifier, not a connection string. Anything else
// can smuggle `password = '...'` past a substring check, because libpq accepts
// whitespace around `=` in a keyword/value string.
const SERVICE_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,62}$/;

export function assertServiceName(value) {
  if (typeof value !== 'string' || !SERVICE_NAME.test(value)) refuse('service-name-invalid');
  return value;
}

// Environment variables that can point libpq at a credential we never reviewed.
export const FORBIDDEN_ENV = Object.freeze(['PGPASSWORD', 'PGPASSFILE', 'PGSERVICEFILE', 'PGSERVICE']);

/** No password may reach argv or the environment. Refuse before connecting. */
export function assertNoCredentialInArgs(argv = [], env = {}) {
  for (const name of FORBIDDEN_ENV) {
    if (Object.prototype.hasOwnProperty.call(env, name)) refuse(`env-${name.toLowerCase()}-set`);
  }
  for (const argument of argv) {
    const text = String(argument);
    // libpq keyword/value syntax allows whitespace around `=`.
    if (/\bpassword\s*=/i.test(text)) refuse('password-in-argument');
    // Unanchored: `--dbname=postgresql://u:p@h/db` is the same leak as a bare URL.
    if (/postgres(ql)?:\/\/[^/@\s]*:[^/@\s]+@/i.test(text)) refuse('password-in-url');
    if (/\b(sslpassword|pgpassword)\s*=/i.test(text)) refuse('password-in-argument');
  }
  return true;
}

export function sha256File(path, read = readFileSync) {
  return createHash('sha256').update(read(path)).digest('hex');
}

/**
 * Manifest v1. Every field is a measurement or an approval reference. There are
 * no success checkboxes, no value from the database, and the fields must agree
 * with each other — an earlier revision accepted `clientMajor: 18` while
 * asserting `pgMajor: 17`.
 */
export function buildManifest({
  serviceName,
  runId,
  capturedAtUtc,
  serverVersionNum,
  clientMajor,
  archiveSourceVersion,
  files,
  archive,
  retentionNote,
}) {
  if (!serviceName || !runId || !capturedAtUtc) refuse('manifest-inputs-incomplete');
  assertServiceName(serviceName);
  if (!/^h11c5-\d{8}T\d{6}Z$/.test(runId)) refuse('manifest-run-id-invalid');
  if (Number.isNaN(Date.parse(capturedAtUtc)) || !capturedAtUtc.endsWith('Z')) {
    refuse('manifest-timestamp-invalid');
  }
  if (clientMajor !== 17) refuse('manifest-client-major-invalid');
  if (serverVersionNum !== null && serverVersionNum !== undefined) assertServerVersionNum(serverVersionNum);
  if (!archive || typeof archive !== 'object' || !Number.isInteger(archive.entryCount)) {
    refuse('manifest-archive-incomplete');
  }
  if (!Array.isArray(files) || !files.length) refuse('manifest-file-evidence-incomplete');
  for (const file of files) {
    if (!file.path || !/^[a-f0-9]{64}$/.test(file.sha256 ?? '') || !(file.bytes > 0)) {
      refuse('manifest-file-evidence-incomplete');
    }
  }
  return {
    version: 1,
    kind: 'h11-c5-backup',
    runId,
    capturedAtUtc,
    source: {
      service: serviceName,
      serverVersionNum: serverVersionNum ?? null,
      archiveSourceVersion: archiveSourceVersion ?? null,
      pgMajor: 17,
    },
    tool: { pgDumpMajor: clientMajor },
    archive,
    files,
    retentionNote: retentionNote ?? 'Operator-retained. This executor never deletes a backup.',
    // Deliberately absent: any hosted recovery claim. C5 also needs
    // restore_drill.md Parts B and C, which require a physical device.
    hostedRecoveryAcceptance: null,
  };
}

/** Injectable so the CLI itself is testable, not only its helpers. */
export function defaultDeps() {
  return {
    run(command, args, label) {
      const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 64 });
      if (result.error || result.status !== 0) refuse(`${label}-exit-${result.status ?? 'spawn'}`);
      return result.stdout ?? '';
    },
    exists: existsSync,
    mkdir: (path) => mkdirSync(path, { recursive: true }),
    write: writeFileSync,
    read: readFileSync,
    size: (path) => statSync(path).size,
    now: () => new Date(),
  };
}

export function runId(now) {
  return `h11c5-${now.toISOString().replace(/[-:]/g, '').replace(/\..+/, 'Z')}`;
}

/**
 * CLI. Capture:
 *   dev-backup.mjs --service <libpq-service> --pg-dump <path> --out <dir>
 * Capture then restore into a declared isolated target:
 *   ... --restore-service <libpq-service> --restore-database <name>
 *       --cron-database-name <name> --target-schemas a,b --target-extensions a,b
 *       --target-relations <int>
 *
 * The service files carry host/user/database/port/sslmode and a protected
 * passfile path. Nothing secret is passed here.
 */
export function main(argv = process.argv.slice(2), env = process.env, deps = defaultDeps()) {
  assertNoCredentialInArgs(argv, env);
  const flag = (name) => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const serviceName = assertServiceName(flag('--service') ?? refuse('usage'));
  const pgDump = flag('--pg-dump');
  const pgRestore = flag('--pg-restore') ?? pgDump?.replace(/pg_dump(\.exe)?$/i, 'pg_restore$1');
  const outRoot = flag('--out');
  if (!pgDump || !outRoot) refuse('usage');

  const clientMajor = assertClientMajor(deps.run(pgDump, ['--version'], 'pg-dump-version'));
  assertClientMajor(deps.run(pgRestore, ['--version'], 'pg-restore-version'));

  const id = runId(deps.now());
  const outDir = join(outRoot, id);
  if (deps.exists(outDir)) refuse('run-directory-exists');
  deps.mkdir(outDir);

  const dumpPath = join(outDir, 'database.dump');
  deps.run(pgDump, [`--dbname=service=${serviceName}`, '--format=custom', `--file=${dumpPath}`], 'pg-dump');
  const tocPath = join(outDir, 'archive.toc');
  const toc = deps.run(pgRestore, ['--list', dumpPath], 'pg-restore-list');
  deps.write(tocPath, toc);

  // Enforced, not merely exported: a non-PG17 source cannot be recorded here.
  const archiveSourceVersion = assertArchiveSourceMajor(toc);
  const archive = classifyArchive(toc);
  const files = [dumpPath, tocPath].map((path) => ({
    path,
    sha256: sha256File(path, deps.read),
    bytes: deps.size(path),
  }));

  let restore = null;
  const restoreDatabase = flag('--restore-database');
  if (restoreDatabase) {
    const restoreService = assertServiceName(flag('--restore-service') ?? refuse('restore-service-missing'));
    const targetServerVersion = deps.run(
      pgRestore.replace(/pg_restore(\.exe)?$/i, 'psql$1'),
      [`--dbname=service=${restoreService}`, '-At', '-c', "select current_setting('server_version_num');"],
      'target-version',
    );
    assertServerVersionNum(targetServerVersion.trim());
    assertTargetEmpty({
      schemas: (flag('--target-schemas') ?? '').split(',').filter(Boolean),
      extensions: (flag('--target-extensions') ?? '').split(',').filter(Boolean),
      relationCount: Number(flag('--target-relations')),
    });
    restore = assertRestoreTargetCompatible({
      archiveHasPgCron: archive.hasPgCron,
      targetDatabase: restoreDatabase,
      cronDatabaseName: flag('--cron-database-name'),
    });
    deps.run(
      pgRestore,
      [`--dbname=service=${restoreService}`, '--exit-on-error', '--single-transaction', dumpPath],
      'pg-restore',
    );
  }

  const manifest = buildManifest({
    serviceName,
    runId: id,
    capturedAtUtc: deps.now().toISOString(),
    serverVersionNum: null,
    clientMajor,
    archiveSourceVersion,
    files,
    archive,
  });
  deps.write(join(outDir, 'manifest.json'), `${JSON.stringify({ ...manifest, restore }, null, 2)}\n`);
  // Names, counts and hashes only — never a row, a value or a credential.
  process.stdout.write(
    `${JSON.stringify({
      runId: id,
      outDir,
      entryCount: archive.entryCount,
      tableDataCount: archive.tableDataCount,
      hasPgCron: archive.hasPgCron,
      carriesCronJob: archive.carriesCronJob,
      restored: restore ? restore.route : null,
    })}\n`,
  );
  return { ...manifest, restore };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}
