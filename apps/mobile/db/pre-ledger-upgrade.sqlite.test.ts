// The UPGRADE path onto the ledger — the one every existing device takes, and
// the one nothing else in this suite covers.
//
// Every other SQLite test applies 0000 through 0006 before writing a row, so
// every batch it sees is born on the invariant. Real devices are not: they ran
// db/inventory.ts, which opened batches with `stock: input.quantity` and wrote
// NO movement at all, alongside purchases.ts and sales.ts, which wrote both an
// absolute AND a movement. So `stock` sits some non-zero gap above
// SUM(change_qty) the moment 0006's triggers arrive.
//
// Left unrepaired that gap is not a cosmetic drift — it is fatal. The update
// guard compares `OLD.stock + change_qty` against the ledger sum, and while the
// gap is in the way those can never be equal, so EVERY subsequent movement is
// rejected: no sale, no purchase, no return, not even the cloud's own backfill
// correction. The shop cannot sell the stock it already has.
//
// These tests apply 0000–0005 only, plant the four historical shapes by hand,
// then apply 0006 and prove the batch comes out the other side with its
// physical quantity intact and its ledger finally behind it.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { beforeAll, describe, expect, it } from 'vitest';
import { sqlite } from './test/expo-sqlite';

const { db } = await import('./client');
const { addStock, deductStock, ledgerSum } = await import('./stockLedger');
const { applyRemoteRows } = await import('./sync-helpers');

const MIGRATIONS = 'apps/mobile/db/migrations';
const BEFORE_LEDGER = [
  '0000_open_senator_kelly.sql',
  '0001_medicines_fts.sql',
  '0002_furry_celestials.sql',
  '0003_curious_wild_pack.sql',
  '0004_deep_boomer.sql',
  '0005_eminent_legion.sql',
];
const LEDGER = '0006_inventory_movement_ledger.sql';

function migrationSql(fileName: string): string {
  return readFileSync(resolve(MIGRATIONS, fileName), 'utf8');
}

const SHOP_ID = '7f3a91c2-4d5e-4b8a-9c1d-2e6f8a0b3c01';
const ROLE_ID = '7f3a91c2-4d5e-4b8a-9c1d-2e6f8a0b3c02';
const OWNER_ID = '7f3a91c2-4d5e-4b8a-9c1d-2e6f8a0b3c03';
const MEDICINE_ID = '7f3a91c2-4d5e-4b8a-9c1d-2e6f8a0b3c04';

/** A: opened with an absolute, no movement — what db/inventory.ts wrote. */
const BATCH_A = '7f3a91c2-4d5e-4b8a-9c1d-2e6f8a0b3caa';
/** B: opened with an absolute, then a purchase that wrote BOTH forms. */
const BATCH_B = '7f3a91c2-4d5e-4b8a-9c1d-2e6f8a0b3cbb';
/** C: soft-deleted, still holding a quantity. */
const BATCH_C = '7f3a91c2-4d5e-4b8a-9c1d-2e6f8a0b3ccc';
/** D: a partial ledger — some of its history recorded, some not. */
const BATCH_D = '7f3a91c2-4d5e-4b8a-9c1d-2e6f8a0b3cdd';
/** E: already on the invariant. Must be left completely alone. */
const BATCH_E = '7f3a91c2-4d5e-4b8a-9c1d-2e6f8a0b3cee';

/** The batch's updated_at before the upgrade, asserted unchanged after it. */
const HISTORICAL_STAMP = '2026-08-10T08:00:00.000Z';

/** What each batch physically held before 0006 ran. */
const PHYSICAL_STOCK: Record<string, number> = {
  [BATCH_A]: 10,
  [BATCH_B]: 14,
  [BATCH_C]: 7,
  [BATCH_D]: 9,
  [BATCH_E]: 6,
};

// ── the deterministic batch → backfill-movement id mapping ────────────────
//
// Reference implementation of the rule both migrations encode: take the
// batch's UUID and set the VERSION nibble — character 15, the one right after
// the third hyphen — to '8'. Written out here so a test can check the SQL
// against something other than itself.
function backfillMovementId(batchId: string): string {
  return `${batchId.slice(0, 14)}8${batchId.slice(15)}`;
}

interface HistoricalBatch {
  id: string;
  batchNo: string;
  stock: number;
  isDeleted?: boolean;
}

/**
 * Plants one batch the way the PRE-ledger code did: an absolute assigned
 * directly, with no movement behind it. Only possible before 0006 installs its
 * guards, which is exactly the point of applying the migrations in two halves.
 */
function seedHistoricalBatch(target: DatabaseSync, batch: HistoricalBatch): void {
  target.exec(
    `INSERT INTO batches (id, shop_id, medicine_id, batch_no, stock, purchase_price, sale_price, is_deleted, created_at, updated_at)
     VALUES ('${batch.id}', '${SHOP_ID}', '${MEDICINE_ID}', '${batch.batchNo}', ${batch.stock}, 10000, 15000,
             ${batch.isDeleted ? 1 : 0}, '${HISTORICAL_STAMP}', '${HISTORICAL_STAMP}')`,
  );
}

function seedHistoricalMovement(
  target: DatabaseSync,
  id: string,
  batchId: string,
  changeQty: number,
  reason = 'purchase',
): void {
  target.exec(
    `INSERT INTO inventory_movements (id, shop_id, batch_id, change_qty, reason, created_by, created_at, updated_at)
     VALUES ('${id}', '${SHOP_ID}', '${batchId}', ${changeQty}, '${reason}', '${OWNER_ID}',
             '${HISTORICAL_STAMP}', '${HISTORICAL_STAMP}')`,
  );
}

function seedShop(target: DatabaseSync, options: { withUser?: boolean } = {}): void {
  const { withUser = true } = options;
  target.exec(
    `INSERT INTO shops (id, owner_id, name, phone, plan, created_at, updated_at)
     VALUES ('${SHOP_ID}', '${OWNER_ID}', 'Upgrade Shop', '01700000904', 'free', '${HISTORICAL_STAMP}', '${HISTORICAL_STAMP}')`,
  );
  target.exec(
    `INSERT INTO roles (id, shop_id, name, is_system, created_at, updated_at)
     VALUES ('${ROLE_ID}', '${SHOP_ID}', 'owner', 1, '${HISTORICAL_STAMP}', '${HISTORICAL_STAMP}')`,
  );
  if (withUser) {
    target.exec(
      `INSERT INTO users (id, shop_id, role_id, name, phone, pin_hash, is_active, created_at, updated_at)
       VALUES ('${OWNER_ID}', '${SHOP_ID}', '${ROLE_ID}', 'Owner', '01700000904', 'hash', 1, '${HISTORICAL_STAMP}', '${HISTORICAL_STAMP}')`,
    );
  }
  target.exec(
    `INSERT INTO medicines (id, shop_id, name, unit_of_measure, threshold, created_at, updated_at)
     VALUES ('${MEDICINE_ID}', '${SHOP_ID}', 'Napa', 'piece', 10, '${HISTORICAL_STAMP}', '${HISTORICAL_STAMP}')`,
  );
}

/**
 * An isolated database on the old schema, for the cases that need their own
 * copy of the upgrade — a migration only runs once per database, so the
 * failure modes cannot share the suite's main one.
 */
function databaseBeforeTheLedger(): DatabaseSync {
  const target = new DatabaseSync(':memory:');
  target.exec('PRAGMA foreign_keys = ON;');
  for (const fileName of BEFORE_LEDGER) target.exec(migrationSql(fileName));
  return target;
}

function stockOf(batchId: string, target: DatabaseSync = sqlite): number {
  return (
    target.prepare('SELECT stock FROM batches WHERE id = ?').get(batchId) as { stock: number }
  ).stock;
}

function ledgerSumOf(batchId: string, target: DatabaseSync = sqlite): number {
  return (
    target
      .prepare('SELECT COALESCE(SUM(change_qty), 0) AS total FROM inventory_movements WHERE batch_id = ?')
      .get(batchId) as { total: number }
  ).total;
}

function syntheticMovementsFor(
  batchId: string,
  target: DatabaseSync = sqlite,
): { id: string; change_qty: number; created_by: string }[] {
  return target
    .prepare(
      `SELECT id, change_qty, created_by FROM inventory_movements WHERE batch_id = ? AND reason = 'adjustment'`,
    )
    .all(batchId) as { id: string; change_qty: number; created_by: string }[];
}

/**
 * The invariant across EVERY batch in the database, not a named one. Returns
 * how many it checked so a test can prove it was not satisfied vacuously.
 */
function everyBatchOnTheInvariant(target: DatabaseSync = sqlite): number {
  const rows = target
    .prepare(
      `SELECT b.id, b.stock, COALESCE((
         SELECT SUM(m.change_qty) FROM inventory_movements m WHERE m.batch_id = b.id
       ), 0) AS ledger FROM batches b`,
    )
    .all() as { id: string; stock: number; ledger: number }[];
  for (const row of rows) {
    expect(`${row.id} stock=${row.stock}`).toBe(`${row.id} stock=${row.ledger}`);
  }
  return rows.length;
}

beforeAll(() => {
  for (const fileName of BEFORE_LEDGER) sqlite.exec(migrationSql(fileName));
  seedShop(sqlite);

  // A — opened with an absolute and no movement whatsoever.
  seedHistoricalBatch(sqlite, { id: BATCH_A, batchNo: 'A', stock: 10 });

  // B — opened at 10 with no movement, then a purchase of 4 that wrote the new
  // absolute AND its movement, the way purchases.ts did. Gap is the opening.
  seedHistoricalBatch(sqlite, { id: BATCH_B, batchNo: 'B', stock: 10 });
  sqlite.exec(`UPDATE batches SET stock = stock + 4 WHERE id = '${BATCH_B}'`);
  seedHistoricalMovement(sqlite, '11111111-1111-4111-8111-111111111111', BATCH_B, 4);

  // C — soft-deleted, still holding stock. The old backfill skipped these.
  seedHistoricalBatch(sqlite, { id: BATCH_C, batchNo: 'C', stock: 7, isDeleted: true });

  // D — a partial ledger: 3 of its 9 recorded, 6 never were.
  seedHistoricalBatch(sqlite, { id: BATCH_D, batchNo: 'D', stock: 9 });
  seedHistoricalMovement(sqlite, '22222222-2222-4222-8222-222222222222', BATCH_D, 3);

  // E — already consistent. Nothing should touch it.
  seedHistoricalBatch(sqlite, { id: BATCH_E, batchNo: 'E', stock: 0 });
  seedHistoricalMovement(sqlite, '33333333-3333-4333-8333-333333333333', BATCH_E, 6);
  sqlite.exec(`UPDATE batches SET stock = 6 WHERE id = '${BATCH_E}'`);

  // THE UPGRADE.
  sqlite.exec(migrationSql(LEDGER));
  for (const fileName of [
    '0007_staff_device_login.sql',
    '0008_native_pin_lookup.sql',
    '0009_strong_gargoyle.sql',
    '0010_known_ares.sql',
  ]) sqlite.exec(migrationSql(fileName));
});

describe('the fixture really is pre-ledger data', () => {
  it('planted stock that no movement accounts for', () => {
    // Guards the guard: if a future edit made the seed go through the ledger,
    // every test below would pass while proving nothing about upgrading.
    expect(PHYSICAL_STOCK[BATCH_A]).toBe(10);
    expect(syntheticMovementsFor(BATCH_A)).toHaveLength(1);
    expect(syntheticMovementsFor(BATCH_A)[0]!.change_qty).toBe(10);
  });
});

describe('after the upgrade, every batch is on the invariant', () => {
  it('holds for every batch in the database, and the database is not empty', () => {
    expect(everyBatchOnTheInvariant()).toBe(5);
  });

  it.each([
    ['A, an absolute with no movement at all', BATCH_A],
    ['B, an absolute plus a later purchase movement', BATCH_B],
    ['C, a soft-deleted batch still holding stock', BATCH_C],
    ['D, a partial ledger', BATCH_D],
    ['E, already consistent before the upgrade', BATCH_E],
  ])('preserves the physical quantity of batch %s', (_label, batchId) => {
    expect(stockOf(batchId)).toBe(PHYSICAL_STOCK[batchId]);
    expect(ledgerSumOf(batchId)).toBe(PHYSICAL_STOCK[batchId]);
  });

  it('backfills the soft-deleted batch rather than skipping it', () => {
    // Skipping it would leave a row the guards can never afterwards repair:
    // correcting it later needs an absolute write, which they refuse outright.
    const row = sqlite.prepare('SELECT is_deleted FROM batches WHERE id = ?').get(BATCH_C) as {
      is_deleted: number;
    };
    expect(row.is_deleted).toBe(1);
    expect(syntheticMovementsFor(BATCH_C)).toHaveLength(1);
    expect(stockOf(BATCH_C)).toBe(7);
  });

  it.each([
    ['A', BATCH_A, 10],
    ['B', BATCH_B, 10],
    ['C', BATCH_C, 7],
    ['D', BATCH_D, 6],
  ])('writes exactly one synthetic movement for batch %s, carrying the gap', (_label, batchId, gap) => {
    const synthetic = syntheticMovementsFor(batchId);
    expect(synthetic).toHaveLength(1);
    expect(synthetic[0]!.change_qty).toBe(gap);
  });

  it('leaves a batch that was already consistent completely untouched', () => {
    expect(syntheticMovementsFor(BATCH_E)).toHaveLength(0);
    expect(
      sqlite.prepare('SELECT COUNT(*) AS n FROM inventory_movements WHERE batch_id = ?').get(BATCH_E),
    ).toEqual({ n: 1 });
  });

  it('does not disturb the batch timestamp last-write-wins depends on', () => {
    // The apply trigger sets batches.updated_at = the movement's created_at, so
    // the backfill feeds it the value already there. A repair of local history
    // must not look to sync like a fresh edit.
    const stamps = sqlite.prepare('SELECT DISTINCT updated_at AS at FROM batches').all() as { at: string }[];
    expect(stamps).toEqual([{ at: HISTORICAL_STAMP }]);
  });

  it('leaves no staging table behind', () => {
    const leftovers = sqlite
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '\\_ledger\\_%' ESCAPE '\\'`)
      .all();
    expect(leftovers).toEqual([]);
  });
});

describe('business writes work again after the upgrade', () => {
  it('accepts a sale against a batch that had no ledger before', () => {
    // Before the backfill this threw: OLD.stock + change_qty could never equal
    // the ledger sum while the gap sat between them.
    db.transaction((tx) => {
      deductStock(tx, {
        shopId: SHOP_ID,
        batchId: BATCH_A,
        quantity: 2,
        createdBy: OWNER_ID,
      });
    });
    expect(stockOf(BATCH_A)).toBe(8);
    expect(ledgerSumOf(BATCH_A)).toBe(8);
  });

  it('accepts a purchase against a batch whose ledger was only partial', () => {
    db.transaction((tx) => {
      addStock(tx, {
        shopId: SHOP_ID,
        batchId: BATCH_D,
        quantity: 5,
        reason: 'purchase',
        createdBy: OWNER_ID,
      });
    });
    expect(stockOf(BATCH_D)).toBe(14);
    expect(db.transaction((tx) => ledgerSum(tx, BATCH_D))).toBe(14);
  });

  it('still holds the invariant for every batch after real business writes', () => {
    expect(everyBatchOnTheInvariant()).toBe(5);
  });
});

describe('the cloud reconciles the same gap without doubling it', () => {
  it('derives the movement id from the batch id, not from a generator', () => {
    const synthetic = syntheticMovementsFor(BATCH_B);
    expect(synthetic[0]!.id).toBe(backfillMovementId(BATCH_B));
  });

  it('ignores the cloud copy of the synthetic movement, even with a newer timestamp', () => {
    // The hostile case. A same-or-older timestamp is absorbed by the
    // last-write-wins gate before it reaches the ledger, so it proves nothing;
    // a NEWER one passes that gate and has to be stopped by the primary key
    // alone. That is the whole reason the id is derived rather than generated:
    // with two different ids these deltas would BOTH apply and every
    // pre-existing batch in the install base would silently double.
    const before = stockOf(BATCH_B);
    applyRemoteRows([
      {
        tableName: 'inventory_movements',
        row: {
          id: backfillMovementId(BATCH_B),
          shop_id: SHOP_ID,
          batch_id: BATCH_B,
          change_qty: 10,
          reason: 'adjustment',
          ref_id: null,
          created_by: OWNER_ID,
          created_at: HISTORICAL_STAMP,
          updated_at: '2099-01-01T00:00:00.000Z',
          is_dirty: false,
          is_deleted: false,
          deleted_at: null,
          deleted_by: null,
        },
      },
    ]);
    expect(stockOf(BATCH_B)).toBe(before);
    expect(ledgerSumOf(BATCH_B)).toBe(before);
  });
});

describe('the deterministic batch → backfill-movement id mapping', () => {
  const KNOWN_BATCH = '7f3a91c2-4d5e-4b8a-9c1d-2e6f8a0b3c4d';
  const KNOWN_MOVEMENT = '7f3a91c2-4d5e-8b8a-9c1d-2e6f8a0b3c4d';

  it('maps a known batch id to a known movement id', () => {
    expect(backfillMovementId(KNOWN_BATCH)).toBe(KNOWN_MOVEMENT);
  });

  it('produces that same id from the SQL the SQLite migration actually runs', () => {
    const row = sqlite
      .prepare(`SELECT substr(?, 1, 14) || '8' || substr(?, 16) AS id`)
      .get(KNOWN_BATCH, KNOWN_BATCH) as { id: string };
    expect(row.id).toBe(KNOWN_MOVEMENT);
  });

  it('changes only the version nibble, so the map is one-to-one over v4 ids', () => {
    // Every id in this app comes from expo-crypto randomUUID, so version 4 is
    // the only input nibble — which makes the map injective — and no generated
    // id can ever collide with an output, because no v4 id carries version 8.
    const mapped = backfillMovementId(KNOWN_BATCH);
    expect(mapped[14]).toBe('8');
    expect(KNOWN_BATCH[14]).toBe('4');
    expect(mapped.slice(0, 14)).toBe(KNOWN_BATCH.slice(0, 14));
    expect(mapped.slice(15)).toBe(KNOWN_BATCH.slice(15));
    expect(mapped).toHaveLength(36);
  });

  it('is spelled the same way in both migrations', () => {
    // The two stores meet the same historical gap independently. If one of
    // these expressions is ever edited without the other, they mint different
    // ids, both deltas apply, and every upgraded batch doubles. Pin both.
    expect(migrationSql(LEDGER)).toContain(
      "substr(g.`batch_id`, 1, 14) || '8' || substr(g.`batch_id`, 16)",
    );
    expect(
      readFileSync(
        resolve('backend/supabase/migrations/20260818000000_inventory_movement_ledger.sql'),
        'utf8',
      ),
    ).toContain("overlay(v_batch.id::text placing '8' from 15 for 1)::uuid");
  });
});

describe('the migration refuses to finish in a broken state', () => {
  it('fails loudly when a gap belongs to a shop with no user to attribute it to', () => {
    // inventory_movements.created_by is NOT NULL REFERENCES users(id), so this
    // gap cannot be expressed as a movement at all. Skipping it silently is
    // what used to leave a permanently unrepairable batch behind.
    const target = databaseBeforeTheLedger();
    seedShop(target, { withUser: false });
    seedHistoricalBatch(target, { id: BATCH_A, batchNo: 'A', stock: 10 });

    expect(() => target.exec(migrationSql(LEDGER))).toThrow(
      /ledger_backfill_found_a_stock_gap_in_a_shop_with_no_user_to_attribute_it_to/,
    );
  });

  it('accepts a soft-deleted user as the actor, because the foreign key does', () => {
    // Attribution of a historical correction is a referential question, not a
    // question of who may currently log in. Excluding tombstoned users is
    // exactly what used to leave shops silently skipped.
    const target = databaseBeforeTheLedger();
    seedShop(target);
    target.exec(`UPDATE users SET is_deleted = 1 WHERE id = '${OWNER_ID}'`);
    seedHistoricalBatch(target, { id: BATCH_A, batchNo: 'A', stock: 10 });

    target.exec(migrationSql(LEDGER));

    expect(stockOf(BATCH_A, target)).toBe(10);
    expect(ledgerSumOf(BATCH_A, target)).toBe(10);
    expect(syntheticMovementsFor(BATCH_A, target)[0]!.created_by).toBe(OWNER_ID);
  });

  it('aborts rather than reporting success if a batch is left off the invariant', () => {
    // Negative control for the closing assertion: strip the repair itself —
    // both the rewind and the gap movement — and the migration must refuse. A
    // backfill that half-worked and said "done" is worse than one that
    // stopped, because the guards would then reject every write to the batches
    // it missed with nothing left to explain why. If this passes without the
    // assertion in place, the assertion is decorative.
    //
    // Worth knowing what the assertion does NOT catch: removing only the gap
    // movement, leaving the rewind, produces a database that is perfectly
    // self-consistent at a LOWER quantity — stock and ledger both 0 — and the
    // assertion passes it, correctly. It proves consistency, not that the
    // physical quantity survived. The `preserves the physical quantity` cases
    // above are what prove that half, and the two are only ever separable here
    // because this test forces them apart; in the migration the rewind and the
    // append are adjacent statements in one transaction.
    const target = databaseBeforeTheLedger();
    seedShop(target);
    seedHistoricalBatch(target, { id: BATCH_A, batchNo: 'A', stock: 10 });

    const withoutTheRepair = migrationSql(LEDGER)
      .replace(/UPDATE `batches`\r?\n\s+SET `stock` = COALESCE[\s\S]*?`_ledger_backfill_0006` WHERE `gap` <> 0\);/, 'SELECT 1;')
      .replace(/INSERT INTO `inventory_movements`\r?\n\s+\(`id`, `created_at`[\s\S]*?WHERE g\.`gap` <> 0;/, 'SELECT 1;');
    expect(withoutTheRepair).not.toContain('_ledger_backfill_0006` WHERE `gap` <> 0);');
    expect(withoutTheRepair).not.toContain("substr(g.`batch_id`, 1, 14) || '8'");

    expect(() => target.exec(withoutTheRepair)).toThrow(
      /ledger_backfill_left_a_batch_whose_stock_is_not_the_sum_of_its_movements/,
    );
  });
});

describe('the ledger is append-only against DELETE, not only UPDATE', () => {
  it('refuses to physically delete a movement', () => {
    // A deleted movement takes its delta out of the ledger and leaves it inside
    // batches.stock, and the apply trigger is INSERT-only so nothing subtracts
    // it back — the same silent divergence the UPDATE guard prevents, reached
    // through a different verb.
    expect(() => sqlite.exec(`DELETE FROM inventory_movements WHERE batch_id = '${BATCH_A}'`)).toThrow(
      /never physically deleted/,
    );
    expect(everyBatchOnTheInvariant()).toBe(5);
  });

  it('refuses even with foreign keys switched off', () => {
    // PRAGMA foreign_keys is per-CONNECTION and resets to OFF every time the
    // file is opened (db/client.ts), so a guard that only works while it
    // happens to be on is not a guard.
    sqlite.exec('PRAGMA foreign_keys = OFF');
    try {
      expect(() => sqlite.exec('DELETE FROM inventory_movements')).toThrow(/never physically deleted/);
    } finally {
      sqlite.exec('PRAGMA foreign_keys = ON');
    }
  });

  it('still allows the tombstone that sync actually uses', () => {
    // sync-helpers buildDeletePayload sets is_deleted/deleted_at/deleted_by,
    // and a tombstoned movement deliberately STAYS in the ledger sum: its
    // delta really happened, and the batch's stock still contains it.
    const before = ledgerSumOf(BATCH_E);
    sqlite.exec(
      `UPDATE inventory_movements SET is_deleted = 1, deleted_at = '${HISTORICAL_STAMP}' WHERE batch_id = '${BATCH_E}'`,
    );
    expect(ledgerSumOf(BATCH_E)).toBe(before);
    expect(stockOf(BATCH_E)).toBe(before);
  });
});
