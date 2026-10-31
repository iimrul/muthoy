#!/usr/bin/env node
// H-11 C5 — the repeatable DEV backup CAPTURE executor.
//
// `backend/supabase/checks/h9_pg17_restore.md` is the approved procedure and
// stays authoritative. This file automates exactly one part of it: step 6's
// capture, plus step 7's inventory and hashes and the manifest. `pg_dump` is
// read-only, no hosted write happens, and the connection is named only by a
// libpq service so no password can reach argv, the environment or the manifest.
//
// IT DELIBERATELY DOES NOT RESTORE, and that is a correction rather than an
// omission. An earlier revision had a `--restore` mode whose emptiness and
// pg_cron gates were fed from the command line — `--target-schemas`,
// `--target-relations`, `--cron-database-name` — so they checked what the
// operator TYPED, never what the target contained; and `--restore-database`
// never reached the connection at all, because the destination is whatever the
// service file says. An independent review demonstrated both. A gate that takes
// the operator's word is worse than no gate, because it manufactures the
// appearance of safety. Steps 8-10 of the procedure are a human operation with
// independent target verification, and they stay there.
//
// What the 2026-10-31 local rehearsal measured, against real
// `public.ecr.aws/supabase/postgres:17.6.1.159` containers on loopback with
// synthetic data only, is recorded in that file's dated addendum. The two
// findings this module still enforces are the ones it can actually see: the
// client must be PG17, and the ARCHIVE must have come from a PG17 server.

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

/** A 17.x `server_version_num`, used when a caller has genuinely measured one. */
export function assertServerVersionNum(value) {
  const number = Number(value);
  if (!Number.isInteger(number)) refuse('server-version-unreadable');
  if (number < 170000 || number >= 180000) refuse(`server-version-${number}`);
  return number;
}

/**
 * The archive header records the server it came from. Enforcing it means a PG16
 * or PG18 source cannot be filed as a PG17 backup — an earlier revision's
 * manifest asserted `pgMajor: 17` regardless of the archive.
 */
export function assertArchiveSourceMajor(tocText) {
  const match = /Dumped from database version:\s*(\d+)\.(\d+)/.exec(String(tocText ?? ''));
  if (!match) refuse('archive-source-version-unreadable');
  if (Number(match[1]) !== 17) refuse(`archive-source-major-${match[1]}`);
  return `${match[1]}.${match[2]}`;
}

// Descriptors `pg_restore --list` can emit. Longest-first so `TABLE DATA` wins
// over `TABLE`, and `SEQUENCE OWNED BY` over `SEQUENCE`.
const DESCRIPTORS = Object.freeze(
  [
    'MATERIALIZED VIEW DATA',
    'SEQUENCE OWNED BY',
    'MATERIALIZED VIEW',
    'FK CONSTRAINT',
    'ROW SECURITY',
    'DEFAULT ACL',
    'SEQUENCE SET',
    'TABLE DATA',
    'PROCEDURE',
    'PUBLICATION',
    'CONSTRAINT',
    'EXTENSION',
    'AGGREGATE',
    'OPERATOR',
    'SEQUENCE',
    'FUNCTION',
    'DATABASE',
    'DEFAULT',
    'TRIGGER',
    'COMMENT',
    'SCHEMA',
    'DOMAIN',
    'POLICY',
    'INDEX',
    'TABLE',
    'VIEW',
    'TYPE',
    'CAST',
    'ACL',
  ].sort((a, b) => b.length - a.length),
);

const ENTRY_LINE = /^\s*\d+;\s+\d+\s+\d+\s+(.*)$/;

/**
 * Parse one TOC line. The format is
 * `<id>; <tableoid> <oid> <DESCRIPTOR> <schema> <name> <owner>`, and pg_dump
 * prints identifiers UNQUOTED — so a name or owner containing a space is
 * genuinely unrecoverable from this text. Rather than guess, such a line is
 * reported `ambiguous` and the caller fails closed.
 */
export function parseTocLine(line) {
  const head = ENTRY_LINE.exec(String(line ?? ''));
  if (!head) return null;
  const rest = head[1].replace(/\s+$/, '');
  const descriptor = DESCRIPTORS.find((item) => rest === item || rest.startsWith(`${item} `));
  // An unrecognised descriptor is UNCLASSIFIED, not ambiguous: its fields may be
  // perfectly clear, we simply do not know the entry kind. Keeping the two
  // conditions distinct keeps both refusal codes meaningful and reachable.
  if (!descriptor) return { descriptor: null, ambiguous: false, schema: null, name: null, owner: null };
  const tail = rest.slice(descriptor.length).replace(/^\s/, '');
  // Two adjacent spaces mean one of the fields begins or ends with whitespace.
  const ambiguousGap = /\s{2,}/.test(tail);
  const tokens = tail.split(' ').filter((token) => token !== '');
  // Only the descriptors this module draws a CONCLUSION from need an exact
  // schema/name, so only they are checked for ambiguity. Others — `ACL - SCHEMA
  // cron supabase_admin`, `DEFAULT public sales id postgres` — legitimately
  // carry more fields, and flagging them would refuse ordinary archives.
  const arity = { 'TABLE DATA': 3, EXTENSION: 2 }[descriptor];
  const ambiguous = arity === undefined ? false : ambiguousGap || tokens.length > arity;
  if (!tokens.length) return { descriptor, ambiguous: false, schema: null, name: null, owner: null };
  if (tokens.length === 1) return { descriptor, ambiguous, schema: null, name: tokens[0], owner: null };
  const [schema, ...others] = tokens;
  return {
    descriptor,
    ambiguous,
    schema,
    name: others.length > 1 ? others.slice(0, -1).join(' ') : others[0],
    owner: others.length > 1 ? others[others.length - 1] : null,
  };
}

/**
 * Read `pg_restore --list`. The inventory is evidence in its own right: it is
 * how we know `cron.job` IS carried by a dump — pg_cron marks its job table for
 * extension config dump — rather than assuming the schedule is lost.
 *
 * `entryCount` counts every archive entry line, including ones this parser
 * cannot classify, so the total never silently shrinks.
 */
export function classifyArchive(tocText) {
  const lines = String(tocText ?? '').split(/\r?\n/);
  const entryLines = lines.filter((line) => ENTRY_LINE.test(line));
  const entries = entryLines.map(parseTocLine);
  const ambiguous = entries.filter((entry) => entry.ambiguous).length;
  const unclassified = entries.filter((entry) => entry.descriptor === null).length;
  const extensions = entries
    .filter((entry) => entry.descriptor === 'EXTENSION' && !entry.ambiguous && entry.name)
    .map((entry) => entry.name);
  const tableData = entries.filter((entry) => entry.descriptor === 'TABLE DATA');
  return {
    entryCount: entryLines.length,
    ambiguousEntries: ambiguous,
    unclassifiedEntries: unclassified,
    extensions: [...new Set(extensions)].sort(),
    hasPgCron: extensions.includes('pg_cron'),
    tableDataCount: tableData.length,
    // Exact schema and exact relation name, and never from an ambiguous line.
    carriesCronJob: tableData.some(
      (entry) => !entry.ambiguous && entry.schema === 'cron' && entry.name === 'job',
    ),
  };
}

/** An ambiguous inventory is not evidence, so the capture refuses rather than record it. */
export function assertArchiveInventoryUnambiguous(archive) {
  if (!archive || !Number.isInteger(archive.entryCount)) refuse('archive-inventory-incomplete');
  if (archive.ambiguousEntries > 0) refuse(`archive-inventory-ambiguous-${archive.ambiguousEntries}`);
  if (archive.unclassifiedEntries > 0) refuse(`archive-inventory-unclassified-${archive.unclassifiedEntries}`);
  return true;
}

// A libpq service name is an identifier, not a connection string. Anything else
// can smuggle `password = '...'` past a substring check, because libpq accepts
// whitespace around `=` in a keyword/value string.
const SERVICE_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,62}$/;

export function assertServiceName(value) {
  if (typeof value !== 'string' || !SERVICE_NAME.test(value)) refuse('service-name-invalid');
  return value;
}

// Every environment variable that can point libpq at a credential or a service
// file we never reviewed. PGSYSCONFDIR is a service-file lookup route too.
export const FORBIDDEN_ENV = Object.freeze([
  'PGPASSWORD',
  'PGPASSFILE',
  'PGSERVICEFILE',
  'PGSERVICE',
  'PGSYSCONFDIR',
]);

/** Percent-encoding hides `password=` as `pass%77ord=`, so decode before matching. */
function decodedForms(text) {
  const forms = [text];
  try {
    const once = decodeURIComponent(text);
    if (once !== text) forms.push(once);
  } catch {
    /* Malformed escapes are left to the raw match. */
  }
  forms.push(text.replace(/%([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16))));
  return forms;
}

/** No password may reach argv or the environment. Refuse before connecting. */
export function assertNoCredentialInArgs(argv = [], env = {}) {
  for (const name of FORBIDDEN_ENV) {
    if (Object.prototype.hasOwnProperty.call(env, name)) refuse(`env-${name.toLowerCase()}-set`);
  }
  for (const argument of argv) {
    for (const text of decodedForms(String(argument))) {
      // libpq keyword/value syntax allows whitespace around `=`; a URL may also
      // carry it as a query parameter.
      if (/\b(ssl)?password\s*=/i.test(text)) refuse('password-in-argument');
      // Unanchored: `--dbname=postgresql://u:p@h/db` is the same leak as a bare URL.
      if (/postgres(ql)?:\/\/[^/@\s]*:[^/@\s]+@/i.test(text)) refuse('password-in-url');
    }
  }
  return true;
}

export function sha256File(path, read = readFileSync) {
  return createHash('sha256').update(read(path)).digest('hex');
}

/**
 * Manifest v1. Every field is a measurement. There are no success checkboxes,
 * no value from the database, and the fields must agree with each other — an
 * earlier revision accepted `clientMajor: 18`, and then `archiveSourceVersion:
 * '16.4'`, beside an asserted `pgMajor: 17`.
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
  const stamp = /^h11c5-(\d{8})T(\d{6})Z$/.exec(runId);
  if (!stamp) refuse('manifest-run-id-invalid');
  const parsed = Date.parse(capturedAtUtc);
  if (Number.isNaN(parsed) || !String(capturedAtUtc).endsWith('Z')) refuse('manifest-timestamp-invalid');
  // A capture cannot predate this work or come from the future.
  if (parsed < Date.parse('2026-10-01T00:00:00Z')) refuse('manifest-timestamp-implausible');
  if (clientMajor !== 17) refuse('manifest-client-major-invalid');
  if (serverVersionNum !== null && serverVersionNum !== undefined) assertServerVersionNum(serverVersionNum);
  if (archiveSourceVersion !== null && archiveSourceVersion !== undefined) {
    if (!/^17\.\d+$/.test(String(archiveSourceVersion))) refuse('manifest-archive-source-invalid');
  }
  if (!archive || typeof archive !== 'object') refuse('manifest-archive-incomplete');
  for (const field of ['entryCount', 'tableDataCount', 'ambiguousEntries', 'unclassifiedEntries']) {
    if (!Number.isInteger(archive[field]) || archive[field] < 0) refuse('manifest-archive-incomplete');
  }
  if (!Array.isArray(files) || !files.length) refuse('manifest-file-evidence-incomplete');
  for (const file of files) {
    if (!file.path || !/^[a-f0-9]{64}$/.test(file.sha256 ?? '') || !Number.isInteger(file.bytes) || file.bytes <= 0) {
      refuse('manifest-file-evidence-incomplete');
    }
  }
  return {
    version: 1,
    kind: 'h11-c5-capture',
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
    // Deliberately absent, and not supplyable: this tool captures. The restore
    // is steps 8-10 of h9_pg17_restore.md, performed by a human with
    // independent target verification, and C5 additionally needs
    // restore_drill.md Parts B and C, which require a physical device.
    restorePerformed: false,
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
 * CLI: dev-backup.mjs --service <libpq-service> --pg-dump <path> --out <dir>
 *
 * The service file carries host/user/database/port/sslmode and a protected
 * passfile path. Nothing secret is passed here. Capture only — see the header.
 */
export function main(argv = process.argv.slice(2), env = process.env, deps = defaultDeps()) {
  assertNoCredentialInArgs(argv, env);
  const flag = (name) => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  for (const rejected of ['--restore-service', '--restore-database', '--target-schemas', '--target-relations']) {
    if (argv.includes(rejected)) refuse('restore-not-supported');
  }
  const serviceName = assertServiceName(flag('--service') ?? refuse('usage'));
  const pgDump = flag('--pg-dump');
  const pgRestore = flag('--pg-restore') ?? pgDump?.replace(/pg_dump(\.exe)?$/i, 'pg_restore$1');
  const outRoot = flag('--out');
  if (!pgDump || !outRoot) refuse('usage');

  // Both binaries, independently: a PG17 pg_dump beside a PG18 pg_restore is a
  // mixed toolchain the procedure forbids.
  const dumpMajor = assertClientMajor(deps.run(pgDump, ['--version'], 'pg-dump-version'));
  const restoreMajor = assertClientMajor(deps.run(pgRestore, ['--version'], 'pg-restore-version'));
  if (dumpMajor !== restoreMajor) refuse('client-majors-differ');

  const id = runId(deps.now());
  const outDir = join(outRoot, id);
  if (deps.exists(outDir)) refuse('run-directory-exists');
  deps.mkdir(outDir);

  const dumpPath = join(outDir, 'database.dump');
  deps.run(pgDump, [`--dbname=service=${serviceName}`, '--format=custom', `--file=${dumpPath}`], 'pg-dump');
  const tocPath = join(outDir, 'archive.toc');
  const toc = deps.run(pgRestore, ['--list', dumpPath], 'pg-restore-list');
  deps.write(tocPath, toc);

  const archiveSourceVersion = assertArchiveSourceMajor(toc);
  const archive = classifyArchive(toc);
  assertArchiveInventoryUnambiguous(archive);
  const files = [dumpPath, tocPath].map((path) => ({
    path,
    sha256: sha256File(path, deps.read),
    bytes: deps.size(path),
  }));

  const manifest = buildManifest({
    serviceName,
    runId: id,
    capturedAtUtc: deps.now().toISOString(),
    serverVersionNum: null,
    clientMajor: dumpMajor,
    archiveSourceVersion,
    files,
    archive,
  });
  deps.write(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  // Names, counts and hashes only — never a row, a value or a credential.
  process.stdout.write(
    `${JSON.stringify({
      runId: id,
      outDir,
      entryCount: archive.entryCount,
      tableDataCount: archive.tableDataCount,
      hasPgCron: archive.hasPgCron,
      carriesCronJob: archive.carriesCronJob,
    })}\n`,
  );
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}
