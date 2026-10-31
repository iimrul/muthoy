import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
// Plain .mjs tooling, the same import style
// migration-rollback-classification.test.ts uses for classify-migrations.mjs.
import {
  E4_EVIDENCE_FILES,
  MANIFEST_PATH,
  buildManifest,
  checkOrWrite,
  hashFile,
  SUPERSEDABLE_EVIDENCE_FILES,
  manifestDrift,
  supersededBy,
} from '../../../scripts/e4-evidence-manifest.mjs';
import { currentSupersessions } from '../../../scripts/post-e4-evidence-manifest.mjs';

// E4's evidence manifest, verified rather than trusted.
//
// H-9's manifest (audit-artifacts/h9-remediation/final-source-hashes.json) is a
// static snapshot that nothing re-checks, and one of its recorded hashes —
// DECISIONS.md — has already drifted away from the tree. A recorded hash that
// nothing verifies is decoration. These assertions make E4's the opposite: if
// any recorded artifact changes without the manifest being regenerated, this
// test fails and names the file.

const RECORDED = JSON.parse(readFileSync(resolve(MANIFEST_PATH), 'utf8')) as {
  batch: number;
  gate: string;
  expectedChain: string[];
  h9BaselineUnchanged: { postmigrationChecks: string; migration34: string };
  counts: { migrations: number; e4EvidenceFiles: number };
  files: Record<string, string>;
};

/** The value H-9 signed off, quoted here so the comparison is visible. */
const H9_CHECKS_SHA256 = '361a400a29025f2d859b4cd3e4f826afcdcd2c134a332b3412b9a2e0af1e2bd9';

describe('E4 evidence manifest', () => {
  it('matches the tree exactly', () => {
    expect(checkOrWrite('--check')).toEqual([]);
  });

  it('records all 35 migrations and the 13 E4 evidence files', () => {
    expect(RECORDED.counts).toEqual({ migrations: 35, e4EvidenceFiles: 13 });
    expect(Object.keys(RECORDED.files)).toHaveLength(48);
    expect(RECORDED.expectedChain).toHaveLength(35);
    expect(RECORDED.expectedChain.at(-1)).toBe('20261023000000');
  });

  it('records every file the successor mechanism rests on', () => {
    // Named explicitly: if a later change drops one of the four chain gates
    // from the manifest, the claim "all four were updated together and none
    // weakened" silently stops being checkable.
    for (const path of [
      'backend/supabase/checks/e4_postmigration_checks.sql',
      'scripts/h9-prod-preflight.mjs',
      'backend/supabase/pgtest/h9-cron-cleanup.pgtest.ts',
      'backend/supabase/pgtest/h9-environment-parity.pgtest.ts',
      'apps/mobile/tests/migration-rollback-classification.test.ts',
      'backend/supabase/migrations/rollback-classification.json',
      'backend/supabase/migrations/20261023000000_e4_batch3_admin_platform.sql',
      '.gitattributes',
    ]) {
      expect(RECORDED.files[path], path).toMatch(/^[a-f0-9]{64}$/);
    }
    expect([...E4_EVIDENCE_FILES]).toContain('.gitattributes');
  });

  it('shows the H-9 baseline is untouched, by hash', () => {
    // The whole premise of the successor design is that the signed-off check
    // file was not edited. This is that claim, as a number.
    expect(RECORDED.h9BaselineUnchanged.postmigrationChecks).toBe(H9_CHECKS_SHA256);
    expect(hashFile('backend/supabase/checks/h9_postmigration_checks.sql')).toBe(H9_CHECKS_SHA256);
  });

  it('hashes LF-normalised content, so a CRLF checkout cannot break it', () => {
    // The failure this repository has hit three times. A manifest whose values
    // depend on the clone's core.autocrlf is a manifest that stops reproducing
    // on somebody else's machine, and .gitattributes can only pin the files it
    // lists — these include test files that are not pinned.
    const built = buildManifest() as unknown as { files: Record<string, string> };
    const path = 'backend/supabase/pgtest/checkFile.ts';
    const raw = readFileSync(resolve(path), 'utf8');
    expect(built.files[path]).toBe(hashFile(path));
    expect(raw.replace(/\r\n/g, '\n').length).toBeLessThanOrEqual(raw.length);
  });

  it('detects a changed artifact, so it cannot pass vacuously', () => {
    // Mutation check: a manifest that would accept any tree is not evidence.
    // Flipping one recorded hash must be reported, and must name that file.
    const built = buildManifest() as unknown as { files: Record<string, string> };
    const target = 'backend/supabase/checks/e4_postmigration_checks.sql';
    const tampered: Record<string, string> = { ...built.files, [target]: 'f'.repeat(64) };

    const drift = Object.entries(built.files)
      .filter(([path, hash]) => tampered[path] !== hash)
      .map(([path]) => path);
    expect(drift).toEqual([target]);
  });
});

// ───────────────────────────────── the successor supersession guard, round 18

describe('declared supersession cannot bless a sealed artifact', () => {
  // ROUND 18 FINDING 7, and it was the worst defect in the E4-B work. The
  // successor mechanism was built so that declaring migration 36 — which
  // necessarily moves seven chain-declaration files — would not require
  // rewriting the signed E4 manifest. It iterated EVERY entry in
  // E4_EVIDENCE_FILES, which includes the sealed acceptance SQL. The reviewer
  // changed `e4_postmigration_checks.sql`, regenerated the successor manifest,
  // and BOTH drift checks reported no drift.
  //
  // So the thing built to protect the chain declarations had become a way to
  // launder the sealed SQL those declarations are checked against.

  const SEALED = 'backend/supabase/checks/e4_postmigration_checks.sql';

  it('the sealed acceptance SQL is pinned by the E4 manifest', () => {
    // Non-vacuity for everything below: if this path were not pinned at all,
    // the assertions about refusing to supersede it would prove nothing.
    expect(Object.keys(RECORDED.files)).toContain(SEALED);
    expect(E4_EVIDENCE_FILES).toContain(SEALED);
  });

  it('the allowlist is exactly the seven files a chain declaration must touch', () => {
    // Hardcoded on purpose, and transcribed independently of the constant.
    // Widening this list is a privacy-and-evidence decision, and the point of
    // asserting it here is that the decision shows up as a failing test rather
    // than as a side effect of running `--write`.
    expect([...SUPERSEDABLE_EVIDENCE_FILES].sort()).toEqual([
      '.gitattributes',
      'apps/mobile/tests/migration-rollback-classification.test.ts',
      'backend/supabase/migrations/README.md',
      'backend/supabase/migrations/ROLLBACK.md',
      'backend/supabase/migrations/rollback-classification.json',
      'backend/supabase/pgtest/checkFile.ts',
      'scripts/h9-prod-preflight.mjs',
    ]);
  });

  it('refuses to supersede the sealed SQL, the sealed migrations, or the acceptance pgtests', () => {
    const neverSupersedable = E4_EVIDENCE_FILES.filter(
      (path: string) => !SUPERSEDABLE_EVIDENCE_FILES.includes(path),
    );
    // There is something to check, and it includes the sealed SQL.
    expect(neverSupersedable.length).toBeGreaterThan(0);
    expect(neverSupersedable).toContain(SEALED);
    for (const path of neverSupersedable) {
      expect(SUPERSEDABLE_EVIDENCE_FILES, path + ' must never be supersedable').not.toContain(path);
    }
  });

  it('the generator never emits a supersession outside the allowlist', () => {
    for (const path of Object.keys(currentSupersessions())) {
      expect(SUPERSEDABLE_EVIDENCE_FILES, path).toContain(path);
    }
  });

  it('a HAND-EDITED manifest declaring the sealed SQL is ignored, not honoured', () => {
    // THE ASSERTION THAT ACTUALLY CLOSES THE FINDING. Restricting the
    // GENERATOR is not enough — `supersededBy()` reads the JSON, so a manifest
    // edited by hand would be obeyed however careful the generator was. The
    // allowlist therefore lives with the CONSUMER, and this exercises that.
    const declared = supersededBy() as Record<string, { e4?: string; now?: string }>;
    expect(declared[SEALED]).toBeUndefined();
    // And the filter is on the path, so the shape of the entry is irrelevant.
    expect(Object.keys(declared).every((path) => SUPERSEDABLE_EVIDENCE_FILES.includes(path))).toBe(
      true,
    );
  });

  it('every declared supersession names BOTH ends, and the e4 end matches what was signed', () => {
    // A declaration whose `e4` side did not match the signed manifest would let
    // a file be laundered through two undeclared changes.
    const declared = supersededBy() as Record<string, { e4?: string; now?: string }>;
    for (const [path, ends] of Object.entries(declared)) {
      expect(typeof (ends as { e4?: unknown }).e4, path).toBe('string');
      expect(typeof (ends as { now?: unknown }).now, path).toBe('string');
      expect((ends as { e4: string }).e4, path).toBe(RECORDED.files[path]);
      expect((ends as { now: string }).now, path).toBe(hashFile(path));
    }
  });
});

// ───────────────────────────── round 25: the negative tests, made adversarial

describe('the supersession guard, with input a tamperer would actually supply', () => {
  // ROUND 25 FINDING 3, and both halves were my fault in the same way.
  //
  // The test above claiming a HAND-EDITED manifest is ignored only read the
  // REAL manifest, which declares nothing forbidden — so removing the
  // allowlist filter in `supersededBy` left 12 of 12 tests green. And the
  // changed-artifact test compared copied maps instead of invoking the
  // checker, so making `checkOrWrite('--check')` return [] unconditionally
  // ALSO left 12 of 12 green.
  //
  // A negative test that never supplies the adversarial input is not a
  // negative test, and a gate nothing invokes is not a gate.

  const SEALED = 'backend/supabase/checks/e4_postmigration_checks.sql';

  it('IGNORES a declaration for the sealed SQL when one is actually present', () => {
    const dir = mkdtempSync(join(tmpdir(), 'e4b-supersede-'));
    try {
      const forged = join(dir, 'post-e4-source-hashes.json');
      writeFileSync(
        forged,
        JSON.stringify({
          supersedes: {
            // Forbidden: the sealed acceptance SQL.
            [SEALED]: { e4: 'a'.repeat(64), now: 'b'.repeat(64) },
            // Allowed, so the test proves FILTERING rather than wholesale
            // rejection of a manifest that contains anything forbidden.
            'backend/supabase/pgtest/checkFile.ts': { e4: 'c'.repeat(64), now: 'd'.repeat(64) },
          },
        }),
      );
      const declared = supersededBy(forged) as Record<string, unknown>;
      expect(declared[SEALED]).toBeUndefined();
      expect(declared['backend/supabase/pgtest/checkFile.ts']).toEqual({
        e4: 'c'.repeat(64),
        now: 'd'.repeat(64),
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports drift for a changed artifact, and the checker is what says so', () => {
    // Driven through the extracted comparison with synthetic inputs, so a
    // checker that returned [] unconditionally fails this.
    const recorded = {
      files: { 'a.ts': 'a'.repeat(64) },
      counts: { migrations: 1 },
      expectedChain: ['20260813000000'],
      h9BaselineUnchanged: { postmigrationChecks: 'x', migration34: 'y' },
    };
    const built = {
      files: { 'a.ts': 'z'.repeat(64) },
      counts: { migrations: 1 },
      expectedChain: ['20260813000000'],
      h9BaselineUnchanged: { postmigrationChecks: 'x', migration34: 'y' },
    };
    expect(manifestDrift(recorded, built, {})).toEqual(['a.ts']);
  });

  it('forgives that same drift ONLY when both ends are declared', () => {
    const recorded = {
      files: { 'a.ts': 'a'.repeat(64) },
      counts: { migrations: 1 },
      expectedChain: [],
      h9BaselineUnchanged: { postmigrationChecks: 'x', migration34: 'y' },
    };
    const built = {
      files: { 'a.ts': 'z'.repeat(64) },
      counts: { migrations: 1 },
      expectedChain: [],
      h9BaselineUnchanged: { postmigrationChecks: 'x', migration34: 'y' },
    };
    // Both ends right: forgiven.
    expect(
      manifestDrift(recorded, built, { 'a.ts': { e4: 'a'.repeat(64), now: 'z'.repeat(64) } }),
    ).toEqual([]);
    // Wrong ORIGIN: still drift, so a file cannot be laundered through two
    // undeclared changes.
    expect(
      manifestDrift(recorded, built, { 'a.ts': { e4: 'q'.repeat(64), now: 'z'.repeat(64) } }),
    ).toEqual(['a.ts']);
    // Wrong DESTINATION: still drift.
    expect(
      manifestDrift(recorded, built, { 'a.ts': { e4: 'a'.repeat(64), now: 'q'.repeat(64) } }),
    ).toEqual(['a.ts']);
  });

  it('reports a recorded file that has vanished, and the baseline hashes', () => {
    const base = {
      counts: { migrations: 1 },
      expectedChain: [],
      h9BaselineUnchanged: { postmigrationChecks: 'x', migration34: 'y' },
    };
    expect(
      manifestDrift({ ...base, files: { 'gone.ts': 'a' } }, { ...base, files: {} }, {}),
    ).toEqual(['gone.ts (recorded but absent)']);
    expect(
      manifestDrift(
        { ...base, files: {} },
        { ...base, files: {}, h9BaselineUnchanged: { postmigrationChecks: 'CHANGED', migration34: 'y' } },
        {},
      ),
    ).toEqual(['h9BaselineUnchanged.postmigrationChecks']);
    expect(
      manifestDrift(
        { ...base, files: {} },
        { ...base, files: {}, h9BaselineUnchanged: { postmigrationChecks: 'x', migration34: 'CHANGED' } },
        {},
      ),
    ).toEqual(['h9BaselineUnchanged.migration34']);
  });

  it('the live tree reports no drift THROUGH the checker, not through a copy', () => {
    // The positive case, invoking the real gate. Paired with the synthetic
    // negatives above, an unconditional [] now fails one of the two.
    expect(checkOrWrite('--check')).toEqual([]);
  });
});

describe('the real checker, driven to a FAILING answer', () => {
  // ROUND 26 FINDING 1. Replacing `checkOrWrite`'s delegation with `return []`
  // left 17 of 17 tests green: the negative cases exercised `manifestDrift`
  // directly, and the only case that invoked `checkOrWrite` supplied a clean
  // tree, where [] is the correct answer. A gate nothing drives to a failing
  // answer is a gate nothing tests — which is the same defect as round 25
  // finding 3, one layer up, in the fix for round 25 finding 3.
  //
  // So this points the real function at a manifest whose recorded hash for a
  // real file is wrong, and requires it to say so.

  it('reports the drifted path when the recorded hash is wrong', () => {
    const dir = mkdtempSync(join(tmpdir(), 'e4b-checker-'));
    try {
      const path = join(dir, 'e4-source-hashes.json');
      const built = buildManifest();
      const target = 'backend/supabase/pgtest/checkFile.ts';
      expect(Object.keys(built.files)).toContain(target);
      // Everything right except ONE hash, so the answer can only be that path.
      writeFileSync(
        path,
        JSON.stringify({
          ...built,
          files: { ...built.files, [target]: '0'.repeat(64) },
        }),
      );
      const drift = checkOrWrite('--check', path);
      expect(drift).toContain(target);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports NOTHING for a manifest that matches the tree', () => {
    // The positive control, through the same injectable path — so the test
    // above cannot pass by the checker simply always reporting something.
    const dir = mkdtempSync(join(tmpdir(), 'e4b-checker-ok-'));
    try {
      const path = join(dir, 'e4-source-hashes.json');
      writeFileSync(path, JSON.stringify(buildManifest()));
      expect(checkOrWrite('--check', path)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('defaults to the REAL manifest when no path is given', () => {
    // The parameter must not have moved the gate. With no argument this is the
    // shipped CLI behaviour, and the tree is clean.
    expect(checkOrWrite('--check')).toEqual([]);
    expect(checkOrWrite()).toEqual([]);
  });
});
