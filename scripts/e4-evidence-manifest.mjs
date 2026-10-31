// scripts/e4-evidence-manifest.mjs — E4's own hash-recorded evidence.
//
// WHY THIS EXISTS. The delivery ledger requires E4's evidence to be
// re-established, not merely left behind. H-9's equivalent is
// audit-artifacts/h9-remediation/final-source-hashes.json, a STATIC snapshot
// taken at one commit — which means nothing re-verifies it, and its
// DECISIONS.md entry has already drifted. E4's is GENERATED and CHECKED, so a
// recorded hash that stops matching the tree fails a test instead of sitting
// there looking authoritative.
//
// WHAT IT COVERS: the 35 migration files, the successor check, the four chain
// gates E4 touched, the generated rollback documents, and the new E4 test
// surface. Those are exactly the artifacts a reviewer would have to re-derive
// to know whether the chain extension is the one that was accepted.
//
// LINE ENDINGS ARE NORMALISED BEFORE HASHING, and that is not a detail. This
// repository has had recorded hashes broken three separate times by a CRLF
// checkout; .gitattributes now pins `eol=lf` on every path whose SHA-256 is
// H-9 evidence for exactly that reason. Pinning works but only protects the
// files it lists, and these include test files that are not pinned and should
// not have to be. Hashing content with \r\n folded to \n makes the manifest
// independent of how any clone checked the files out, which is the property
// that was actually wanted each of those three times.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// TRACKED, deliberately, and this is a correction to the Batch 3 plan.
//
// The plan put this in audit-artifacts/e4/, modelled on H-9's
// final-source-hashes.json. But `.gitignore:29` ignores `audit-artifacts/`
// wholesale, and `git ls-files audit-artifacts/` returns NOTHING — so H-9's
// manifest is a local-only working artifact that was never committed, and an
// E4 manifest placed beside it would never have been committed either.
// Evidence nobody else can fetch is not evidence.
//
// So it lives next to rollback-classification.json, the established tracked
// home in this repository for a machine-readable manifest about the migration
// chain. Nothing reads that directory expecting only .sql: every consumer
// filters on the extension (harness.ts's migrationFiles, classify-migrations.mjs
// and the preflight's own chain check), and ROLLBACK.md, README.md and
// rollback-classification.json already sit there.
export const MANIFEST_PATH = 'backend/supabase/migrations/e4-source-hashes.json';
const MIGRATIONS_DIR = 'backend/supabase/migrations';

/** The E4 migration, and the only file the chain gained in Batch 3. */
export const E4_MIGRATION = '20261023000000_e4_batch3_admin_platform.sql';

/**
 * Everything outside the migrations directory whose bytes are E4 evidence.
 *
 * The four chain gates are here because the whole claim of the successor
 * mechanism is "these four were updated together and none was weakened". A
 * reader who cannot tell whether one of them changed afterwards cannot check
 * that claim.
 */
export const E4_EVIDENCE_FILES = Object.freeze([
  // The successor acceptance check.
  'backend/supabase/checks/e4_postmigration_checks.sql',
  // Gate 1 — the production preflight's chain pin.
  'scripts/h9-prod-preflight.mjs',
  'apps/mobile/tests/h9-prod-preflight.test.ts',
  // Gate 3 — the pinned-section pgtest, re-scoped to the H-9 baseline.
  'backend/supabase/pgtest/h9-cron-cleanup.pgtest.ts',
  // Gate 5 — the chain-ORDER assertion, found by the full sweep rather than by
  // the plan's inventory: it pins the H-9 block's position without ever
  // mentioning the number 34, so a search for that literal misses it.
  'backend/supabase/pgtest/h9-environment-parity.pgtest.ts',
  // Gate 4 — the rollback classification and its generated documents.
  'backend/supabase/migrations/rollback-classification.json',
  'backend/supabase/migrations/ROLLBACK.md',
  'backend/supabase/migrations/README.md',
  'apps/mobile/tests/migration-rollback-classification.test.ts',
  // The E4 test surface.
  'backend/supabase/pgtest/checkFile.ts',
  'backend/supabase/pgtest/e4-admin-platform.pgtest.ts',
  'backend/supabase/pgtest/e4-chain-succession.pgtest.ts',
  // The line-ending pins that keep the two hash-recorded SQL files reproducible.
  '.gitattributes',
]);

/** SHA-256 of the file's content with CRLF folded to LF. See the header. */
export function hashFile(path) {
  const text = readFileSync(resolve(path), 'utf8').replace(/\r\n/g, '\n');
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * The migrations this manifest is evidence ABOUT: the E4 chain, up to and
 * including migration 35.
 *
 * FOUNDER OPTION B, 2026-10-30, after ROUND 10 finding 2. This read the whole
 * directory, so a later migration pushed `counts.migrations` to 36 and the file
 * total to 49 — and `e4-evidence-manifest.test.ts` asserts 35 and 48, which are
 * statements about what was ACCEPTED. Regenerating cannot satisfy them, so the
 * manifest had to stop tracking a chain it is not evidence about.
 *
 * Bounding it here changes nothing today, because the live chain IS the E4
 * chain today — verified by regenerating and finding no drift. It makes the
 * accepted counts permanently true instead of true until the next migration.
 *
 * THE GAP THIS LEAVES, stated rather than hidden: a post-E4 migration gets no
 * hash record from this manifest. Its chain membership is covered three ways
 * (POST_E4_MIGRATIONS, rollback-classification.json, the preflight's
 * EXPECTED_CHAIN, cross-checked by live-chain-succession.pgtest.ts), but its
 * BYTES are not pinned anywhere until a successor manifest exists. That
 * successor is required work before any post-E4 migration is applied to a
 * hosted project, and it is recorded as such in Report B.
 */
export function migrationFileNames() {
  return readdirSync(resolve(MIGRATIONS_DIR))
    .filter((name) => name.endsWith('.sql') && name <= E4_MIGRATION)
    .sort();
}

/** The manifest the tree currently implies. */
export function buildManifest() {
  const migrations = migrationFileNames();
  const files = {};
  for (const name of migrations) files[`${MIGRATIONS_DIR}/${name}`] = hashFile(`${MIGRATIONS_DIR}/${name}`);
  for (const path of E4_EVIDENCE_FILES) files[path] = hashFile(path);

  return {
    batch: 3,
    gate: 'E4',
    // The chain this manifest describes, by version, in order.
    expectedChain: migrations.map((name) => name.slice(0, 14)),
    // Recorded so a reader can see the H-9 baseline is unchanged rather than
    // having to diff 34 hashes to find out.
    h9BaselineUnchanged: {
      postmigrationChecks: hashFile('backend/supabase/checks/h9_postmigration_checks.sql'),
      migration34: hashFile(`${MIGRATIONS_DIR}/20261015000000_h9_api_role_table_privileges.sql`),
    },
    counts: {
      migrations: migrations.length,
      e4EvidenceFiles: E4_EVIDENCE_FILES.length,
    },
    files,
  };
}

function stringify(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/** Where a post-E4 successor declares the transitions it required. */
export const SUCCESSOR_MANIFEST_PATH = 'backend/supabase/migrations/post-e4-source-hashes.json';

/**
 * The ONLY paths a successor declaration may ever move.
 *
 * ROUND 18 FINDING 7. The allowlist lives HERE, with the consumer, and not in
 * the generator that writes the manifest — because the generator obeying a rule
 * is not the same as the rule being enforced. A hand-edited
 * `post-e4-source-hashes.json` declaring a transition for
 * `e4_postmigration_checks.sql` would otherwise be honoured by `supersededBy()`
 * no matter how careful the generator was.
 *
 * These seven are exactly what declaring a post-E4 migration cannot avoid
 * touching. Everything else in `E4_EVIDENCE_FILES` — the sealed acceptance SQL
 * above all — can never be superseded, and a drift in one fails always.
 */
export const SUPERSEDABLE_EVIDENCE_FILES = Object.freeze([
  'backend/supabase/pgtest/checkFile.ts',
  'scripts/h9-prod-preflight.mjs',
  'backend/supabase/migrations/rollback-classification.json',
  'backend/supabase/migrations/ROLLBACK.md',
  'backend/supabase/migrations/README.md',
  'apps/mobile/tests/migration-rollback-classification.test.ts',
  '.gitattributes',
]);

/**
 * The declared `{path: {e4, now}}` supersessions, or {} when there are none.
 *
 * READ AS JSON rather than imported from scripts/post-e4-evidence-manifest.mjs,
 * which imports this module. One direction only: a cycle between the two
 * manifests is the kind of thing that works until the day it is loaded in the
 * other order.
 *
 * Returns {} on a missing, malformed or non-object manifest, which means a
 * damaged successor manifest FORGIVES NOTHING and every real drift is still
 * reported. Failing open here would be a privacy-adjacent gate that disables
 * itself when its input is broken.
 */
export function supersededBy(manifestPath = SUCCESSOR_MANIFEST_PATH) {
  // The path is a PARAMETER so a test can point this at a manifest carrying a
  // forbidden declaration. ROUND 25 FINDING 3: the test that claimed to prove a
  // hand-edited manifest is ignored only read the REAL manifest, which declares
  // nothing forbidden -- so removing the allowlist filter below left 12 of 12
  // tests green. A negative test that never supplies the adversarial input is
  // not a negative test.
  const path = resolve(manifestPath);
  if (!existsSync(path)) return {};
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
  const declared = parsed?.supersedes;
  if (declared === null || typeof declared !== 'object' || Array.isArray(declared)) return {};
  // FILTERED AGAINST THE ALLOWLIST, here at the point of use. A manifest that
  // declares a transition for a path outside it is not an error to report —
  // it is simply ignored, so the drift it was trying to excuse is reported
  // instead, which is the correct outcome and the one a tamperer least wants.
  const allowed = {};
  for (const [path, ends] of Object.entries(declared)) {
    if (SUPERSEDABLE_EVIDENCE_FILES.includes(path)) allowed[path] = ends;
  }
  return allowed;
}

/**
 * Compares the recorded manifest with the tree and returns the paths that
 * disagree. `--write` regenerates it instead.
 */
export function checkOrWrite(mode = '--check', manifestPath = MANIFEST_PATH) {
  // The path is a PARAMETER so a test can drive this against a manifest whose
  // recorded hashes it controls. ROUND 26 FINDING 1: replacing this function's
  // delegation with `return []` left 17 of 17 tests green, because the negative
  // cases exercised `manifestDrift` directly and the only case that invoked
  // THIS function supplied a clean tree. A gate nothing drives to a failing
  // answer is a gate nothing tests.
  const built = buildManifest();
  const path = resolve(manifestPath);

  if (mode === '--write') {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, stringify(built));
    return [];
  }

  if (!existsSync(path)) throw new Error(`E4 evidence manifest is missing: ${manifestPath}`);
  const recorded = JSON.parse(readFileSync(path, 'utf8'));

  // DECLARED SUPERSESSION. See scripts/post-e4-evidence-manifest.mjs for why
  // this exists and what it costs: declaring a post-E4 migration necessarily
  // moves five of the files pinned here, and the three ways of handling that
  // were (a) regenerate this manifest, which the founder forbade by name,
  // (b) leave the gate failing with no way to tell a successor from tampering,
  // or (c) require the transition to be declared at BOTH ends. This is (c).
  //
  // A drift is forgiven only when the successor manifest says the file moved
  // FROM exactly the hash recorded here TO exactly the hash now on disk. A
  // file that moved twice, or whose declaration names the wrong origin, still
  // fails — and so does a file nothing declares at all.
  return manifestDrift(recorded, built, supersededBy());
}

/**
 * The comparison itself, as a pure function of three inputs.
 *
 * EXTRACTED for ROUND 25 FINDING 3. The suite could not tell a working checker
 * from one that returned [] unconditionally, because the only test touching
 * this compared copied maps instead of invoking it. A pure predicate can be
 * driven with synthetic recorded/built pairs where the answer is known, which
 * is the pattern this repository already uses for successorPinDrift and
 * classificationDrift.
 */
export function manifestDrift(recorded, built, superseded) {
  const drift = [];
  for (const [filePath, hash] of Object.entries(built.files)) {
    const before = recorded.files?.[filePath];
    if (before === hash) continue;
    const declared = superseded[filePath];
    if (declared?.e4 === before && declared?.now === hash) continue;
    drift.push(filePath);
  }
  for (const filePath of Object.keys(recorded.files ?? {})) {
    if (!(filePath in built.files)) drift.push(`${filePath} (recorded but absent)`);
  }
  if (recorded.counts?.migrations !== built.counts.migrations) drift.push('counts.migrations');
  if (JSON.stringify(recorded.expectedChain) !== JSON.stringify(built.expectedChain)) {
    drift.push('expectedChain');
  }
  if (recorded.h9BaselineUnchanged?.postmigrationChecks !== built.h9BaselineUnchanged.postmigrationChecks) {
    drift.push('h9BaselineUnchanged.postmigrationChecks');
  }
  if (recorded.h9BaselineUnchanged?.migration34 !== built.h9BaselineUnchanged.migration34) {
    drift.push('h9BaselineUnchanged.migration34');
  }
  return drift;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const drift = checkOrWrite(process.argv[2] ?? '--check');
  if (drift.length) {
    console.error(`E4 evidence manifest drift:\n  ${drift.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`E4 evidence manifest: ${process.argv[2] === '--write' ? 'written' : 'no drift'}`);
}
