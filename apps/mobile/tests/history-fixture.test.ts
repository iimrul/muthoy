import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { validateHistoryFixture } from '../../../scripts/generate-history-fixture.mjs';

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
