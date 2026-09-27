import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CLASSIFICATION_MANIFEST,
  FORWARD_ONLY_OVERRIDES,
  PG_MIGRATIONS_DIR,
  SQLITE_MIGRATIONS_DIR,
  classCounts,
  classifyDirectory,
  describeMigration,
  assertManifestMatchesMigrations,
} from '../../../scripts/classify-migrations.mjs';
import { generatedBlocks, renderRollbackDocs } from '../../../scripts/render-rollback-docs.mjs';

// H-11 C1. The first audit classified migrations by grepping for DML anywhere
// in the file, which counted UPDATE and INSERT inside CREATE OR REPLACE
// FUNCTION bodies — runtime code the migration SHIPS, not data it WRITES.
// Seven migrations were marked forward-only on that mistake.
//
// This test exists so the document and the classifier cannot drift apart
// again: ROLLBACK.md is generated from the classifier, and every row in it is
// checked back against the SQL here.

const ROLLBACK_DOC = readFileSync(
  resolve('backend/supabase/migrations/ROLLBACK.md'), 'utf8',
);

const pg = classifyDirectory(PG_MIGRATIONS_DIR, 'postgres');

describe('single machine-readable rollback authority', () => {
  it('matches every PostgreSQL and SQLite migration-time classification', () => {
    expect(() => assertManifestMatchesMigrations()).not.toThrow();
    expect(Object.keys(CLASSIFICATION_MANIFEST.postgres)).toHaveLength(pg.length);
  });

  it('renders all three documentation views without drift', () => {
    const sources = {
      rollback: ROLLBACK_DOC,
      backend: readFileSync(resolve('backend/supabase/migrations/README.md'), 'utf8'),
      mobile: readFileSync(resolve('apps/mobile/db/README.md'), 'utf8'),
    };
    expect(renderRollbackDocs(sources)).toEqual(sources);
  });

  it('detects a mutated count/reference in each generated document', () => {
    const blocks = generatedBlocks();
    for (const [key, body] of Object.entries(blocks)) {
      const mutated = body.replace('C: 7', 'C: 8').replace('`0001`', '`9999`');
      const sources = {
        rollback: ROLLBACK_DOC,
        backend: readFileSync(resolve('backend/supabase/migrations/README.md'), 'utf8'),
        mobile: readFileSync(resolve('apps/mobile/db/README.md'), 'utf8'),
      };
      sources[key as keyof typeof sources] = sources[key as keyof typeof sources].replace(body, mutated);
      expect(renderRollbackDocs(sources)[key as keyof typeof sources])
        .not.toBe(sources[key as keyof typeof sources]);
    }
  });
});

describe('function bodies are not migration-time mutation', () => {
  it('ignores DML inside a dollar-quoted body', () => {
    const facts = describeMigration(
      "CREATE OR REPLACE FUNCTION f() RETURNS void AS $$ BEGIN "
      + "UPDATE public.sales SET total = 0; INSERT INTO public.x VALUES (1); "
      + "END; $$ LANGUAGE plpgsql;",
      'postgres',
    );
    expect(facts.update).toBe(0);
    expect(facts.insert).toBe(0);
    expect(facts.createFunction).toBe(1);
  });

  it('still counts DML the migration performs itself', () => {
    const facts = describeMigration(
      "UPDATE public.expenses SET category = 'utilities' WHERE category = 'electricity';",
      'postgres',
    );
    expect(facts.update).toBe(1);
  });

  it('ignores DML inside a SQLite trigger body', () => {
    const facts = describeMigration(
      'CREATE TRIGGER t AFTER INSERT ON a BEGIN UPDATE `b` SET `x` = 1; END;',
      'sqlite',
    );
    expect(facts.update).toBe(0);
    expect(facts.createTrigger).toBe(1);
  });
});

describe('the corrected PostgreSQL classification', () => {
  it('covers every migration on disk exactly once', () => {
    expect(pg.length).toBe(28);
    expect(new Set(pg.map((row) => row.name)).size).toBe(28);
  });

  it('is A 6 / B 15 / C 7 — not the 14 forward-only the first audit claimed', () => {
    // Hardcoded on purpose. A migration that changes class has to change this
    // number too, which is the point at which somebody looks at it.
    // A2.3 added the registry plus its persistent-hold hotfix: function and
    // trigger definitions, zero migration-time DML, so both are B.
    expect(classCounts(pg)).toEqual({ A: 6, B: 15, C: 7 });
  });

  it('declares its one judgement instead of inferring it', () => {
    // The baseline performs no DML, so the mechanical rule alone would call
    // it reversible — but the reverse of "create the whole schema" is a
    // restore. That is an override, and it is named in the source.
    expect([...FORWARD_ONLY_OVERRIDES]).toEqual(['20260813000000_initial_schema.sql']);
  });

  it.each(pg.map((row) => [row.name, row.class]))(
    'ROLLBACK.md lists %s as class %s',
    (name, expected) => {
      const stem = String(name).replace('.sql', '');
      const line = ROLLBACK_DOC.split('\n').find((row) => row.startsWith('| `' + stem + '`'));
      expect(line, `${stem} is missing from ROLLBACK.md`).toBeTruthy();
      const cell = (line ?? '').split('|')[2]?.trim();
      expect(cell?.replace(/\*/g, '')).toBe(expected);
    },
  );

  it('states the corrected headline count in the document itself', () => {
    expect(ROLLBACK_DOC).toContain('**A: 6 · B: 15 · C: 7 — of 28.**');
  });

  it('carries no OTHER headline anywhere in any of the three documents', () => {
    // The blocker this exists for. ROLLBACK.md stated the headline TWICE —
    // once inside the generated block and once in the hand-maintained section
    // below it — and only the generated one was ever checked. A2.3 moved the
    // counts, the generated copy updated itself, and the hand copy sat there
    // saying "A: 6 · B: 13 · C: 7 — of 26" with the whole suite green.
    //
    // Now every headline-shaped string in all three documents is checked,
    // wherever it appears, generated or not.
    const counts = classCounts(pg);
    const expected = `A: ${counts.A} · B: ${counts.B} · C: ${counts.C} — of ${pg.length}`;
    const headline = /A: \d+ · B: \d+ · C: \d+ — of \d+/g;
    const documents = {
      'ROLLBACK.md': ROLLBACK_DOC,
      'backend/README.md': readFileSync(
        resolve('backend/supabase/migrations/README.md'), 'utf8',
      ),
      'mobile/db/README.md': readFileSync(resolve('apps/mobile/db/README.md'), 'utf8'),
    };
    for (const [name, body] of Object.entries(documents)) {
      for (const found of body.match(headline) ?? []) {
        expect(found, `${name} states a stale headline`).toBe(expected);
      }
    }
    // And the one we know about is genuinely stated more than once, so this
    // test cannot pass by finding nothing to check.
    expect((ROLLBACK_DOC.match(headline) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('keeps every hand-written per-migration row matching the classifier', () => {
    // The same failure one level down: the table below the headline is
    // hand-maintained, so its statement counts can drift from the SQL exactly
    // the way the headline did. Checked here for every row at once.
    const KINDS: Record<string, keyof (typeof pg)[number]['facts']> = {
      function: 'createFunction', trigger: 'createTrigger', table: 'createTable',
      index: 'createIndex', policy: 'createPolicy', 'ADD COLUMN': 'addColumn',
      GRANT: 'grant', REVOKE: 'revoke', UPDATE: 'update', INSERT: 'insert',
      'DROP TABLE': 'dropTable', 'DROP FUNCTION': 'dropFunction',
      'DROP POLICY': 'dropPolicy', 'DROP TRIGGER': 'dropTrigger',
      'DROP CONSTRAINT': 'dropConstraint',
    };
    let checked = 0;
    for (const row of pg) {
      const stem = row.name.replace('.sql', '');
      const line = ROLLBACK_DOC.split('\n').find((entry) => entry.startsWith(`| \`${stem}\``));
      expect(line, `${stem} missing from the per-migration table`).toBeTruthy();
      const statements = (line ?? '').split('|')[3] ?? '';
      for (const match of statements.matchAll(/(\d+) ([A-Za-z ]+?)(?=,|$|—)/g)) {
        const key = KINDS[(match[2] ?? '').trim()];
        if (!key) continue;
        checked += 1;
        expect(
          Number(match[1]),
          `${stem}: ROLLBACK.md claims ${match[1]} ${match[2]}`,
        ).toBe(row.facts[key]);
      }
    }
    // Guards against the regex silently matching nothing and the loop above
    // asserting on an empty set.
    expect(checked).toBeGreaterThan(80);
  });

  it.each([
    '20260818000000_inventory_movement_ledger',
    '20260823020000_b3_group2_sync_completion',
    '20260823050000_b3_groups456_sync_completion',
    '20260827010000_b3_group9_sale_tax_snapshot',
    '20260905000000_b4_canonical_onboarding',
    '20260909000000_h7_actor_binding_staff_reactivation',
  ])('%s is no longer forward-only', (stem) => {
    const row = pg.find((entry) => entry.name.startsWith(stem));
    expect(row?.class).toBe('B');
    expect(row?.facts.update).toBe(0);
    expect(row?.facts.insert).toBe(0);
  });
});

describe('the local SQLite side', () => {
  const lite = classifyDirectory(SQLITE_MIGRATIONS_DIR, 'sqlite');
  const writesData = lite
    .filter((row) => row.facts.update + row.facts.insert + row.facts.delete > 0)
    .map((row) => row.name.slice(0, 4));

  it('names every migration that writes data at migration time', () => {
    // The first audit listed seven of these and missed 0001, 0009, 0011, 0012.
    expect(writesData).toEqual(
      ['0001', '0002', '0006', '0007', '0009', '0010', '0011', '0012', '0018', '0024', '0029'],
    );
  });

  it('lists them all in ROLLBACK.md', () => {
    for (const stem of writesData) {
      expect(ROLLBACK_DOC).toContain('`' + stem + '`');
    }
  });

  it('names the ones that drop tables, which no re-run can undo', () => {
    expect(lite.filter((row) => row.facts.dropTable > 0).map((row) => row.name.slice(0, 4)))
      .toEqual(['0006', '0011', '0012']);
  });
});
