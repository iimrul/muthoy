#!/usr/bin/env node
// The E4-B successor evidence manifest — the gap scripts/e4-evidence-manifest.mjs
// documented and deliberately left open.
//
// THE PROBLEM, in that file's own words: "a post-E4 migration gets no hash
// record from this manifest. Its chain membership is covered three ways …but
// its BYTES are not pinned anywhere until a successor manifest exists."
// Migration 36 is that post-E4 migration, so this is that successor.
//
// ─────────────────────────────────────────────── THE SECOND, HARDER PROBLEM
//
// Declaring migration 36 does not only ADD a file. It necessarily CHANGES five
// files whose bytes the E4 manifest pins as signed evidence — POST_E4_MIGRATIONS
// lives in checkFile.ts, the chain tail lives in h9-prod-preflight.mjs, the
// class letter lives in rollback-classification.json, and ROLLBACK.md and
// README.md are generated from that. There is no way to declare a successor
// migration without touching them; that is what declaring it MEANS.
//
// So there were three options and only one of them is honest:
//
//   (a) regenerate e4-source-hashes.json. This is what "just make the gate
//       pass" looks like, and the founder's directive forbids it by name:
//       "Do not rewrite … Signed source-hash pins." It would also destroy the
//       only record of what the E4 gate files looked like at acceptance.
//   (b) leave the drift unexplained. The gate exits 1 and a reader cannot tell
//       an authorized successor from tampering. Worse than (a).
//   (c) DECLARE the transition. e4-source-hashes.json stays byte-identical; this
//       file records, for each changed path, the hash E4 signed AND the hash it
//       moved to. The check then accepts a drift only when both ends match a
//       declaration, and still fails on everything else.
//
// (c) is implemented here. It is strictly stronger than the status quo for
// undeclared edits, because today ANY drift is one undifferentiated failure.
//
// WHAT IT IS WEAKER THAN, stated rather than glossed. It is weaker than "these
// bytes can never change", which is what the E4 pin alone implied. A file can
// now move, once, to a declared value. That is unavoidable the moment the
// founder approves extending the chain — but it means the `now` side of a
// declaration is only as good as the review of the commit that wrote it. This
// manifest is covered by code review and git history, not by a further hash
// chain, and there is no point pretending a fourth manifest would fix that: it
// would have the same property one level up.
//
// LINE ENDINGS, two conventions, deliberately. `files` uses RAW BYTES because
// successorPinDrift in live-chain-succession.pgtest.ts does, and that gate is
// the one a hosted apply depends on. `supersedes` uses the E4 manifest's
// CRLF-folded `hashFile`, because its `e4` side has to be comparable to what
// that manifest recorded. Mixing them would make one of the two uncheckable.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { E4_EVIDENCE_FILES, MANIFEST_PATH, hashFile } from './e4-evidence-manifest.mjs';

export const SUCCESSOR_MANIFEST_PATH = 'backend/supabase/migrations/post-e4-source-hashes.json';
const MIGRATIONS_DIR = 'backend/supabase/migrations';

/**
 * The declared successor migrations, read from the SAME constant the live-chain
 * gate reads.
 *
 * Read out of the source rather than restated here. A second hardcoded list
 * would be a second thing to forget, and "the two lists disagree" is the
 * failure mode Option B exists to make impossible.
 */
export function declaredSuccessors() {
  const source = readFileSync(resolve('backend/supabase/pgtest/checkFile.ts'), 'utf8');
  const block =
    /export const POST_E4_MIGRATIONS[^=]*=\s*Object\.freeze\(\[([\s\S]*?)\]\)/.exec(source);
  if (block === null) throw new Error('Cannot find POST_E4_MIGRATIONS in checkFile.ts');
  return [...block[1].matchAll(/'([^']+\.sql)'/g)].map((match) => match[1]).sort();
}

/** SHA-256 of a file's RAW bytes — the convention successorPinDrift uses. */
export function hashRawBytes(path) {
  return createHash('sha256').update(readFileSync(resolve(path))).digest('hex');
}

/** What the E4 manifest recorded, by path. */
function e4Recorded() {
  return JSON.parse(readFileSync(resolve(MANIFEST_PATH), 'utf8')).files;
}

/**
 * Every E4-pinned evidence file whose bytes have moved, with both ends.
 *
 * Computed from the tree, not declared by hand, so a path cannot be listed
 * with a `now` that is not actually on disk.
 */
export function currentSupersessions() {
  const recorded = e4Recorded();
  const out = {};
  for (const path of E4_EVIDENCE_FILES) {
    const before = recorded[path];
    if (before === undefined) continue;
    const now = hashFile(path);
    if (now !== before) out[path] = { e4: before, now };
  }
  return out;
}

/** The supersessions this manifest DECLARES, or {} when there is no manifest. */
export function declaredSupersessions() {
  const path = resolve(SUCCESSOR_MANIFEST_PATH);
  if (!existsSync(path)) return {};
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  const declared = parsed?.supersedes;
  if (declared === null || typeof declared !== 'object' || Array.isArray(declared)) return {};
  return declared;
}

export function buildSuccessorManifest() {
  const migrations = declaredSuccessors();
  const files = {};
  for (const name of migrations) {
    files[name] = hashRawBytes(`${MIGRATIONS_DIR}/${name}`);
  }
  const supersedes = currentSupersessions();
  return {
    batch: 3,
    gate: 'E4-B',
    // Named so a reader knows which manifest's signatures these supersede, and
    // does not have to infer it from the paths.
    supersedesManifest: MANIFEST_PATH,
    counts: {
      migrations: migrations.length,
      supersededEvidenceFiles: Object.keys(supersedes).length,
    },
    // Bare filenames and RAW-byte digests: the shape successorPinDrift reads.
    files,
    supersedes,
  };
}

function stringify(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/**
 * `--check` reports what disagrees; `--write` records the current tree.
 *
 * The drift list names BOTH directions, because "the manifest records a
 * transition that is no longer on disk" is as much a defect as "a file moved
 * and nothing declared it".
 */
export function checkOrWrite(mode = '--check') {
  const built = buildSuccessorManifest();
  const path = resolve(SUCCESSOR_MANIFEST_PATH);
  if (mode === '--write') {
    writeFileSync(path, stringify(built));
    return [];
  }
  if (!existsSync(path)) {
    return built.counts.migrations === 0 ? [] : [`${SUCCESSOR_MANIFEST_PATH} is missing`];
  }
  const current = JSON.parse(readFileSync(path, 'utf8'));
  const drift = [];
  for (const [name, hash] of Object.entries(built.files)) {
    if (current.files?.[name] !== hash) drift.push(`${MIGRATIONS_DIR}/${name}`);
  }
  for (const name of Object.keys(current.files ?? {})) {
    if (built.files[name] === undefined) drift.push(`${name} is pinned but not declared`);
  }
  for (const [path_, ends] of Object.entries(built.supersedes)) {
    const declared = current.supersedes?.[path_];
    if (declared?.e4 !== ends.e4 || declared?.now !== ends.now) drift.push(path_);
  }
  for (const path_ of Object.keys(current.supersedes ?? {})) {
    if (built.supersedes[path_] === undefined) {
      drift.push(`${path_} declares a supersession that no longer applies`);
    }
  }
  return drift;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const mode = process.argv[2] ?? '--check';
  const drift = checkOrWrite(mode);
  if (mode === '--write') {
    process.stdout.write(`wrote ${SUCCESSOR_MANIFEST_PATH}\n`);
  } else if (drift.length) {
    process.stdout.write(`E4-B successor manifest drift:\n  ${drift.join('\n  ')}\n`);
    process.exit(1);
  } else {
    process.stdout.write('E4-B successor manifest: no drift\n');
  }
}
