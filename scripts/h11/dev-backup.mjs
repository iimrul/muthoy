#!/usr/bin/env node
// H-11 C5 — the repeatable DEV backup CAPTURE executor.
//
// `backend/supabase/checks/h9_pg17_restore.md` is the approved procedure and
// stays authoritative. This automates exactly one part of it: step 6's capture,
// plus step 7's hashes and the manifest. `pg_dump` is read-only, no hosted write
// happens, and the connection is named only by a libpq service so no password
// can reach argv, the environment or the manifest.
//
// IT IS DELIBERATELY SMALL, after three review rounds said so in three ways.
//
//  - Round 1: it exported gates `main()` never called.
//  - Round 2: the `--restore` mode I added to fix that took the target's
//    emptiness, extensions and `cron.database_name` FROM THE COMMAND LINE, so
//    the gates checked what the operator typed; and `--restore-database` never
//    reached the connection, because the destination is whatever the service
//    file says. A gate fed by the operator's own assertion is worse than no
//    gate. The restore mode was deleted; steps 8-10 stay a human operation with
//    independent target verification.
//  - Round 3: the archive CLASSIFIER I had kept — TOC parsing, pg_cron
//    detection, an "ambiguous entry" policy — refused six ordinary PG17
//    descriptors (`EVENT TRIGGER`, `STATISTICS`, `COLLATION`, `RULE`,
//    `TEXT SEARCH CONFIGURATION`, `SECURITY LABEL`), so it would have blocked a
//    real DEV backup. It also claimed `cron.job` for `" cron".job`, because
//    pg_dump prints identifiers UNQUOTED and a whitespace-bearing name cannot be
//    recovered from that text at all.
//
// So the classifier is gone too. `pg_restore --list` output is saved VERBATIM as
// `archive.toc` and hashed; that file is the inventory evidence, and a human or
// a later purpose-built tool reads it. The one-off pg_cron measurement this
// rehearsal produced belongs in the documentation, which is where it now lives,
// not re-derived on every capture.
//
// What remains is what a machine can establish soundly: the toolchain is PG17,
// the ARCHIVE came from a PG17 server, no credential is in reach, and these
// exact bytes were produced at this time.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, join } from 'node:path';
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
 * The archive header records the server it came from — one documented line,
 * which is why it survived the simplification while the entry parser did not.
 * Enforcing it means a PG16 or PG18 source cannot be filed as a PG17 backup.
 */
export function assertArchiveSourceMajor(tocText) {
  const match = /Dumped from database version:\s*(\d+)\.(\d+)/.exec(String(tocText ?? ''));
  if (!match) refuse('archive-source-version-unreadable');
  if (Number(match[1]) !== 17) refuse(`archive-source-major-${match[1]}`);
  return `${match[1]}.${match[2]}`;
}

// A libpq service name is an identifier, not a connection string. Anything else
// can smuggle `password = '...'` past a substring check, because libpq accepts
// whitespace around `=` in a keyword/value string.
const SERVICE_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,62}$/;

export function assertServiceName(value) {
  if (typeof value !== 'string' || !SERVICE_NAME.test(value)) refuse('service-name-invalid');
  return value;
}

// Every environment variable that can point libpq at a credential or at a
// service file we never reviewed. PGSYSCONFDIR is a service-file lookup route.
export const FORBIDDEN_ENV = Object.freeze([
  'PGPASSWORD',
  'PGPASSFILE',
  'PGSERVICE',
  'PGSERVICEFILE',
  'PGSYSCONFDIR',
]);

/** Percent-encoding hides `password=` as `pass%77ord=`, so decode before matching. */
function decodedForms(text) {
  const forms = new Set([text]);
  let current = text;
  // Twice, so `%2570` (an encoded `%70`) is also reached.
  for (let pass = 0; pass < 2; pass += 1) {
    const manual = current.replace(/%([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    forms.add(manual);
    try {
      forms.add(decodeURIComponent(current));
    } catch {
      /* Malformed escapes are left to the raw and manual matches. */
    }
    current = manual;
  }
  return [...forms];
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

// The complete set of accepted flags. Anything else — a typo, an obsolete
// restore flag, a `--flag=value` form — is refused rather than ignored, which
// is how `--restore`, `--target-extensions` and `--cron-database-name` slipped
// through an earlier revision's hand-written rejection list.
export const ACCEPTED_FLAGS = Object.freeze(['--service', '--pg-dump', '--pg-restore', '--out']);

export function parseArgs(argv = []) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index]);
    if (!token.startsWith('--')) refuse('argument-unexpected');
    const [name] = token.split('=');
    if (!ACCEPTED_FLAGS.includes(name)) refuse('argument-unknown');
    // `--flag=value` is refused so there is exactly one accepted spelling.
    if (token.includes('=')) refuse('argument-form-invalid');
    const value = argv[index + 1];
    if (value === undefined || String(value).startsWith('--')) refuse('argument-value-missing');
    if (values.has(name)) refuse('argument-repeated');
    values.set(name, String(value));
    index += 1;
  }
  return values;
}

export function sha256File(path, read = readFileSync) {
  return createHash('sha256').update(read(path)).digest('hex');
}

/**
 * Manifest v1. Every field is a measurement of the capture itself. It records no
 * derived claim about the archive's CONTENTS — `archive.toc` is that evidence —
 * and the fields must agree with each other.
 */
export function buildManifest({
  serviceName,
  runId,
  capturedAtUtc,
  serverVersionNum,
  clientMajor,
  archiveSourceVersion,
  files,
  retentionNote,
  nowMs = Date.now(),
}) {
  if (!serviceName || !runId || !capturedAtUtc) refuse('manifest-inputs-incomplete');
  assertServiceName(serviceName);
  const stamp = /^h11c5-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(runId);
  if (!stamp) refuse('manifest-run-id-invalid');
  const [, year, month, day, hour, minute, second] = stamp.map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
    refuse('manifest-run-id-invalid');
  }
  if (year < 2026 || year > 2100) refuse('manifest-run-id-invalid');
  const parsed = Date.parse(capturedAtUtc);
  if (Number.isNaN(parsed) || !String(capturedAtUtc).endsWith('Z')) refuse('manifest-timestamp-invalid');
  // A capture cannot predate this work, and cannot come from the future.
  if (parsed < Date.parse('2026-10-01T00:00:00Z')) refuse('manifest-timestamp-implausible');
  if (parsed > nowMs + 60_000) refuse('manifest-timestamp-implausible');
  if (clientMajor !== 17) refuse('manifest-client-major-invalid');
  if (serverVersionNum !== null && serverVersionNum !== undefined) assertServerVersionNum(serverVersionNum);
  // Required, not optional: a capture with no recorded source major is not evidence.
  if (!/^17\.\d+$/.test(String(archiveSourceVersion ?? ''))) refuse('manifest-archive-source-invalid');
  if (!Array.isArray(files) || files.length !== 2) refuse('manifest-file-evidence-incomplete');
  const names = files.map((file) => basename(String(file.path ?? '')));
  if (!names.includes('database.dump') || !names.includes('archive.toc')) {
    refuse('manifest-file-evidence-incomplete');
  }
  for (const file of files) {
    if (!file.path || !/^[a-f0-9]{64}$/.test(file.sha256 ?? '')) refuse('manifest-file-evidence-incomplete');
    if (!Number.isInteger(file.bytes) || file.bytes <= 0) refuse('manifest-file-evidence-incomplete');
  }
  if (files[0].sha256 === files[1].sha256) refuse('manifest-file-digests-identical');
  return {
    version: 1,
    kind: 'h11-c5-capture',
    runId,
    capturedAtUtc,
    source: {
      service: serviceName,
      serverVersionNum: serverVersionNum ?? null,
      archiveSourceVersion,
      pgMajor: 17,
    },
    tool: { pgDumpMajor: clientMajor },
    // The inventory is the saved archive.toc file, listed in `files` with its
    // digest. Nothing here interprets the archive's contents.
    files,
    retentionNote: retentionNote ?? 'Operator-retained. This executor never deletes a backup.',
    // Deliberately absent and not supplyable: this tool captures. C5 also needs
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
  const args = parseArgs(argv);
  const serviceName = assertServiceName(args.get('--service') ?? refuse('usage'));
  const pgDump = args.get('--pg-dump');
  const outRoot = args.get('--out');
  if (!pgDump || !outRoot) refuse('usage');
  const pgRestore = args.get('--pg-restore') ?? pgDump.replace(/pg_dump(\.exe)?$/i, 'pg_restore$1');
  if (pgRestore === pgDump) refuse('pg-restore-path-indistinct');

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
  const tocPath = join(outDir, 'archive.toc');
  deps.run(
    pgDump,
    [`--dbname=service=${serviceName}`, '--format=custom', `--file=${dumpPath}`],
    'pg-dump',
  );
  const toc = deps.run(pgRestore, ['--list', dumpPath], 'pg-restore-list');
  deps.write(tocPath, toc);

  const archiveSourceVersion = assertArchiveSourceMajor(toc);
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
    nowMs: deps.now().getTime(),
  });
  deps.write(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  // Names, paths and digests only — never a row, a value or a credential.
  process.stdout.write(`${JSON.stringify({ runId: id, outDir, archiveSourceVersion })}\n`);
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
