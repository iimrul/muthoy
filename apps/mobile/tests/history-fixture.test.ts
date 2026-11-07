import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { SQL } from 'drizzle-orm';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
// The exact module the app boots through (apps/mobile/db/init.ts:1).
import { migrate } from 'drizzle-orm/expo-sqlite/migrator';
import {
  newestJournalEntry,
  validateHistoryFixture,
} from '../../../scripts/generate-history-fixture.mjs';

// H-11 C2. The fixture the restore drill is run against.
//
// A drill against a file that already violates the ledger, the credit ledger
// or the sale payment arithmetic cannot tell a restore failure from a fixture
// failure — which makes it worth nothing at the moment it is needed. The
// generator self-checks before it reports success; this proves the self-check
// is real, that it covers money and not only rows, and that the financial
// graph the drill compares is actually present.

const OUT_DIR = mkdtempSync(join(tmpdir(), 'muthoy-fixture-'));
const OUT = join(OUT_DIR, 'history.db');
let db: DatabaseSync;

beforeAll(() => {
  // Small but structurally complete: every table the graph needs is written,
  // just fewer times. A year takes half a minute and proves nothing extra.
  execFileSync(process.execPath, [
    resolve('scripts/generate-history-fixture.mjs'),
    '--out', OUT, '--days', '21', '--sales-per-day', '6', '--medicines', '30', '--seed', '3',
  ], { stdio: 'pipe' });
  db = new DatabaseSync(OUT);
}, 120_000);

afterAll(() => {
  db?.close();
});

const rows = (sql: string): Record<string, unknown>[] =>
  db.prepare(sql).all() as Record<string, unknown>[];
const one = (sql: string): Record<string, unknown> =>
  db.prepare(sql).get() as Record<string, unknown>;
const count = (table: string): number =>
  Number(one('SELECT COUNT(*) AS n FROM `' + table + '`').n);

describe('the fixture refuses to exist unless it is valid', () => {
  it('fails loudly when a real financial invariant is mutated', () => {
    db.exec('BEGIN');
    try {
      db.exec("UPDATE `purchases` SET `paid_amount` = `paid_amount` + 1 WHERE `id` = (SELECT `id` FROM `purchases` LIMIT 1)");
      expect(() => validateHistoryFixture(db)).toThrow(/paid amount equals linked supplier payments/);
    } finally {
      db.exec('ROLLBACK');
    }
  });
});

describe('the financial graph is production-equivalent', () => {
  it.each([
    'shops', 'users', 'roles', 'customers', 'suppliers',
    'medicines', 'batches', 'inventory_movements',
    'purchases', 'purchase_items',
    'sales', 'sale_items', 'credits', 'payments', 'credit_payment_allocations',
    'cash_drawer', 'expenses', 'audit_logs',
  ])('writes %s', (table) => {
    expect(count(table)).toBeGreaterThan(0);
  });

  it('covers all three sale payment shapes', () => {
    // Migration 0010's trigger enforces different arithmetic for each; a
    // fixture that only ever writes cash never exercises two thirds of it.
    const kinds = rows('SELECT DISTINCT `payment_type` AS t FROM `sales`').map((r) => r.t);
    expect(new Set(kinds)).toEqual(new Set(['cash', 'credit', 'split']));
  });

  it('carries both settled and outstanding receivables', () => {
    expect(Number(one('SELECT COUNT(*) AS n FROM `credits` WHERE `balance` = 0').n))
      .toBeGreaterThan(0);
    expect(Number(one('SELECT COUNT(*) AS n FROM `credits` WHERE `balance` > 0').n))
      .toBeGreaterThan(0);
  });

  it('carries both a payable and a settled supplier invoice', () => {
    expect(Number(one('SELECT COUNT(*) AS n FROM `purchases` WHERE `paid_amount` = `total`').n))
      .toBeGreaterThan(0);
    expect(Number(one('SELECT COUNT(*) AS n FROM `purchases` WHERE `paid_amount` < `total`').n))
      .toBeGreaterThan(0);
  });

  it('closes and reconciles each trading day', () => {
    expect(Number(one('SELECT COUNT(*) AS n FROM `cash_drawer` WHERE `reconciled_at` IS NULL').n))
      .toBe(0);
  });
});

describe('money, credit, cash and stock invariants hold in the generated file', () => {
  it('stock equals the sum of its movements, for every batch', () => {
    expect(rows(
      'SELECT b.`id` FROM `batches` b WHERE b.`stock` <> COALESCE('
      + '(SELECT SUM(m.`change_qty`) FROM `inventory_movements` m WHERE m.`batch_id` = b.`id`), 0)',
    )).toEqual([]);
  });

  it('never leaves a batch oversold without the flag', () => {
    expect(rows('SELECT `id` FROM `batches` WHERE `stock` < 0 AND `oversold_at` IS NULL'))
      .toEqual([]);
  });

  it('keeps every sale total equal to subtotal minus discount', () => {
    expect(rows('SELECT `id` FROM `sales` WHERE `total` <> `subtotal` - `discount_amount`'))
      .toEqual([]);
  });

  it('splits every sale into cash and credit that sum to the total', () => {
    expect(rows('SELECT `id` FROM `sales` WHERE `cash_applied` + `credit_amount` <> `total`'))
      .toEqual([]);
  });

  it('makes every sale subtotal the sum of its own lines', () => {
    expect(rows(
      'SELECT s.`id` FROM `sales` s WHERE s.`subtotal` <> COALESCE('
      + '(SELECT SUM(i.`line_total`) FROM `sale_items` i WHERE i.`sale_id` = s.`id`), 0)',
    )).toEqual([]);
  });

  it('matches every credit to the credit amount of its sale', () => {
    expect(rows(
      'SELECT c.`id` FROM `credits` c JOIN `sales` s ON s.`id` = c.`sale_id` '
      + 'WHERE c.`amount` <> s.`credit_amount`',
    )).toEqual([]);
  });

  it('keeps every credit balance equal to amount minus allocations', () => {
    // The one that a restore losing an allocation row would break, and that
    // row counts alone would never notice.
    expect(rows(
      'SELECT c.`id` FROM `credits` c WHERE c.`balance` <> c.`amount` - COALESCE('
      + '(SELECT SUM(a.`amount`) FROM `credit_payment_allocations` a '
      + 'WHERE a.`credit_id` = c.`id`), 0)',
    )).toEqual([]);
  });

  it('never lets a balance go negative or exceed its own amount', () => {
    expect(rows('SELECT `id` FROM `credits` WHERE `balance` < 0 OR `balance` > `amount`'))
      .toEqual([]);
  });

  it('never allocates more than a payment was worth', () => {
    expect(rows(
      'SELECT p.`id` FROM `payments` p WHERE COALESCE((SELECT SUM(a.`amount`) '
      + 'FROM `credit_payment_allocations` a WHERE a.`payment_id` = p.`id`), 0) > p.`amount`',
    )).toEqual([]);
  });

  it('allocates only against a credit of the same customer', () => {
    expect(rows(
      'SELECT a.`id` FROM `credit_payment_allocations` a '
      + 'JOIN `credits` c ON c.`id` = a.`credit_id` WHERE a.`customer_id` <> c.`customer_id`',
    )).toEqual([]);
  });

  it('never overpays a purchase', () => {
    expect(rows('SELECT `id` FROM `purchases` WHERE `paid_amount` < 0 OR `paid_amount` > `total`'))
      .toEqual([]);
  });

  it('links each supplier payment to its purchase and derives paid_amount from payments', () => {
    expect(rows(
      "SELECT pay.`id` FROM `payments` pay LEFT JOIN `purchases` p ON p.`id`=pay.`ref_id` "
      + "WHERE pay.`type`='supplier_payment' AND (p.`id` IS NULL OR p.`supplier_id`<>pay.`party_id`)",
    )).toEqual([]);
    expect(rows(
      'SELECT p.`id` FROM `purchases` p WHERE p.`paid_amount` <> COALESCE('
      + "(SELECT SUM(pay.`amount`) FROM `payments` pay WHERE pay.`type`='supplier_payment' "
      + 'AND pay.`ref_id`=p.`id`),0)',
    )).toEqual([]);
  });

  it('stores expense cash events with their real expense reference', () => {
    expect(rows(
      'SELECT e.`id` FROM `expenses` e WHERE e.`amount` <> COALESCE('
      + "(SELECT SUM(pay.`amount`) FROM `payments` pay WHERE pay.`type`='expense' "
      + 'AND pay.`ref_id`=e.`id`),0)',
    )).toEqual([]);
  });

  it('closes every drawer with the complete production cash equation', () => {
    expect(() => validateHistoryFixture(db)).not.toThrow();
    db.exec('BEGIN');
    try {
      db.exec("UPDATE `payments` SET `amount`=`amount`+1 WHERE `type`='withdrawal' AND `id`=(SELECT `id` FROM `payments` WHERE `type`='withdrawal' LIMIT 1)");
      expect(() => validateHistoryFixture(db)).toThrow(/complete production cash equation/);
    } finally {
      db.exec('ROLLBACK');
    }
  });

  it('makes every purchase total the sum of its received lines', () => {
    expect(rows(
      'SELECT p.`id` FROM `purchases` p WHERE p.`total` <> COALESCE((SELECT '
      + 'SUM(i.`qty` * i.`purchase_price`) FROM `purchase_items` i '
      + 'WHERE i.`purchase_id` = p.`id`), 0)',
    )).toEqual([]);
  });

  it('opens exactly one cash drawer per business date', () => {
    // CLAUDE.md rule 5: opening cash resets at midnight and is never
    // inherited, so two rows for one date is a corrupted day.
    expect(rows(
      'SELECT `business_date` FROM `cash_drawer` GROUP BY `shop_id`, `business_date` '
      + 'HAVING COUNT(*) > 1',
    )).toEqual([]);
  });

  it('holds no negative money anywhere it is impossible', () => {
    expect(rows(
      'SELECT `id` FROM `sales` WHERE `total` < 0 OR `cash_applied` < 0 OR `credit_amount` < 0 '
      + 'UNION ALL SELECT `id` FROM `payments` WHERE `amount` < 0 '
      + 'UNION ALL SELECT `id` FROM `expenses` WHERE `amount` < 0 '
      + 'UNION ALL SELECT `id` FROM `cash_drawer` WHERE `opening_cash` < 0',
    )).toEqual([]);
  });

  it('points every foreign key at a row that exists', () => {
    // PRAGMA foreign_keys is per-connection, so a fixture written with it on
    // can still be read by something that has it off. Check explicitly.
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('records money as integer paisa, never a float', () => {
    expect(rows(
      "SELECT `id` FROM `sales` WHERE typeof(`total`) <> 'integer' "
      + "UNION ALL SELECT `id` FROM `payments` WHERE typeof(`amount`) <> 'integer' "
      + "UNION ALL SELECT `id` FROM `credits` WHERE typeof(`balance`) <> 'integer'",
    )).toEqual([]);
  });
});

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

describe('the fixture carries Drizzle bookkeeping, so a restored device boots', () => {
  // restore_drill.md step 19 SIGKILLs mid-migration and relaunches. That needs
  // the app to boot off the fixture, and `apps/mobile/db/init.ts:88` runs
  // `migrate(db, migrations)` on every boot. With no `__drizzle_migrations`
  // row the migrator re-applies all 34 migrations to a database that already
  // has all 56 tables, and dies on the first CREATE TABLE.
  //
  // Everything below is derived from the journal and from the INSTALLED
  // migrator, deliberately NOT from a helper shared with the generator: one
  // shared implementation would let a single bug satisfy both sides.
  const journal = JSON.parse(
    readFileSync(resolve('apps/mobile/db/migrations/meta/_journal.json'), 'utf8'),
  ) as { entries: JournalEntry[] };
  const newest = journal.entries.reduce((a, b) => (b.when > a.when ? b : a));

  // The migrator's own read: drizzle-orm/sqlite-core/dialect.cjs:672-673.
  const newestRow = (): Record<string, unknown> => one(
    'SELECT `id`, `hash`, `created_at` FROM `__drizzle_migrations` '
    + 'ORDER BY `created_at` DESC LIMIT 1',
  );

  it('writes exactly the one row the migrator reads, with its three columns', () => {
    expect(count('__drizzle_migrations')).toBe(1);
    expect(rows("SELECT `name` FROM pragma_table_info('__drizzle_migrations')")
      .map((r) => r.name))
      .toEqual(['id', 'hash', 'created_at']);
  });

  it('records a timestamp that covers every migration in the journal', () => {
    // Stated so it does not depend on HOW the maximum is chosen. An earlier
    // revision asserted equality with a reduction identical to the generator's,
    // so a shared assumption about ties would have satisfied both sides.
    const recorded = Number(newestRow().created_at);
    expect(journal.entries.every((e) => e.when <= recorded)).toBe(true);
    expect(journal.entries.some((e) => e.when === recorded)).toBe(true);
    expect(one('SELECT typeof(`created_at`) AS t FROM `__drizzle_migrations`').t)
      .toBe('integer');
  });

  it('writes the hash the app itself writes, not a value of its own', () => {
    // drizzle-orm/expo-sqlite/migrator.cjs:42 builds every migration with
    // `hash: ""`, so that is what a real device's rows contain. An earlier
    // revision stored a sha256 here: valid, never read, and unlike any device.
    expect(newestRow().hash).toBe('');
  });

  it('refuses a journal whose timestamps are ambiguous', () => {
    // A tie would make the newer migration skip, because the predicate is
    // strict `<`. The generator must not silently produce such a fixture.
    const tied = { ...newest, idx: newest.idx + 1, tag: '0034_tied' };
    expect(() => newestJournalEntry({ entries: [...journal.entries, tied] }))
      .toThrow(/share "when"/);
    // ...and the real journal is accepted, so the guard is not blanket-refusing.
    expect(newestJournalEntry(journal).when).toBe(newest.when);
  });
});

describe('the REAL installed migrator, run against the generated fixture', () => {
  // Re-implementing the predicate in a test only proves the re-implementation.
  // These run drizzle's actual migrate() — the code that runs on the device —
  // against a copy of the fixture. This is what catches a bookkeeping table
  // that satisfies the column names but not the migrator, e.g. an `id` column
  // with a DEFAULT that collides on the next real insert.
  const journal = JSON.parse(
    readFileSync(resolve('apps/mobile/db/migrations/meta/_journal.json'), 'utf8'),
  ) as { entries: JournalEntry[] };
  const maxWhen = Math.max(...journal.entries.map((e) => e.when));

  const realMigrations = (entries: JournalEntry[]): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const e of entries) {
      out[`m${String(e.idx).padStart(4, '0')}`] = readFileSync(
        resolve(`apps/mobile/db/migrations/${e.tag}.sql`), 'utf8',
      );
    }
    return out;
  };

  const openCopy = (): DatabaseSync => {
    const copy = join(OUT_DIR, `migrator-${Math.random().toString(36).slice(2)}.db`);
    copyFileSync(OUT, copy);
    return new DatabaseSync(copy);
  };

  // drizzle's session shape, over node:sqlite.
  const driverFor = (target: DatabaseSync) => {
    const dialect = new SQLiteSyncDialect();
    return {
      dialect,
      session: {
        run(query: SQL<unknown>) {
          const q = dialect.sqlToQuery(query);
          return target.prepare(q.sql).run(...(q.params as never[]));
        },
        values(query: SQL<unknown>) {
          const q = dialect.sqlToQuery(query);
          return target.prepare(q.sql).all(...(q.params as never[])).map(Object.values);
        },
      },
    };
  };

  const tableNames = (target: DatabaseSync): string[] =>
    (target.prepare("SELECT `name` FROM sqlite_master WHERE type='table' ORDER BY `name`")
      .all() as { name: string }[]).map((r) => r.name);

  it('applies NOTHING and leaves the schema untouched — the app boots', async () => {
    const target = openCopy();
    try {
      const before = tableNames(target);
      const rowsBefore = Number((target
        .prepare('SELECT COUNT(*) AS n FROM `__drizzle_migrations`').get() as { n: number }).n);

      await migrate(driverFor(target) as never, {
        journal, migrations: realMigrations(journal.entries),
      } as never);

      expect(tableNames(target)).toEqual(before);
      expect(Number((target
        .prepare('SELECT COUNT(*) AS n FROM `__drizzle_migrations`').get() as { n: number }).n))
        .toBe(rowsBefore);
    } finally {
      target.close();
    }
  });

  it('survives TWO successive upgrades, each inserting its own row', async () => {
    // The non-vacuous half, run for real, TWICE. One upgrade is not enough: a
    // bookkeeping table declared `id SERIAL PRIMARY KEY DEFAULT 0` whose first
    // row is an explicit NULL passes a single upgrade (the first insert takes
    // id=0) and only collides on the second with
    // `UNIQUE constraint failed: __drizzle_migrations.id`. An independent
    // reviewer found exactly that surviving implementation.
    const target = openCopy();
    try {
      for (const [i, name] of ['probe_one', 'probe_two'].entries()) {
        const probe: JournalEntry = { idx: 9990 + i, when: maxWhen + 1 + i, tag: `003${4 + i}_${name}` };
        await migrate(driverFor(target) as never, {
          journal: { entries: [probe] },
          migrations: { [`m${String(9990 + i).padStart(4, '0')}`]: `CREATE TABLE ${name} (n INTEGER);` },
        } as never);
        expect(tableNames(target)).toContain(name);
        expect(Number((target
          .prepare('SELECT COUNT(*) AS n FROM `__drizzle_migrations`').get() as { n: number }).n))
          .toBe(2 + i);
      }
    } finally {
      target.close();
    }
  });

  it('has exactly the schema real Drizzle builds from an empty database', async () => {
    // Every other test compares the fixture against ITSELF, so a generator that
    // SKIPPED a migration while still recording the journal maximum would pass
    // all of them: migrate() suppresses the missing migration, the before/after
    // table lists match, and the fixture silently lacks that migration's
    // columns. The second finding of the same review. The only honest reference
    // is an empty database migrated independently through the real migrator.
    const ref = new DatabaseSync(join(OUT_DIR, `reference-${Math.random().toString(36).slice(2)}.db`));
    try {
      await migrate(driverFor(ref) as never, {
        journal, migrations: realMigrations(journal.entries),
      } as never);

      // Bookkeeping is excluded because it is NOT produced by a migration: the
      // migrator creates it for itself, and its stored DDL text differs from the
      // fixture's by identifier quoting. Its contents are asserted by the tests
      // above, so nothing here is left unchecked.
      const schemaOf = (t: DatabaseSync): string[] =>
        (t.prepare(
          "SELECT type, name, tbl_name, sql FROM sqlite_master "
          + "WHERE name NOT LIKE 'sqlite_%' AND tbl_name <> '__drizzle_migrations' "
          + 'ORDER BY type, name',
        ).all() as { type: string; name: string; tbl_name: string; sql: string | null }[])
          .map((r) => `${r.type}|${r.name}|${r.tbl_name}|${(r.sql ?? '').replace(/\s+/g, ' ').trim()}`);

      // Tables, columns, indexes and triggers, all of them.
      expect(schemaOf(db)).toEqual(schemaOf(ref));
    } finally {
      ref.close();
    }
  });
});

describe('validation rejects a STALE fixture artifact, not just a bad generator', () => {
  // The gap an independent review found: every test above regenerates the
  // fixture first, so they check fresh output. A fixture FILE on disk goes
  // stale when a migration lands later, and validateHistoryFixture is what the
  // drill trusts to say "this file is usable".
  it('fails validation when recorded metadata predates a migration', () => {
    const copy = join(OUT_DIR, 'stale.db');
    copyFileSync(OUT, copy);
    const stale = new DatabaseSync(copy);
    try {
      stale.exec('UPDATE `__drizzle_migrations` SET `created_at` = `created_at` - 1');
      expect(() => validateHistoryFixture(stale)).toThrow(/metadata is stale/);
    } finally {
      stale.close();
    }
  });

  it('fails validation when the bookkeeping table is missing entirely', () => {
    const copy = join(OUT_DIR, 'nometa.db');
    copyFileSync(OUT, copy);
    const bare = new DatabaseSync(copy);
    try {
      bare.exec('DROP TABLE `__drizzle_migrations`');
      expect(() => validateHistoryFixture(bare)).toThrow(/__drizzle_migrations is absent/);
    } finally {
      bare.close();
    }
  });

  it('fails validation when created_at is not stored as an integer', () => {
    // Non-numeric text sorts above integers in the ORDER BY, so it can hide the
    // real newest row and make Number() produce NaN, which silently skips.
    const copy = join(OUT_DIR, 'texty.db');
    copyFileSync(OUT, copy);
    const texty = new DatabaseSync(copy);
    try {
      texty.exec("UPDATE `__drizzle_migrations` SET `created_at` = 'garbage'");
      expect(() => validateHistoryFixture(texty)).toThrow(/not integer/);
    } finally {
      texty.close();
    }
  });

  it('accepts the fixture as generated', () => {
    expect(() => validateHistoryFixture(db)).not.toThrow();
  });
});
