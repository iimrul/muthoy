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
    expect(pg.length).toBe(26);
    expect(new Set(pg.map((row) => row.name)).size).toBe(26);
  });

  it('is A 6 / B 13 / C 7 — not the 14 forward-only the first audit claimed', () => {
    // Hardcoded on purpose. A migration that changes class has to change this
    // number too, which is the point at which somebody looks at it.
    expect(classCounts(pg)).toEqual({ A: 6, B: 13, C: 7 });
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
    expect(ROLLBACK_DOC).toContain('**A: 6 · B: 13 · C: 7 — of 26.**');
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
