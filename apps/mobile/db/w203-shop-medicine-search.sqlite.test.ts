// W2-03 — multilingual search over a shop's OWN medicines, on real SQLite.
//
// REAL SQLite, not a mock, for one reason: the thing under test is an fts5
// external-content index, three triggers and a 'rebuild'. A mock would assert
// that the code I wrote calls the functions I wrote; only a real database can
// say whether a Bangla query actually finds the row.
//
// THE UPGRADE IS THE CASE THAT MATTERS. A fresh install is easy and would pass
// for the wrong reason. What a real device does is arrive at migration 0033
// with a populated `medicines` table, a populated `batches` table, and sales and
// purchases referencing both — and the question is whether every one of those
// survives the FTS table being dropped and rebuilt. So the fixture is populated
// BEFORE 0033 is applied, and the assertions compare before against after.
//
// AND BOTH BACKFILL STATES ARE TESTED. Plan §9.6: the script matrix runs twice
// — once fully backfilled, and once with `search_key` forced back to NULL —
// because the NULL state is what exists on every device between the migration
// and the end of the backfill, and the union query is the only reason it works.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { sqlite } from './test/expo-sqlite';

const { db } = await import('./client');
const schema = await import('./schema');
const { searchMedicinesForSale } = await import('./sales');
const { searchMedicinesForPurchase } = await import('./purchases');
const { backfillChunk, backfillMedicineSearchKeys, pendingSearchKeyCount, BACKFILL_CHUNK_SIZE } =
  await import('./medicineSearchKeyBackfill');
const { toMultilingualFtsQuery } = await import('../domain/ftsQuery');
const { medicineSearchKey, medicineSearchKeys } = await import('@muthoy/utils');

/** নাপা — the Bangla spelling of the commonest paracetamol brand in BD. */
const NAPA_BN = 'নাপা';
const SHOP = 'shop-w203';
const OTHER_SHOP = 'shop-other';

/** Far future, so a batch is never excluded for expiry by accident. */
const EXPIRY = '2099-12-31';

function applyMigration(name: string): void {
  sqlite.exec(readFileSync(resolve('apps/mobile/db/migrations', name), 'utf8'));
}

function columnsOf(table: string): string[] {
  return sqlite
    .prepare('SELECT name FROM pragma_table_info(?)')
    .all(table)
    .map((row) => (row as { name: string }).name);
}

function rows<T = Record<string, unknown>>(sql: string): T[] {
  return sqlite.prepare(sql).all() as T[];
}

function scalar(sql: string): number {
  const row = sqlite.prepare(sql).get() as Record<string, unknown> | undefined;
  return Number(Object.values(row ?? { value: 0 })[0] ?? 0);
}

/** Matches an FTS expression and returns the medicine ids it reached. */
function matchedIds(expression: string, shopId?: string): string[] {
  const sql = shopId
    ? `SELECT m.id FROM medicines_fts
         JOIN medicines AS m ON m.rowid = medicines_fts.rowid
        WHERE medicines_fts MATCH ? AND m.shop_id = ?`
    : `SELECT m.id FROM medicines_fts
         JOIN medicines AS m ON m.rowid = medicines_fts.rowid
        WHERE medicines_fts MATCH ?`;
  const found = (
    shopId
      ? sqlite.prepare(sql).all(expression, shopId)
      : sqlite.prepare(sql).all(expression)
  ) as { id: string }[];
  return found.map((row) => row.id);
}

/** The union expression for a query, folded the way the index is folded. */
function union(query: string): string {
  return toMultilingualFtsQuery(query, medicineSearchKey);
}

/** Everything that must survive the migration, as one comparable string. */
function inventorySnapshot(): string {
  return JSON.stringify([
    rows('SELECT id, shop_id, name, generic, manufacturer FROM medicines ORDER BY id'),
    rows('SELECT id, medicine_id, stock, expiry_date FROM batches ORDER BY id'),
    rows('SELECT id, shop_id, invoice_no, total FROM sales ORDER BY id'),
    rows('SELECT id, sale_id, medicine_id, batch_id, qty FROM sale_items ORDER BY id'),
    rows('SELECT id, shop_id, invoice_no, total FROM purchases ORDER BY id'),
    rows('SELECT id, purchase_id, medicine_id, batch_no, qty FROM purchase_items ORDER BY id'),
  ]);
}

/**
 * Inserts a medicine and a stocked batch with RAW SQL, naming its columns.
 *
 * Raw rather than Drizzle, for a reason the first run of this file found: the
 * Drizzle schema now declares `searchKey`, and an insert built from it names
 * that column — which does not exist before migration 0033. Writing the
 * columns explicitly is also closer to what actually happens on a device,
 * where the rows were written by an OLDER BUNDLE that had never heard of it.
 */
function addMedicine(id: string, name: string, generic: string | null, shopId = SHOP): void {
  const now = '2026-10-01T00:00:00.000Z';
  sqlite
    .prepare(
      `INSERT INTO medicines
         (id, shop_id, name, generic, unit_of_measure, threshold,
          requires_prescription, is_dirty, is_deleted, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'piece', 20, 0, 1, 0, ?, ?)`,
    )
    .run(id, shopId, name, generic, now, now);
  // Migration 0006's ledger invariant: a batch OPENS AT ZERO and its stock
  // moves only through an inventory movement. Honouring that rather than
  // disabling the trigger is the point — the fixture has to be a database the
  // app could actually have produced, or the "nothing was corrupted"
  // assertions are comparing against something impossible.
  sqlite
    .prepare(
      `INSERT INTO batches
         (id, shop_id, medicine_id, batch_no, expiry_date, stock, purchase_price,
          sale_price, is_dirty, is_deleted, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, 100, 200, 1, 0, ?, ?)`,
    )
    .run('batch-' + id, shopId, id, 'B-' + id, EXPIRY, now, now);
  sqlite
    .prepare(
      `INSERT INTO inventory_movements
         (id, shop_id, batch_id, change_qty, reason, created_by, created_at, updated_at)
       VALUES (?, ?, ?, 10, 'purchase', ?, ?, ?)`,
    )
    .run('move-' + id, shopId, 'batch-' + id, 'owner-' + shopId, now, now);
}

/** The state every device is in between migration 0033 and the backfill. */
function clearAllSearchKeys(): void {
  sqlite.exec('UPDATE medicines SET search_key = NULL');
}

let beforeUpgrade = '';
let medicineCountBefore = 0;

beforeAll(() => {
  // The pre-0033 world, exactly as a device that has been trading would have
  // it: the original FTS migration and nothing newer.
  for (const name of [
    '0000_open_senator_kelly.sql',
    '0001_medicines_fts.sql',
    '0002_furry_celestials.sql',
    '0003_curious_wild_pack.sql',
    '0004_deep_boomer.sql',
    '0005_eminent_legion.sql',
    '0006_inventory_movement_ledger.sql',
    '0007_staff_device_login.sql',
    '0008_native_pin_lookup.sql',
    '0009_strong_gargoyle.sql',
    '0010_known_ares.sql',
    '0020_purchase_item_status.sql',
    '0021_purchase_void.sql',
    '0027_h7_local_access_lock.sql',
    '0028_shop_scoped_pin_lookup.sql',
    '0029_pin_reserved_while_inactive.sql',
  ]) {
    applyMigration(name);
  }

  const now = '2026-10-01T00:00:00.000Z';
  for (const shopId of [SHOP, OTHER_SHOP]) {
    sqlite
      .prepare(
        `INSERT INTO shops (id, owner_id, name, phone, is_dirty, is_deleted, created_at, updated_at)
         VALUES (?, ?, ?, '01700000000', 1, 0, ?, ?)`,
      )
      .run(shopId, 'owner-' + shopId, shopId, now, now);
    sqlite
      .prepare(
        `INSERT INTO roles (id, shop_id, name, is_system, is_dirty, is_deleted, created_at, updated_at)
         VALUES (?, ?, 'owner', 1, 1, 0, ?, ?)`,
      )
      .run('role-' + shopId, shopId, now, now);
    sqlite
      .prepare(
        `INSERT INTO users
           (id, shop_id, name, pin_hash, pin_set_at, role_id, is_active,
            is_dirty, is_deleted, created_at, updated_at)
         VALUES (?, ?, 'Owner', 'hash', ?, ?, 1, 1, 0, ?, ?)`,
      )
      .run('owner-' + shopId, shopId, now, 'role-' + shopId, now, now);
  }

  // purchases.supplier_id is NOT NULL with an FK, so the invoice needs one.
  sqlite
    .prepare(
      `INSERT INTO suppliers (id, shop_id, name, is_dirty, is_deleted, created_at, updated_at)
       VALUES ('supplier-1', ?, 'Example Distributor', 1, 0, ?, ?)`,
    )
    .run(SHOP, now, now);

  // THREE SCRIPTS, as a real shop's stock actually looks: one typed in Latin,
  // one typed in Bangla, one typed in Banglish.
  addMedicine('med-latin', 'Napa 500', 'Paracetamol');
  addMedicine('med-bangla', NAPA_BN, 'প্যারাসিটামল');
  addMedicine('med-banglish', 'Seclo', 'Omeprazole');
  // A second shop's row, so tenant isolation is tested against a non-empty
  // neighbour rather than vacuously.
  addMedicine('med-other-shop', 'Napa 500', 'Paracetamol', OTHER_SHOP);

  // A sale and a purchase that REFERENCE those medicines and batches, so
  // "nothing referencing a medicine was corrupted" has something to measure.
  sqlite
    .prepare(
      // Every column migration 0010's payment invariant checks. A sale that
      // did not satisfy it could not exist on a device, and a fixture the app
      // could not have produced proves nothing about the app.
      `INSERT INTO sales
         (id, shop_id, invoice_no, subtotal, discount_amount, total, paid, change,
          cash_applied, credit_amount, payment_type, staff_id,
          is_dirty, is_deleted, created_at, updated_at)
       VALUES ('sale-1', ?, 'INV-1', 200, 0, 200, 200, 0, 200, 0, 'cash', ?, 1, 0, ?, ?)`,
    )
    .run(SHOP, 'owner-' + SHOP, now, now);
  sqlite
    .prepare(
      `INSERT INTO sale_items
         (id, shop_id, sale_id, medicine_id, batch_id, qty, unit_price,
          line_total, cogs, is_dirty, is_deleted, created_at, updated_at)
       VALUES ('sale-item-1', ?, 'sale-1', 'med-latin', 'batch-med-latin', 1, 200, 200, 100, 1, 0, ?, ?)`,
    )
    .run(SHOP, now, now);
  sqlite
    .prepare(
      `INSERT INTO purchases
         (id, shop_id, invoice_no, supplier_id, total, payment_terms, paid_amount,
          is_dirty, is_deleted, created_at, updated_at)
       VALUES ('purchase-1', ?, 'PINV-1', 'supplier-1', 100, 'cash', 100, 1, 0, ?, ?)`,
    )
    .run(SHOP, now, now);
  sqlite
    .prepare(
      `INSERT INTO purchase_items
         (id, shop_id, purchase_id, medicine_id, batch_no, expiry_date, qty,
          purchase_price, sale_price, is_dirty, is_deleted, created_at, updated_at)
       VALUES ('purchase-item-1', ?, 'purchase-1', 'med-bangla', 'B-med-bangla', ?, 10, 10, 20, 1, 0, ?, ?)`,
    )
    .run(SHOP, EXPIRY, now, now);

  beforeUpgrade = inventorySnapshot();
  medicineCountBefore = scalar('SELECT COUNT(*) FROM medicines');

  // THE UPGRADE UNDER TEST.
  applyMigration('0033_medicine_search_key.sql');
});

describe('the upgrade from a populated pre-0033 schema', () => {
  it('preserves every medicine, batch, sale and purchase row', () => {
    // The whole point of the migration being an index rebuild and not a data
    // migration: the content table is untouched.
    expect(inventorySnapshot()).toBe(beforeUpgrade);
  });

  it('adds exactly one column, nullable, with every existing row NULL', () => {
    expect(columnsOf('medicines')).toContain('search_key');
    expect(scalar('SELECT COUNT(*) FROM medicines WHERE search_key IS NULL')).toBe(
      medicineCountBefore,
    );
  });

  it('duplicates no medicine', () => {
    expect(scalar('SELECT COUNT(*) FROM medicines')).toBe(medicineCountBefore);
    expect(scalar('SELECT COUNT(DISTINCT id) FROM medicines')).toBe(medicineCountBefore);
  });

  it('changes no stock figure', () => {
    // Stated separately from the snapshot because this is the one that would
    // cost a pharmacy money, and a snapshot comparison that drifted would stop
    // reporting it specifically.
    expect(scalar('SELECT SUM(stock) FROM batches')).toBe(40);
  });

  it('rebuilds the index, so a PRE-EXISTING row is findable by name again', () => {
    // The rebuild is what makes this pass. Without the final 'rebuild'
    // statement the index would be empty and this row would be unreachable.
    expect(matchedIds('"Seclo"*')).toContain('med-banglish');
  });

  it('carries the new column into the index definition', () => {
    // A three-column index. If the migration had kept the two-column one, the
    // folded query below would be a "no such column" error rather than a miss.
    expect(columnsOf('medicines_fts')).toEqual(['name', 'generic', 'search_key']);
  });

  it('keeps the three triggers, now carrying search_key', () => {
    const triggers = rows<{ name: string; sql: string }>(
      "SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'medicines' ORDER BY name",
    );

    expect(triggers.map((row) => row.name)).toEqual([
      'medicines_fts_delete',
      'medicines_fts_insert',
      'medicines_fts_update',
    ]);
    for (const trigger of triggers) {
      expect(trigger.sql, trigger.name + ' does not carry search_key').toContain('search_key');
    }
    // The delete half of the update trigger must use the OLD key, or the old
    // tokens stay in the index and the row keeps matching a stale term.
    const update = triggers.find((row) => row.name === 'medicines_fts_update');
    expect(update?.sql).toContain('old.`search_key`');
    expect(update?.sql).toContain('new.`search_key`');
  });
});

describe('the backfill', () => {
  it('is idempotent and reports completion', () => {
    const first = backfillMedicineSearchKeys();

    expect(first.updated).toBe(medicineCountBefore);
    expect(first.isComplete).toBe(true);
    expect(pendingSearchKeyCount()).toBe(0);

    // A second run reads ONE empty chunk and writes nothing.
    const second = backfillMedicineSearchKeys();
    expect(second.updated).toBe(0);
    expect(second.chunks).toBe(0);
    expect(second.isComplete).toBe(true);
  });

  it('folds by the SAME function the query folds by', () => {
    const row = sqlite.prepare('SELECT search_key FROM medicines WHERE id = ?').get('med-latin') as {
      search_key: string;
    };

    expect(row.search_key).toBe(medicineSearchKeys(['Napa 500', 'Paracetamol']));
  });

  it('gives a row that folds to nothing an empty key, not NULL', () => {
    // NULL would make every future run pick it up again, forever.
    //
    // Inserted WITHOUT a batch, deliberately: `inventory_movements` is an
    // append-only ledger that refuses a physical delete, so a batch here would
    // leave a movement row this test could not clean up — and a fixture that
    // grows between runs is a fixture that eventually explains a failure
    // nobody can reproduce.
    const now = '2026-10-01T00:00:00.000Z';
    sqlite
      .prepare(
        `INSERT INTO medicines
           (id, shop_id, name, generic, unit_of_measure, threshold,
            requires_prescription, is_dirty, is_deleted, created_at, updated_at)
         VALUES ('med-symbols', ?, '!!!', '???', 'piece', 20, 0, 1, 0, ?, ?)`,
      )
      .run(SHOP, now, now);

    backfillMedicineSearchKeys();

    const row = sqlite
      .prepare('SELECT search_key FROM medicines WHERE id = ?')
      .get('med-symbols') as { search_key: string | null };
    expect(row.search_key).toBe('');
    expect(pendingSearchKeyCount()).toBe(0);

    sqlite.exec("DELETE FROM medicines WHERE id = 'med-symbols'");
  });

  it('changes no inventory, sale or purchase row while it runs', () => {
    clearAllSearchKeys();
    const before = inventorySnapshot();

    backfillMedicineSearchKeys();

    expect(inventorySnapshot()).toBe(before);
  });

  it('rolls a failing chunk back WHOLE, leaving no partial key', () => {
    clearAllSearchKeys();
    const pendingBefore = pendingSearchKeyCount();
    expect(pendingBefore).toBeGreaterThan(1);

    // A fold that throws on the second row. The first row's UPDATE has already
    // been issued inside the transaction, so this is exactly the mid-chunk
    // failure the per-chunk transaction exists for.
    let calls = 0;
    expect(() =>
      backfillChunk(BACKFILL_CHUNK_SIZE, (values) => {
        calls += 1;
        if (calls === 2) throw new Error('fold failed');
        return medicineSearchKeys(values);
      }),
    ).toThrow('fold failed');

    // NOTHING committed: not even the first row, which had already been
    // updated when the throw happened.
    expect(pendingSearchKeyCount()).toBe(pendingBefore);
    expect(scalar('SELECT COUNT(*) FROM medicines WHERE search_key IS NOT NULL')).toBe(0);

    // And the next run completes normally — the failure is resumable.
    expect(backfillMedicineSearchKeys().isComplete).toBe(true);
  });

  it('resumes from where it stopped, leaving committed chunks committed', () => {
    clearAllSearchKeys();
    const total = pendingSearchKeyCount();

    // One chunk of one row, so the "some folded, some NULL" state is real.
    expect(backfillChunk(1)).toBe(1);
    expect(pendingSearchKeyCount()).toBe(total - 1);

    expect(backfillMedicineSearchKeys().isComplete).toBe(true);
  });
});

describe('the union query, FULLY BACKFILLED', () => {
  beforeAll(() => {
    clearAllSearchKeys();
    backfillMedicineSearchKeys();
  });

  it('finds a Bangla-named row from a LATIN query', () => {
    // The whole point of W2-03. Before this batch, "napa" could not reach নাপা.
    expect(matchedIds(union('napa'))).toContain('med-bangla');
  });

  it('finds a Latin-named row from a BANGLA query', () => {
    expect(matchedIds(union(NAPA_BN))).toContain('med-latin');
  });

  it('still finds an English name and generic exactly as before', () => {
    // The regression that matters most: W2-03 must not cost the English path.
    expect(matchedIds(union('Seclo'))).toContain('med-banglish');
    expect(matchedIds(union('Omeprazole'))).toContain('med-banglish');
  });
});

describe('the union query with search_key FORCED NULL', () => {
  beforeAll(() => {
    clearAllSearchKeys();
  });

  it('still finds a Bangla row from a BANGLA query, through the raw term', () => {
    // This is why the union is permanent. With no key, the folded half matches
    // nothing — and the raw half is what keeps the row reachable.
    expect(matchedIds(union(NAPA_BN))).toContain('med-bangla');
  });

  it('still finds an English row from an English query', () => {
    expect(matchedIds(union('Seclo'))).toContain('med-banglish');
  });

  it('does NOT reach the Bangla row from a Latin query — the honest limit', () => {
    // Stated as a test rather than left implied: with no folded key there is
    // nothing to match "napa" against, and the backfill is what fixes it. A
    // test claiming otherwise would be describing a feature that does not work
    // in this state.
    const found = matchedIds(union('napa'));

    expect(found).not.toContain('med-bangla');
    // And the Latin row is still found, so the query itself works.
    expect(found).toContain('med-latin');
  });
});

describe('both search paths, in both backfill states', () => {
  for (const state of ['backfilled', 'null-keys'] as const) {
    describe('with ' + state, () => {
      beforeAll(() => {
        clearAllSearchKeys();
        if (state === 'backfilled') backfillMedicineSearchKeys();
      });

      // A Latin query for a Bangla row needs the folded key, so it is only
      // expected in the backfilled state — the row above states that limit.
      const queries = state === 'backfilled' ? ['napa', NAPA_BN, 'Napa'] : [NAPA_BN, 'Napa'];

      it('the SALE path finds a row in every script it should', async () => {
        for (const query of queries) {
          const results = await searchMedicinesForSale(SHOP, query);
          expect(results.length, state + ' / sale / ' + query).toBeGreaterThan(0);
        }
      });

      it('the PURCHASE path finds a row in every script it should', async () => {
        for (const query of queries) {
          const results = await searchMedicinesForPurchase(SHOP, query);
          expect(results.length, state + ' / purchase / ' + query).toBeGreaterThan(0);
        }
      });

      it('never returns another shop’s medicine', async () => {
        // The search joins on `medicines_fts` and filters `m.shop_id` — and the
        // FTS index is shop-blind, so that filter is the ONLY thing standing
        // between one pharmacy and another's stock list. CLAUDE.md rule 7.
        const sale = await searchMedicinesForSale(SHOP, 'Napa');
        const purchase = await searchMedicinesForPurchase(SHOP, 'Napa');

        expect(sale.map((row) => row.medicineId)).not.toContain('med-other-shop');
        expect(purchase.map((row) => row.medicineId)).not.toContain('med-other-shop');
      });

      it('returns no duplicate medicine, although both halves can match', () => {
        // A row whose name AND folded key both match the expression is still
        // ONE row: the MATCH is a predicate, not a join multiplier. Worth
        // asserting, because a union implemented as two queries stitched
        // together would double it.
        const found = matchedIds(union('Napa'), SHOP);

        expect(found.length).toBe(new Set(found).size);
      });

      it('returns [] for a query with no terms, and issues no bad MATCH', async () => {
        // An empty MATCH expression is a SQLite syntax error, not a
        // match-everything, so the caller's guard is load-bearing.
        expect(await searchMedicinesForSale(SHOP, '   ')).toEqual([]);
        expect(await searchMedicinesForPurchase(SHOP, '')).toEqual([]);
      });
    });
  }
});

describe('a NEW or UPDATED medicine is searchable at once', () => {
  beforeAll(() => {
    clearAllSearchKeys();
    backfillMedicineSearchKeys();
  });

  it('an inserted row carrying a key is findable by a folded query immediately', () => {
    const now = '2026-10-02T00:00:00.000Z';
    db.insert(schema.medicines)
      .values({
        id: 'med-new',
        shopId: SHOP,
        name: 'Napa Extend',
        generic: 'Paracetamol',
        searchKey: medicineSearchKeys(['Napa Extend', 'Paracetamol']),
        unitOfMeasure: 'piece',
        createdAt: now,
        updatedAt: now,
      })
      .run();

    // Searched with a BANGLA query, which folds to `napa` and can only reach a
    // Latin-named row through the `search_key` column. The insert trigger
    // carried that key into the index with no rebuild — which is the claim.
    expect(matchedIds(union(NAPA_BN))).toContain('med-new');
  });

  it('records the fold’s OWN limit: Latin spelling variants do not converge', () => {
    // Found while writing this file, and recorded rather than hidden.
    //
    // @muthoy/utils' fold handles z/j, ph/f and doubled letters, and it
    // transliterates Bangla to Latin — so নাপা and "napa" converge, which is
    // the case W2-03 exists for. It does NOT fold `c` to `k`: "সেক্লো" becomes
    // "seklo" while "seclo" stays "seclo", so a shopkeeper who types the
    // English spelling with a `c` will not reach a row stored in Bangla.
    //
    // That is a gap in the FOLD (shipped by W2-02 and used by the national
    // catalogue), not in this migration — widening it would change the
    // catalogue's own index semantics and require a re-import, which is not
    // this batch's to do. Asserted here so the limit is a measured fact with a
    // failing test the day somebody fixes it.
    expect(medicineSearchKey('সেক্লো')).toBe('seklo');
    expect(medicineSearchKey('seclo')).toBe('seclo');
    expect(medicineSearchKey('সেক্লো')).not.toBe(medicineSearchKey('seclo'));

    // And the case that DOES converge, so this is a bounded limit rather than
    // a broken feature.
    expect(medicineSearchKey(NAPA_BN)).toBe(medicineSearchKey('napa'));
  });

  it('a RENAMED row stops matching its old name', () => {
    // The update trigger's 'delete' half must use the OLD values. If it used
    // the new ones the old tokens would stay in the index and this row would
    // still answer to "Seclo" after being renamed — a stale hit that looks
    // exactly like a correct one.
    sqlite
      .prepare('UPDATE medicines SET name = ?, search_key = ? WHERE id = ?')
      .run('Losectil', medicineSearchKeys(['Losectil', 'Omeprazole']), 'med-banglish');

    expect(matchedIds(union('Seclo'))).not.toContain('med-banglish');
    expect(matchedIds(union('Losectil'))).toContain('med-banglish');
  });

  it('a DELETED row stops matching at all', () => {
    // It was reachable a moment ago through the folded key, so this measures
    // the delete trigger rather than the absence of a match.
    expect(matchedIds(union(NAPA_BN))).toContain('med-new');

    // med-new was inserted with no batch, so the medicine row deletes alone.
    sqlite.exec("DELETE FROM medicines WHERE id = 'med-new'");

    expect(matchedIds(union(NAPA_BN))).not.toContain('med-new');
  });

  it('the index and the content table agree — integrity-check passes', () => {
    // fts5's own consistency check over the external-content index. This is
    // what would fail if a trigger wrote a key the content table does not hold.
    expect(() =>
      sqlite.exec("INSERT INTO medicines_fts(medicines_fts) VALUES('integrity-check')"),
    ).not.toThrow();
  });
});

describe('the search budget, offline', () => {
  beforeAll(() => {
    clearAllSearchKeys();
    backfillMedicineSearchKeys();
  });

  it('answers a folded query within an explicit budget', () => {
    // Not a benchmark — a ceiling. The union doubles the expression, and the
    // claim being defended is that it stays usable on a cheap Android device.
    // Generous on purpose: a CI machine under load is not a phone, and a tight
    // bound here would be a flaky test rather than a real guarantee.
    const match = union('napa');
    const statement = sqlite.prepare(
      `SELECT m.id FROM medicines_fts
         JOIN medicines AS m ON m.rowid = medicines_fts.rowid
        WHERE medicines_fts MATCH ? AND m.shop_id = ?`,
    );

    const started = Date.now();
    for (let run = 0; run < 50; run += 1) statement.all(match, SHOP);
    const elapsed = Date.now() - started;

    expect(elapsed).toBeLessThan(2_000);
  });
});
