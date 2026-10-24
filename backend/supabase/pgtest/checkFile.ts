// One reader for the post-migration check files, because there are now two of
// them and every parser in this directory was hardcoded to the first.
//
// h9-cron-cleanup.pgtest.ts owned a private `checkSection` that read
// backend/supabase/checks/h9_postmigration_checks.sql by a literal path — as do
// h9-api-role-model.ts, h9-api-role-privileges.pgtest.ts and
// h9-environment-parity.pgtest.ts. E4 adds a SUCCESSOR check file with the
// identical format, so the choice was to write a fifth copy or to parameterise
// one. DEVELOPMENT_RULES.md is explicit — "Never duplicate a type, a Zod
// schema, or a business-logic constant" — and DECISIONS.md records the same
// mistake at "D10 — one error-to-text map, not two".
//
// SCOPE, deliberately limited: this is used by the files Batch 3 legitimately
// touches — the cron test it must re-scope, and the two new E4 tests. The other
// three H-9 files keep their private copies. They are signed-off evidence and
// churning them for tidiness would put hash-recorded work at risk for no
// behavioural gain, which is the opposite of what consolidation is for.
//
// The format both check files share: sections delimited by "-- section: <name>"
// lines, each section ONE select returning rows of (check_name, pass, detail),
// each run inside a read-only transaction.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { migrationFiles, type Harness } from './harness';

/** The H-9 baseline check. BYTE-IDENTICAL, hash-pinned, founder-signed-off. */
export const H9_CHECK_FILE = 'backend/supabase/checks/h9_postmigration_checks.sql';
/** The E4 successor, which governs the live chain. */
export const E4_CHECK_FILE = 'backend/supabase/checks/e4_postmigration_checks.sql';

/** Migration 34 — the last file of the H-9 baseline. */
export const M34_FILE = '20261015000000_h9_api_role_table_privileges.sql';

/**
 * The chain as it stood when H-9 was signed off: everything up to and including
 * migration 34.
 *
 * h9_postmigration_checks.sql's `history_post_h9` section asserts
 * `count(*) = 34` and `not exists (version > '20261015000000')`. That is a
 * correct description of THIS set and of nothing else, so a test exercising
 * that section has to record THIS set. Recording the whole directory — which is
 * what the test did before E4 existed — stopped describing the baseline the
 * moment the chain was extended.
 */
export function h9BaselineMigrationFiles(): string[] {
  return migrationFiles().filter((name) => name <= M34_FILE);
}

/** One section's SQL, by file and section name. */
export function checkSectionFrom(file: string, section: string): string {
  const text = readFileSync(resolve(file), 'utf8');
  const body = text.split(/^-- section: /m).find((part) => part.split(/\r?\n/, 1)[0] === section);
  if (!body) throw new Error(`missing check section ${section} in ${file}`);
  return body.slice(body.indexOf('\n') + 1);
}

/** check_name -> pass, for one section, inside a read-only transaction. */
export async function readOnlySectionFrom(
  h: Harness,
  file: string,
  section: string,
): Promise<Record<string, boolean>> {
  await h.exec('begin transaction read only');
  try {
    const rows = await h.all<{ check_name: string; pass: boolean }>(checkSectionFrom(file, section));
    return Object.fromEntries(rows.map((row) => [row.check_name, row.pass]));
  } finally {
    // In a finally so one section cannot leave an open transaction behind and
    // quietly change what the next one proves.
    await h.exec('rollback');
  }
}

/**
 * check_name -> detail, for the cases where WHICH version drifted is the point.
 * `pass` alone cannot distinguish "one version is missing" from "a different
 * one is extra", and the successor check exists precisely to tell those apart.
 */
export async function readOnlyDetailFrom(
  h: Harness,
  file: string,
  section: string,
): Promise<Record<string, string>> {
  await h.exec('begin transaction read only');
  try {
    const rows = await h.all<{ check_name: string; detail: string }>(
      checkSectionFrom(file, section),
    );
    return Object.fromEntries(rows.map((row) => [row.check_name, row.detail]));
  } finally {
    await h.exec('rollback');
  }
}
