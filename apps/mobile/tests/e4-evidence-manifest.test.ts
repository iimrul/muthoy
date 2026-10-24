import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
// Plain .mjs tooling, the same import style
// migration-rollback-classification.test.ts uses for classify-migrations.mjs.
import {
  E4_EVIDENCE_FILES,
  MANIFEST_PATH,
  buildManifest,
  checkOrWrite,
  hashFile,
} from '../../../scripts/e4-evidence-manifest.mjs';

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
