#!/usr/bin/env node
// scripts/generate-history-fixture.mjs — H-11 C2.
//
// Builds a populated, UNENCRYPTED SQLite database that looks like a pharmacy
// that has been trading for a year, so the two things H-3 could not measure
// can finally be measured:
//
//   1. How long the plain -> SQLCipher migration takes at real scale. H-3's
//      sign-off measured 4.3-5.0 s for 249 rows / 811 KB on one low-end device
//      and recorded that a shop with a year of history had NOT been measured.
//   2. Whether the restore drill (backend/supabase/checks/restore_drill.md)
//      completes on a database that is not a toy.
//
// PRODUCTION-EQUIVALENT FINANCIAL GRAPH. The first version generated sales and
// movements only, which made it useless for the half of the drill that matters:
// a restore that loses a credit ledger, a payment allocation or a cash drawer
// row is a restore that loses money, and a fixture with none of those cannot
// detect it. This one writes the whole graph the real schema carries —
// suppliers, purchases and purchase items, batches created from them, cash,
// credit and split sales, the credit ledger, customer payments with their
// allocations, per-day cash drawer rows, expenses, and audit rows — with every
// foreign key pointing at a row that exists.
//
// Every invariant the product depends on is produced the way the app produces
// it, and then CHECKED before the file is reported as usable:
//   - batches.stock is never written directly; it is driven entirely by
//     inventory_movements through migration 0006's trigger.
//   - money is integer paisa everywhere, never a float.
//   - sale payment arithmetic satisfies migration 0010's validation trigger.
//   - a credit's balance equals its amount minus its allocations.
//   - sales carry an explicit Asia/Dhaka business_date.
//
// It writes ONLY to the path given as --out, and REFUSES to run if that path
// exists. It contains no delete call, so it cannot be pointed at a real shop
// database by accident. Nothing in the app imports it, deliberately.
//
// Usage:
//   node scripts/generate-history-fixture.mjs --out ./history.db
//   node scripts/generate-history-fixture.mjs --out ./history.db --days 365 \
//        --sales-per-day 40 --medicines 600 --seed 7

import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const MIGRATIONS_DIR = resolve('apps/mobile/db/migrations');
const DHAKA_OFFSET_MINUTES = 6 * 60;

function parseArgs(argv) {
  const options = { out: null, days: 365, salesPerDay: 40, medicines: 600, seed: 1 };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    switch (flag) {
      case '--out': options.out = value; i += 1; break;
      case '--days': options.days = Number(value); i += 1; break;
      case '--sales-per-day': options.salesPerDay = Number(value); i += 1; break;
      case '--medicines': options.medicines = Number(value); i += 1; break;
      case '--seed': options.seed = Number(value); i += 1; break;
      default: throw new Error(`Unknown argument: ${flag}`);
    }
  }
  if (!options.out) throw new Error('--out <path> is required');
  for (const key of ['days', 'salesPerDay', 'medicines', 'seed']) {
    if (!Number.isInteger(options[key]) || options[key] < 0) {
      throw new Error(`--${key} must be a non-negative integer`);
    }
  }
  return options;
}

/** Deterministic: a fixture that differs between runs cannot be compared. */
function makeRandom(seed) {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function applyMigrations(db) {
  const journal = JSON.parse(readFileSync(resolve(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf8'));
  for (const entry of journal.entries) {
    const sql = readFileSync(resolve(MIGRATIONS_DIR, `${entry.tag}.sql`), 'utf8');
    for (const statement of sql.split('--> statement-breakpoint')) {
      const trimmed = statement.trim();
      if (trimmed) db.exec(trimmed);
    }
  }
  recordMigrationMetadata(db, journal);
  return journal.entries.length;
}

/**
 * Drizzle's own bookkeeping, written the way the INSTALLED migrator reads it.
 *
 * Without this the fixture cannot serve restore_drill.md step 19. The SQL above
 * creates all 56 tables but leaves no `__drizzle_migrations` row, and
 * `apps/mobile/db/init.ts:88` runs `migrate(db, migrations)` on every boot. The
 * migrator (drizzle-orm/sqlite-core/dialect.cjs:672-679) reads ONLY the newest
 * row:
 *
 *     SELECT id, hash, created_at FROM __drizzle_migrations
 *       ORDER BY created_at DESC LIMIT 1
 *
 * and re-applies a migration when
 *
 *     !lastDbMigration || Number(lastDbMigration[2]) < migration.folderMillis
 *
 * where `folderMillis` is the journal entry's `when`
 * (drizzle-orm/expo-sqlite/migrator.cjs:40). With no row, every migration
 * re-runs against a database that already has every table, so the app dies on
 * the first CREATE TABLE instead of booting.
 *
 * Two properties of that predicate, read from the installed code rather than
 * assumed:
 *
 *   - `hash` is NOT NULL so it must be written, but it is never consulted for
 *     the skip decision. **The app itself writes the empty string** —
 *     `drizzle-orm/expo-sqlite/migrator.cjs:42` builds every migration with
 *     `hash: ""` — so that is what a real
 *     device's rows contain, and that is what is written here. An earlier
 *     revision put a sha256 of the migration SQL in this column; it was valid
 *     but made the fixture differ from every real device for no benefit, since
 *     nothing reads it.
 *   - ONE row suffices, carrying the journal's greatest `when`.
 *
 * The journal's `when` values must be strictly unique, and this refuses to run
 * if they are not. The whole one-row scheme rests on an unambiguous maximum: if
 * two entries shared a timestamp, the newer one's `folderMillis` would not be
 * strictly greater than the recorded `created_at`, the migrator would skip it,
 * and the fixture would silently lack that migration's schema.
 *
 * WHAT THIS DELIBERATELY IS NOT. A real device has 34 rows with 34 real hashes
 * and timestamps. This is one row, sufficient for the skip decision and nothing
 * else. It is not a reconstructed upgrade history, and a future drill needing
 * one must say so explicitly. `apps/mobile/db/encryptionVerify.ts:175` compares
 * these rows across the encryption copy, which stays self-consistent either way
 * because both sides are the same file.
 *
 * The DDL is copied verbatim from the migrator so its own
 * CREATE TABLE IF NOT EXISTS is a no-op rather than a conflicting definition.
 */
function recordMigrationMetadata(db, journal) {
  const newest = newestJournalEntry(journal);
  // BYTE-IDENTICAL to the migrator's own DDL (dialect.cjs:665-670), including
  // its indentation, so `sqlite_master.sql` matches a database the migrator
  // created and the fixture's bookkeeping schema can be compared against a real
  // reference instead of being excluded from comparison. SQLite stores the
  // statement with `IF NOT EXISTS` and leading whitespace removed, which is why
  // the two agree despite that clause. Do not reformat this string.
  db.exec(
    'CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (\n'
    + '\t\t\t\tid SERIAL PRIMARY KEY,\n'
    + '\t\t\t\thash text NOT NULL,\n'
    + '\t\t\t\tcreated_at numeric\n'
    + '\t\t\t)',
  );
  // Column list and values exactly as the migrator's own insert
  // (dialect.cjs:686): ("hash", "created_at"), so `id` is left NULL as it is on
  // a real device, and `hash` is the empty string the app writes.
  db.prepare('INSERT INTO `__drizzle_migrations` (`hash`, `created_at`) VALUES (?, ?)')
    .run('', newest.when);
  return { tag: newest.tag, when: newest.when };
}

/**
 * The journal's newest entry, refusing every input that would make the one-row
 * scheme unsound rather than guessing.
 */
export function newestJournalEntry(journal) {
  if (!Array.isArray(journal.entries) || journal.entries.length === 0) {
    throw new Error('migration journal has no entries; refusing to write bookkeeping');
  }
  for (const entry of journal.entries) {
    if (!Number.isSafeInteger(entry.when)) {
      throw new Error(
        `journal entry ${entry.tag} has a "when" that is not a safe integer: ${entry.when}`,
      );
    }
  }
  const seen = new Map();
  for (const entry of journal.entries) {
    if (seen.has(entry.when)) {
      throw new Error(
        `journal entries ${seen.get(entry.when)} and ${entry.tag} share "when" ${entry.when}. `
        + 'The fixture records a single newest timestamp, and the migrator re-applies only '
        + 'when created_at < when, so a tie would make one of these migrations skip and the '
        + 'fixture would silently lack its schema.',
      );
    }
    seen.set(entry.when, entry.tag);
  }
  return journal.entries.reduce((a, b) => (b.when > a.when ? b : a));
}

/**
 * Does the fixture's recorded metadata still match the migrations that exist
 * NOW? This is the check that rejects a STALE ARTIFACT, and it is deliberately
 * separate from the generator: a fixture file written weeks ago is still on
 * disk, still passes every SQL invariant, and is still used by the drill — but
 * once a new migration lands, its recorded `created_at` is no longer the
 * journal maximum and the app would re-apply migrations onto tables that
 * already exist.
 *
 * Returns the failures rather than throwing so it reads like the SQL
 * invariants alongside it.
 */
function migrationMetadataFailures(db) {
  const present = db.prepare(
    "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'",
  ).get();
  if (Number(present?.n ?? 0) === 0) {
    return ['__drizzle_migrations is absent, so the app would re-apply every migration on boot'];
  }
  const row = db.prepare(
    'SELECT `created_at`, typeof(`created_at`) AS storage FROM `__drizzle_migrations` '
    + 'ORDER BY `created_at` DESC LIMIT 1',
  ).get();
  if (!row) {
    return ['__drizzle_migrations exists but is empty, so the app would re-apply every migration'];
  }
  // The migrator does Number(created_at). Anything but an integer risks NaN, or
  // text sorting above numbers in the ORDER BY and hiding the real newest row.
  if (row.storage !== 'integer') {
    return [
      `__drizzle_migrations.created_at is stored as ${row.storage}, not integer; `
      + 'the migrator coerces it with Number() and would compare against NaN',
    ];
  }
  const journal = JSON.parse(readFileSync(resolve(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf8'));
  const newest = newestJournalEntry(journal);
  const recorded = Number(row.created_at);
  // The migrator's own predicate (dialect.cjs:679), applied to every migration.
  const reapplied = journal.entries.filter((entry) => recorded < entry.when);
  if (reapplied.length > 0) {
    return [
      `migration metadata is stale: created_at ${recorded} is older than `
      + `${reapplied.length} migration(s) (${reapplied.map((e) => e.tag).join(', ')}), `
      + 'so the installed migrator would re-apply them against a database that already '
      + 'has their tables and the app would fail to boot',
    ];
  }
  if (recorded !== newest.when) {
    return [
      `migration metadata records created_at ${recorded}, which is not the journal maximum `
      + `${newest.when} (${newest.tag})`,
    ];
  }
  return [];
}

/** Asia/Dhaka calendar date for an instant, matching migration 0024's rule. */
function businessDate(instant) {
  return new Date(instant.getTime() + DHAKA_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);
}

function idFactory(prefix) {
  let counter = 0;
  return () => {
    counter += 1;
    return `${prefix}-${String(counter).padStart(8, '0')}`;
  };
}

/**
 * Every invariant the generated file must satisfy, expressed as SQL that
 * returns the OFFENDING rows. Each must return zero.
 *
 * This is the difference between a fixture and a pile of rows. A drill run
 * against a file that already violates the ledger or the credit ledger cannot
 * tell a restore failure from a fixture failure.
 */
// Synthetic single-device fixture only: no later deletions or pulled backdated rows
// are modeled. This validates generated snapshots, not arbitrary restored history.
// Independent, time-bounded refund oracle. Deliberately does not reuse the
// generator's SQL aggregate or the drawer's later closing_expected value.
function refundDrawerPayloadFailures(db) {
  const failed = [];
  for (const q of db.prepare("SELECT * FROM sync_queue WHERE operation_kind='refund' AND table_name='cash_drawer'").all()) {
    const refund = db.prepare('SELECT * FROM sale_refunds WHERE id=?').get(q.operation_group_id);
    const drawer = db.prepare('SELECT * FROM cash_drawer WHERE id=?').get(q.row_id);
    let payload;
    try { payload = JSON.parse(q.payload); } catch { failed.push(q); continue; }
    const keys = db.prepare('PRAGMA table_info(cash_drawer)').all().map(column => column.name).sort();
    if (!refund || !drawer || q.shop_id !== refund.shop_id || drawer.shop_id !== refund.shop_id
      || drawer.business_date !== refund.business_date || q.op !== 'update'
      || !payload || Array.isArray(payload) || Object.keys(payload).sort().join(',') !== keys.join(',')
      || payload.id !== q.row_id || payload.shop_id !== q.shop_id || payload.business_date !== refund.business_date
      || payload.is_dirty !== true || payload.is_deleted !== false
      || payload.closed_at !== null || payload.closed_by !== null || payload.closing_counted !== null
      || payload.opening_cash !== drawer.opening_cash || payload.created_at !== drawer.created_at
      || !Number.isFinite(Date.parse(payload.updated_at))
      || Date.parse(payload.updated_at) < Date.parse(refund.created_at)
      || (drawer.closed_at && Date.parse(payload.updated_at) > Date.parse(drawer.closed_at))
      || !Number.isSafeInteger(payload.closing_expected)) { failed.push(q); continue; }
    const eligible = (row) => row.shop_id === refund.shop_id && !row.is_deleted
      && Date.parse(row.created_at) <= Date.parse(payload.updated_at)
      && businessDate(new Date(row.created_at)) === refund.business_date;
    let expected = payload.opening_cash;
    for (const row of db.prepare('SELECT * FROM sales').all().filter(eligible)) expected += row.cash_applied;
    for (const row of db.prepare('SELECT * FROM payments').all().filter(eligible)) {
      if (row.method !== 'cash') continue;
      if (row.type === 'customer_payment') expected += row.amount;
      if (row.type === 'supplier_payment' || row.type === 'withdrawal') expected -= row.amount;
    }
    for (const row of db.prepare('SELECT * FROM expenses').all().filter(eligible)) expected -= row.amount;
    for (const row of db.prepare('SELECT * FROM refund_tenders').all().filter(eligible)) {
      if (row.kind === 'cash' || (row.kind === 'collection_refund' && row.method === 'cash')) expected -= row.amount;
    }
    for (const row of db.prepare('SELECT * FROM sales_returns').all().filter(eligible)) {
      if (row.refund_id === null && row.refund_method === 'cash') expected -= row.refund_amount;
    }
    if (payload.closing_expected !== expected) failed.push(q);
  }
  return failed;
}

export const INVARIANTS = [
{ name: 'refund operation payload preserves refund-time drawer projection', check: refundDrawerPayloadFailures },
// Fixture batch costs never change after sales. Current cost therefore equals
// original cost here; this invariant is not valid for repriced production batches.
{ name: 'sale line COGS equals quantity times original batch cost', sql: 'SELECT i.id FROM sale_items i JOIN batches b ON b.id=i.batch_id WHERE i.cogs<>i.qty*b.purchase_price' },
{ name: 'sale line total equals quantity times unit price minus line discount', sql: 'SELECT id FROM sale_items WHERE line_total<>qty*unit_price-discount_amount' },
{"name":"customer return movement quantities match return rows","sql":"WITH expected AS (\n SELECT r.shop_id,COALESCE(r.refund_id,r.id) ref_id,i.batch_id,SUM(r.qty) qty FROM sales_returns r JOIN sale_items i ON i.id=r.sale_item_id GROUP BY r.shop_id,COALESCE(r.refund_id,r.id),i.batch_id\n) SELECT e.ref_id id FROM expected e WHERE e.qty<>COALESCE((SELECT SUM(m.change_qty) FROM inventory_movements m WHERE m.shop_id=e.shop_id AND m.batch_id=e.batch_id AND m.ref_id=e.ref_id AND m.reason='return'),0)"},
{"name":"supplier return movement quantities match purchase return rows","sql":"SELECT r.id FROM purchase_returns r JOIN purchase_items i ON i.id=r.purchase_item_id JOIN batches b ON b.shop_id=r.shop_id AND b.medicine_id=i.medicine_id AND b.batch_no=i.batch_no AND b.expiry_date=i.expiry_date WHERE r.purchase_id<>i.purchase_id OR r.credit_amount<>r.qty*i.purchase_price OR -r.qty<>COALESCE((SELECT SUM(m.change_qty) FROM inventory_movements m WHERE m.shop_id=r.shop_id AND m.batch_id=b.id AND m.ref_id=r.id AND m.reason='return'),0)"},
{"name":"refund tenders exactly reconcile their full sale","sql":"SELECT r.id FROM sale_refunds r JOIN sales s ON s.id=r.sale_id WHERE r.shop_id<>s.shop_id OR r.total_amount<>s.total OR r.total_amount<>COALESCE((SELECT SUM(t.amount) FROM refund_tenders t WHERE t.refund_id=r.id AND t.is_deleted=0),0)"},
{"name":"refund return quantities and identities match original items","sql":"SELECT r.id FROM sales_returns r JOIN sale_items i ON i.id=r.sale_item_id WHERE r.sale_id<>i.sale_id OR r.shop_id<>i.shop_id OR r.qty<=0 OR r.qty>i.qty OR (r.refund_id IS NOT NULL AND (r.qty<>i.qty OR r.refund_amount<>i.line_total))"},
{"name":"refund tenders preserve shop and collection identities","sql":"SELECT t.id FROM refund_tenders t LEFT JOIN sale_refunds r ON r.id=t.refund_id LEFT JOIN payments p ON p.id=t.source_payment_id WHERE r.id IS NULL OR r.shop_id<>t.shop_id OR t.amount<0 OR (t.kind='collection_refund' AND (p.id IS NULL OR p.shop_id<>t.shop_id OR p.type<>'customer_payment' OR p.method<>t.method))"},
{"name":"operation groups retain complete unique ordered members","sql":"SELECT operation_group_id id FROM sync_queue WHERE operation_group_id IS NOT NULL GROUP BY shop_id,operation_group_id HAVING COUNT(*)<>MAX(operation_expected_count) OR MIN(operation_expected_count)<>MAX(operation_expected_count) OR COUNT(DISTINCT operation_sequence)<>COUNT(*) OR MIN(operation_sequence)<>0 OR MAX(operation_sequence)<>COUNT(*)-1"},
{"name":"sale movements have negative quantities and valid same-shop parents","sql":"SELECT m.id FROM inventory_movements m\nLEFT JOIN sales s ON s.id=m.ref_id LEFT JOIN batches b ON b.id=m.batch_id\nWHERE m.reason='sale' AND (m.change_qty>=0 OR s.id IS NULL OR b.id IS NULL OR m.shop_id<>s.shop_id OR m.shop_id<>b.shop_id)"},
{"name":"sale items preserve sale batch medicine and shop identities","sql":"SELECT i.id FROM sale_items i LEFT JOIN sales s ON s.id=i.sale_id LEFT JOIN batches b ON b.id=i.batch_id LEFT JOIN medicines med ON med.id=i.medicine_id\nWHERE s.id IS NULL OR b.id IS NULL OR med.id IS NULL OR i.qty<=0 OR i.shop_id<>s.shop_id OR i.shop_id<>b.shop_id OR i.shop_id<>med.shop_id OR i.medicine_id<>b.medicine_id"},
{"name":"sale movement quantities independently match sale items in both directions","sql":"WITH expected AS (\n SELECT shop_id,sale_id,batch_id,SUM(qty) qty FROM sale_items GROUP BY shop_id,sale_id,batch_id\n), actual AS (\n SELECT shop_id,ref_id sale_id,batch_id,-SUM(change_qty) qty FROM inventory_movements WHERE reason='sale' GROUP BY shop_id,ref_id,batch_id\n)\nSELECT e.sale_id id FROM expected e LEFT JOIN actual a USING(shop_id,sale_id,batch_id) WHERE a.qty IS NULL OR a.qty<>e.qty\nUNION ALL\nSELECT a.sale_id id FROM actual a LEFT JOIN expected e USING(shop_id,sale_id,batch_id) WHERE e.qty IS NULL"},
  {
    name: 'batches.stock equals the sum of its movements',
    sql: 'SELECT b.id FROM `batches` b WHERE b.`stock` <> COALESCE('
      + '(SELECT SUM(m.`change_qty`) FROM `inventory_movements` m WHERE m.`batch_id` = b.`id`), 0)',
  },
  {
    name: 'no batch is oversold without being flagged',
    sql: 'SELECT id FROM `batches` WHERE `stock` < 0 AND `oversold_at` IS NULL',
  },
  {
    name: 'sale totals equal subtotal minus discount',
    sql: 'SELECT id FROM `sales` WHERE `total` <> `subtotal` - `discount_amount`',
  },
  {
    name: 'sale cash and credit split sums to the total',
    sql: 'SELECT id FROM `sales` WHERE `cash_applied` + `credit_amount` <> `total`',
  },
  {
    name: 'sale line totals sum to the sale subtotal',
    sql: 'SELECT s.id FROM `sales` s WHERE s.`subtotal` <> COALESCE('
      + '(SELECT SUM(i.`line_total`) FROM `sale_items` i WHERE i.`sale_id` = s.`id`), 0)',
  },
  {
    name: 'every credit matches the credit amount of its sale',
    sql: 'SELECT c.id FROM `credits` c JOIN `sales` s ON s.`id` = c.`sale_id` '
      + 'WHERE c.`amount` <> s.`credit_amount`',
  },
  {
    name: 'credit balance equals amount minus allocations and refunded cancellation',
    sql: 'SELECT c.id FROM `credits` c WHERE c.`balance` <> c.`amount` - COALESCE('
      + '(SELECT SUM(a.`amount`) FROM `credit_payment_allocations` a WHERE a.`credit_id` = c.`id`), 0) - COALESCE('
      + "(SELECT SUM(t.amount) FROM refund_tenders t JOIN sale_refunds r ON r.id=t.refund_id WHERE r.sale_id=c.sale_id AND r.shop_id=c.shop_id AND t.kind='credit_cancel' AND t.is_deleted=0),0)",
  },
  {
    name: 'no credit balance is negative or above its amount',
    sql: 'SELECT id FROM `credits` WHERE `balance` < 0 OR `balance` > `amount`',
  },
  {
    name: 'allocations never exceed their payment',
    sql: 'SELECT p.id FROM `payments` p WHERE COALESCE('
      + '(SELECT SUM(a.`amount`) FROM `credit_payment_allocations` a WHERE a.`payment_id` = p.`id`), 0) > p.`amount`',
  },
  {
    name: 'customer payments are fully represented by allocations',
    sql: "SELECT p.id FROM `payments` p WHERE p.`type` = 'customer_payment' AND p.`amount` <> COALESCE("
      + '(SELECT SUM(a.`amount`) FROM `credit_payment_allocations` a WHERE a.`payment_id` = p.`id`), 0)',
  },
  {
    name: 'allocations point at a credit of the same customer',
    sql: 'SELECT a.id FROM `credit_payment_allocations` a JOIN `credits` c ON c.`id` = a.`credit_id` '
      + 'WHERE a.`customer_id` <> c.`customer_id`',
  },
  {
    name: 'purchases are never overpaid',
    sql: 'SELECT id FROM `purchases` WHERE `paid_amount` < 0 OR `paid_amount` > `total`',
  },
  {
    name: 'purchase totals equal the sum of their received lines',
    sql: 'SELECT p.id FROM `purchases` p WHERE p.`total` <> COALESCE('
      + '(SELECT SUM(i.`qty` * i.`purchase_price`) FROM `purchase_items` i WHERE i.`purchase_id` = p.`id`), 0)',
  },
  {
    name: 'supplier payments link to a real purchase for the same supplier',
    sql: "SELECT pay.id FROM `payments` pay LEFT JOIN `purchases` p ON p.`id` = pay.`ref_id` "
      + "WHERE pay.`type` = 'supplier_payment' AND (p.`id` IS NULL OR p.`supplier_id` <> pay.`party_id`)",
  },
  {
    name: 'purchase paid amount equals linked supplier payments',
    sql: 'SELECT p.id FROM `purchases` p WHERE p.`paid_amount` <> COALESCE('
      + "(SELECT SUM(pay.`amount`) FROM `payments` pay WHERE pay.`type` = 'supplier_payment' "
      + "AND pay.`ref_id` = p.`id` AND pay.`is_deleted` = 0), 0)",
  },
  {
    name: 'expense detail has one matching expense payment',
    sql: 'SELECT e.id FROM `expenses` e WHERE e.`amount` <> COALESCE('
      + "(SELECT SUM(pay.`amount`) FROM `payments` pay WHERE pay.`type` = 'expense' "
      + "AND pay.`ref_id` = e.`id` AND pay.`is_deleted` = 0), 0)",
  },
  {
    name: 'one cash drawer row per shop per business date',
    sql: 'SELECT `business_date` FROM `cash_drawer` GROUP BY `shop_id`, `business_date` HAVING COUNT(*) > 1',
  },
  {
    name: 'cash drawer close uses the complete production cash equation',
    sql: 'SELECT d.id FROM `cash_drawer` d WHERE d.`closing_expected` <> d.`opening_cash` '
      + '+ COALESCE((SELECT SUM(s.`cash_applied`) FROM `sales` s WHERE s.`shop_id`=d.`shop_id` '
      + "AND s.`is_deleted`=0 AND date(s.`created_at`, '+06:00')=d.`business_date`),0) "
      + '+ COALESCE((SELECT SUM(pay.`amount`) FROM `payments` pay WHERE pay.`shop_id`=d.`shop_id` '
      + "AND pay.`type`='customer_payment' AND pay.`method`='cash' AND pay.`is_deleted`=0 "
      + "AND date(pay.`created_at`, '+06:00')=d.`business_date`),0) "
      + '- COALESCE((SELECT SUM(e.`amount`) FROM `expenses` e WHERE e.`shop_id`=d.`shop_id` '
      + "AND e.`is_deleted`=0 AND date(e.`created_at`, '+06:00')=d.`business_date`),0) "
      + '- COALESCE((SELECT SUM(pay.`amount`) FROM `payments` pay WHERE pay.`shop_id`=d.`shop_id` '
      + "AND pay.`type`='supplier_payment' AND pay.`method`='cash' AND pay.`is_deleted`=0 "
      + "AND date(pay.`created_at`, '+06:00')=d.`business_date`),0) "
      + '- COALESCE((SELECT SUM(pay.`amount`) FROM `payments` pay WHERE pay.`shop_id`=d.`shop_id` '
      + "AND pay.`type`='withdrawal' AND pay.`method`='cash' AND pay.`is_deleted`=0 "
      + "AND date(pay.`created_at`, '+06:00')=d.`business_date`),0) "
      + '- COALESCE((SELECT SUM(t.`amount`) FROM `refund_tenders` t WHERE t.`shop_id`=d.`shop_id` '
      + "AND (t.`kind`='cash' OR (t.`kind`='collection_refund' AND t.`method`='cash')) "
      + "AND t.`is_deleted`=0 AND date(t.`created_at`, '+06:00')=d.`business_date`),0) "
      + '- COALESCE((SELECT SUM(r.`refund_amount`) FROM `sales_returns` r WHERE r.`shop_id`=d.`shop_id` '
      + "AND r.`refund_id` IS NULL AND r.`refund_method`='cash' AND r.`is_deleted`=0 "
      + "AND date(r.`created_at`, '+06:00')=d.`business_date`),0)",
  },
  {
    name: 'no negative money anywhere it is impossible',
    sql: 'SELECT id FROM `sales` WHERE `total` < 0 OR `cash_applied` < 0 OR `credit_amount` < 0 '
      + 'UNION ALL SELECT id FROM `payments` WHERE `amount` < 0 '
      + 'UNION ALL SELECT id FROM `expenses` WHERE `amount` < 0 '
      + 'UNION ALL SELECT id FROM `cash_drawer` WHERE `opening_cash` < 0',
  },
];

function historyInvariantFailures(db) {
  return INVARIANTS.flatMap(invariant => {
    const offenders = invariant.check ? invariant.check(db) : db.prepare(invariant.sql).all();
    return offenders.length ? [{ name: invariant.name, count: offenders.length }] : [];
  });
}

export function failingHistoryInvariantNames(db) {
  return historyInvariantFailures(db).map(failure => failure.name);
}

export function validateHistoryFixture(db) {
  const failures = historyInvariantFailures(db)
    .map(failure => `${failure.name}: ${failure.count} offending row(s)`);
  // Not a SQL invariant, because it compares the file against the migrations
  // that exist on disk right now rather than against itself.
  failures.push(...migrationMetadataFailures(db));
  if (failures.length > 0) {
    throw new Error(`Fixture is invalid:\n  - ${failures.join('\n  - ')}`);
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const outPath = resolve(options.out);
  if (existsSync(outPath)) {
    throw new Error(`${outPath} already exists. Choose another --out path.`);
  }
  mkdirSync(dirname(outPath), { recursive: true });

  const random = makeRandom(options.seed);
  const db = new DatabaseSync(outPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');

  const startedAt = Date.now();
  const migrationCount = applyMigrations(db);

  const nextId = {
    medicine: idFactory('med'), batch: idFactory('bat'), movement: idFactory('mov'),
    sale: idFactory('sal'), saleItem: idFactory('sit'), expense: idFactory('exp'),
    customer: idFactory('cus'), supplier: idFactory('sup'), purchase: idFactory('pur'),
    purchaseItem: idFactory('pit'), credit: idFactory('crd'), payment: idFactory('pay'),
    allocation: idFactory('alo'), drawer: idFactory('drw'), audit: idFactory('aud'),
  };

  const shopId = 'shop-history-fixture';
  const ownerId = 'user-owner';
  const staffId = 'user-staff';
  const now = new Date();
  // Anchor each generated day at Asia/Dhaka midnight. Adding 8-20 hours below
  // must remain on that business date; anchoring at the current wall-clock
  // time makes late-day rows spill into tomorrow and falsifies cash close.
  const todayDhaka = businessDate(now);
  const firstDay = new Date(
    new Date(`${todayDhaka}T00:00:00+06:00`).getTime()
      - options.days * 24 * 60 * 60 * 1000,
  );
  const iso = (value) => value.toISOString();

  const insert = (table, row) => {
    const columns = Object.keys(row);
    const sql = `INSERT INTO \`${table}\` (${columns.map((c) => `\`${c}\``).join(', ')}) `
      + `VALUES (${columns.map(() => '?').join(', ')})`;
    db.prepare(sql).run(...columns.map((c) => row[c]));
  };

  const base = (createdAt) => ({
    created_at: createdAt, updated_at: createdAt,
    // Synced history, not an outbox backlog: a shop a year old has pushed.
    is_dirty: 0, is_deleted: 0,
  });

  const audit = (createdAt, action, target) => {
    insert('audit_logs', {
      id: nextId.audit(), ...base(createdAt), shop_id: shopId,
      actor_id: ownerId, action, target, meta: null,
    });
  };

  db.exec('BEGIN');

  insert('shops', {
    id: shopId, ...base(iso(firstDay)), owner_id: ownerId,
    name: 'History Fixture Pharmacy', phone: '+8801712000001', plan: 'free',
  });
  for (const [roleId, name] of [['role-owner', 'owner'], ['role-manager', 'manager'], ['role-staff', 'staff']]) {
    insert('roles', { id: roleId, ...base(iso(firstDay)), shop_id: shopId, name, is_system: 1 });
  }
  insert('shop_b2_settings', { id: 'settings-1', ...base(iso(firstDay)), shop_id: shopId });

  // A bcrypt hash of a value no 4-digit PIN can equal. This fixture is never a
  // real shop, and no PIN it would accept exists.
  const inertPinHash = '$2b$10$orrIQmGHjWZq8S.W0sHN/OtwZonfF.hpvxleIR9TlFHSBxIaFcByO';
  insert('users', {
    id: ownerId, ...base(iso(firstDay)), shop_id: shopId, name: 'Fixture Owner',
    phone: '+8801712000001', pin_hash: inertPinHash, role_id: 'role-owner', is_active: 1,
  });
  insert('users', {
    id: staffId, ...base(iso(firstDay)), shop_id: shopId, name: 'Fixture Staff',
    phone: '+8801712000002', pin_hash: inertPinHash, role_id: 'role-staff', is_active: 1,
  });
  audit(iso(firstDay), 'shop_created', shopId);

  const suppliers = [];
  for (let i = 0; i < 12; i += 1) {
    const id = nextId.supplier();
    suppliers.push(id);
    insert('suppliers', {
      id, ...base(iso(firstDay)), shop_id: shopId,
      name: `Supplier ${i + 1}`, phone: `+8801713${String(100000 + i).slice(-6)}`,
      manufacturer: `Manufacturer ${i % 40}`,
    });
  }

  const customers = [];
  for (let i = 0; i < Math.max(1, Math.round(options.medicines / 20)); i += 1) {
    const id = nextId.customer();
    customers.push(id);
    insert('customers', {
      id, ...base(iso(firstDay)), shop_id: shopId,
      name: `Customer ${i + 1}`, phone: `+88017120${String(10000 + i).slice(-5)}`,
    });
  }

  // Stock arrives the way it does in the shop: a supplier invoice, its lines,
  // and a batch plus an opening movement per received line. Nothing invents a
  // batch out of nowhere, so purchase totals and stock agree by construction.
  const batches = [];
  const medicinesPerPurchase = 25;
  let purchaseCount = 0;
  for (let i = 0; i < options.medicines; i += 1) {
    const medicineId = nextId.medicine();
    insert('medicines', {
      id: medicineId, ...base(iso(firstDay)), shop_id: shopId,
      name: `Medicine ${i + 1}`, generic: `Generic ${i % 120}`,
      manufacturer: `Manufacturer ${i % 40}`, unit_of_measure: 'piece',
    });

    if (i % medicinesPerPurchase === 0) purchaseCount += 1;
    const purchaseId = `pur-${String(purchaseCount).padStart(8, '0')}`;
    if (i % medicinesPerPurchase === 0) {
      insert('purchases', {
        id: purchaseId, ...base(iso(firstDay)), shop_id: shopId,
        invoice_no: `PINV-${String(purchaseCount).padStart(5, '0')}`,
        supplier_id: suppliers[purchaseCount % suppliers.length],
        // Filled in once its lines are known; the invariant check below proves
        // the two agree.
        total: 0, payment_terms: purchaseCount % 3 === 0 ? 'cod' : 'credit',
        paid_amount: 0, invoice_date: businessDate(firstDay),
      });
      nextId.purchase();
    }

    for (let b = 0; b < 2; b += 1) {
      const batchId = nextId.batch();
      const purchasePrice = 500 + Math.floor(random() * 4_000);
      const salePrice = purchasePrice + 100 + Math.floor(random() * 1_500);
      const expiry = new Date(now.getTime() + (30 + Math.floor(random() * 700)) * 24 * 60 * 60 * 1000);
      const batchNo = `B${i + 1}-${b + 1}`;
      const opening = 200 + Math.floor(random() * 400);

      insert('purchase_items', {
        id: nextId.purchaseItem(), ...base(iso(firstDay)), shop_id: shopId,
        purchase_id: purchaseId, medicine_id: medicineId, batch_no: batchNo,
        expiry_date: iso(expiry).slice(0, 10), qty: opening,
        purchase_price: purchasePrice, sale_price: salePrice,
        status: 'received', received_at: iso(firstDay),
      });
      insert('batches', {
        id: batchId, ...base(iso(firstDay)), shop_id: shopId, medicine_id: medicineId,
        batch_no: batchNo, expiry_date: iso(expiry).slice(0, 10),
        // Never written directly — the opening movement below sets it.
        stock: 0, purchase_price: purchasePrice, sale_price: salePrice,
      });
      insert('inventory_movements', {
        id: nextId.movement(), ...base(iso(firstDay)), shop_id: shopId, batch_id: batchId,
        change_qty: opening, reason: 'purchase', ref_id: purchaseId, created_by: ownerId,
      });
      batches.push({ batchId, medicineId, salePrice, purchasePrice });
    }
  }

  // Now the invoice totals can be derived from the lines that exist.
  db.exec(
    'UPDATE `purchases` SET `total` = COALESCE((SELECT SUM(i.`qty` * i.`purchase_price`) '
    + 'FROM `purchase_items` i WHERE i.`purchase_id` = `purchases`.`id`), 0)',
  );
  const purchaseLedger = db.prepare(
    'SELECT `id`, `supplier_id`, `total` FROM `purchases` ORDER BY `id`',
  ).all();


  // Fixed graph supplements scale-dependent history. Never used as app seed.
  // Includes a collected-credit refund, legacy return and supplier return.
  const seedAcceptanceGraph = (at, date) => {
    let stamp = iso(at);
    const refundStamp = stamp;
    const batch = batches[0];
    const remember = [];
    const add = (table, row, op = 'insert') => {
      insert(table, row);
      const snapshot = db.prepare('SELECT * FROM ' + table + ' WHERE id=?').get(row.id);
      remember.push({ table, row: { ...snapshot, is_dirty: true }, op });
    };
    for (const [name, qty, cash, credit] of [
      ['collected', 3, 1000, 2000], ['legacy', 2, 2000, 0],
    ]) {
      const saleId = 'accept-sale-' + name;
      insert('sales', { id: saleId, ...base(stamp), shop_id: shopId,
        invoice_no: 'ACCEPT-' + name, subtotal: qty * 1000, discount_amount: 0,
        total: qty * 1000, paid: cash, change: 0, cash_applied: cash,
        credit_amount: credit, payment_type: credit ? 'split' : 'cash',
        customer_id: credit ? customers[0] : null, staff_id: ownerId, business_date: date });
      insert('sale_items', { id: 'accept-item-' + name, ...base(stamp), shop_id: shopId,
        sale_id: saleId, medicine_id: batch.medicineId, batch_id: batch.batchId,
        qty, unit_price: 1000, discount_amount: 0, line_total: qty * 1000,
        cogs: qty * batch.purchasePrice });
      insert('inventory_movements', { id: 'accept-sale-movement-' + name, ...base(stamp),
        shop_id: shopId, batch_id: batch.batchId, change_qty: -qty, reason: 'sale',
        ref_id: saleId, created_by: ownerId });
    }
    insert('credits', { id: 'accept-credit', ...base(stamp), shop_id: shopId,
      sale_id: 'accept-sale-collected', customer_id: customers[0], amount: 2000, balance: 0 });
    insert('payments', { id: 'accept-collection', ...base(stamp), shop_id: shopId,
      type: 'customer_payment', party_id: customers[0], amount: 700,
      method: 'cash', created_by: ownerId });
    insert('credit_payment_allocations', { id: 'accept-allocation', ...base(stamp),
      shop_id: shopId, customer_id: customers[0], payment_id: 'accept-collection',
      credit_id: 'accept-credit', amount: 700 });
    add('sale_refunds', { id: 'accept-refund', ...base(stamp), shop_id: shopId,
      sale_id: 'accept-sale-collected', claim_id: 'synthetic-claim',
      claim_token: 'synthetic-token-not-a-credential', reason: 'Synthetic full-sale return',
      total_amount: 3000, business_date: date, created_by: ownerId });
    add('sales_returns', { id: 'accept-full-return', ...base(stamp), shop_id: shopId,
      sale_id: 'accept-sale-collected', sale_item_id: 'accept-item-collected',
      refund_id: 'accept-refund', qty: 3, refund_amount: 3000, refund_method: 'cash',
      reason: 'Synthetic full-sale return', created_by: ownerId });
    add('inventory_movements', { id: 'accept-refund-movement', ...base(stamp),
      shop_id: shopId, batch_id: batch.batchId, change_qty: 3, reason: 'return',
      ref_id: 'accept-refund', created_by: ownerId });
    for (const [kind, amount, method, source] of [
      ['cash', 1000, 'cash', null], ['credit_cancel', 1300, null, null],
      ['collection_refund', 700, 'cash', 'accept-collection'],
    ]) {
      add('refund_tenders', { id: 'accept-tender-' + kind, ...base(stamp), shop_id: shopId,
        refund_id: 'accept-refund', kind, amount, method, source_payment_id: source });
    }
    // Production refunds retain original credit amount and allocations.
    remember.push({ table: 'credits', row: { ...db.prepare("SELECT * FROM credits WHERE id='accept-credit'").get(), is_dirty: true }, op: 'update' });
    add('audit_logs', { id: 'accept-refund-audit', ...base(stamp), shop_id: shopId,
      actor_id: ownerId, action: 'sale_refunded', target: 'accept-sale-collected',
      meta: JSON.stringify({ operationId: 'accept-refund', reason: 'Synthetic full-sale return' }) });
    const drawer = db.prepare('SELECT id,opening_cash FROM cash_drawer WHERE shop_id=? AND business_date=?').get(shopId, date);
    // Snapshot at the actual refund operation, before later fixture events/close.
    // All rows currently inserted belong to this day and are no later than stamp.
    const cash = db.prepare(`SELECT ?
      + COALESCE((SELECT SUM(cash_applied) FROM sales WHERE shop_id=? AND business_date=? AND is_deleted=0),0)
      + COALESCE((SELECT SUM(amount) FROM payments WHERE shop_id=? AND type='customer_payment' AND method='cash' AND date(created_at,'+06:00')=? AND is_deleted=0),0)
      - COALESCE((SELECT SUM(amount) FROM expenses WHERE shop_id=? AND date(created_at,'+06:00')=? AND is_deleted=0),0)
      - COALESCE((SELECT SUM(amount) FROM payments WHERE shop_id=? AND type IN ('supplier_payment','withdrawal') AND method='cash' AND date(created_at,'+06:00')=? AND is_deleted=0),0)
      - COALESCE((SELECT SUM(amount) FROM refund_tenders WHERE shop_id=? AND (kind='cash' OR (kind='collection_refund' AND method='cash')) AND date(created_at,'+06:00')=? AND is_deleted=0),0)
      - COALESCE((SELECT SUM(refund_amount) FROM sales_returns WHERE shop_id=? AND refund_id IS NULL AND refund_method='cash' AND date(created_at,'+06:00')=? AND is_deleted=0),0) expected`)
      .get(drawer.opening_cash,shopId,date,shopId,date,shopId,date,shopId,date,shopId,date,shopId,date);
    remember.push({ table: 'cash_drawer', rowId: drawer.id,
      row: { ...db.prepare('SELECT * FROM cash_drawer WHERE id=?').get(drawer.id), closing_expected: Number(cash.expected), is_dirty: true, updated_at: stamp }, op: 'update' });
    // Later operations must not overwrite this already-sent refund snapshot.
    stamp = iso(new Date(at.getTime() + 1000));

    insert('sales_returns', { id: 'accept-legacy-return', ...base(stamp), shop_id: shopId,
      sale_id: 'accept-sale-legacy', sale_item_id: 'accept-item-legacy', refund_id: null,
      qty: 1, refund_amount: 1000, refund_method: 'cash',
      reason: 'Synthetic legacy return', created_by: ownerId });
    insert('inventory_movements', { id: 'accept-legacy-movement', ...base(stamp),
      shop_id: shopId, batch_id: batch.batchId, change_qty: 1, reason: 'return',
      ref_id: 'accept-legacy-return', created_by: ownerId });
    const receipt = db.prepare('SELECT * FROM purchase_items ORDER BY id LIMIT 1').get();
    insert('purchase_returns', { id: 'accept-purchase-return', ...base(stamp), shop_id: shopId,
      purchase_id: receipt.purchase_id, purchase_item_id: receipt.id, qty: 1,
      credit_amount: receipt.purchase_price, reason: 'Synthetic supplier return', created_by: ownerId });
    insert('inventory_movements', { id: 'accept-purchase-return-movement', ...base(stamp),
      shop_id: shopId, batch_id: batch.batchId, change_qty: -1, reason: 'return',
      ref_id: 'accept-purchase-return', created_by: ownerId });
    const local = { id: batch.medicineId, shop_id: shopId, name: 'Fixture local name', updated_at: stamp };
    const remote = { ...local, name: 'Fixture remote name' };
    insert('conflict_queue', { id: 'accept-conflict', shop_id: shopId, table_name: 'medicines',
      row_id: batch.medicineId, local_value: JSON.stringify(local), remote_value: JSON.stringify(remote),
      reason: 'pull_local_pending', created_at: stamp, updated_at: stamp,
      local_updated_at: stamp, remote_updated_at: stamp, detected_by: ownerId });
    insert('sync_queue', { id: 'accept-sent-superseded', shop_id: shopId, table_name: 'medicines',
      row_id: batch.medicineId, op: 'update', payload: JSON.stringify(local),
      created_at: stamp, seq: 100, status: 'sent' });

    for (const [name, cash, credit] of [['cash', 1000, 0], ['credit', 0, 2000]]) {
      const total = cash + credit;
      const qty = total / 1000;
      const saleId = 'accept-sale-' + name;
      const refundId = 'accept-refund-' + name;
      insert('sales', { id: saleId, ...base(stamp), shop_id: shopId,
        invoice_no: 'ACCEPT-' + name, subtotal: total, discount_amount: 0,
        total, paid: cash, change: 0, cash_applied: cash, credit_amount: credit,
        payment_type: credit ? 'credit' : 'cash', customer_id: credit ? customers[0] : null,
        staff_id: ownerId, business_date: date });
      insert('sale_items', { id: 'accept-item-' + name, ...base(stamp), shop_id: shopId,
        sale_id: saleId, medicine_id: batch.medicineId, batch_id: batch.batchId,
        qty, unit_price: 1000, discount_amount: 0, line_total: total, cogs: batch.purchasePrice * qty });
      insert('inventory_movements', { id: 'accept-sale-movement-' + name, ...base(stamp), shop_id: shopId,
        batch_id: batch.batchId, change_qty: -qty, reason: 'sale', ref_id: saleId, created_by: ownerId });
      if (credit) insert('credits', { id: 'accept-credit-' + name, ...base(stamp), shop_id: shopId,
        customer_id: customers[0], sale_id: saleId, amount: credit, balance: 0 });
      insert('sale_refunds', { id: refundId, ...base(stamp), shop_id: shopId, sale_id: saleId,
        claim_id: 'synthetic-' + name, claim_token: 'synthetic-not-a-credential', reason: 'Synthetic return',
        total_amount: total, business_date: date, created_by: ownerId });
      insert('sales_returns', { id: 'accept-return-' + name, ...base(stamp), shop_id: shopId,
        sale_id: saleId, sale_item_id: 'accept-item-' + name, refund_id: refundId, qty,
        refund_amount: total, refund_method: credit ? 'credit_note' : 'cash',
        reason: 'Synthetic return', created_by: ownerId });
      insert('inventory_movements', { id: 'accept-return-movement-' + name, ...base(stamp),
        shop_id: shopId, batch_id: batch.batchId, change_qty: qty, reason: 'return',
        ref_id: refundId, created_by: ownerId });
      insert('refund_tenders', { id: 'accept-tender-' + name + '-full', ...base(stamp),
        shop_id: shopId, refund_id: refundId, kind: credit ? 'credit_cancel' : 'cash',
        method: credit ? null : 'cash', amount: total });
    }
    // Supplier credit: 1000 paid, 400 returned, then 600 received with only
    // 200 cash. FIFO consumes exactly 400; no fake cash credit payment exists.
    insert('suppliers', { id: 'accept-supplier', ...base(stamp), shop_id: shopId, name: 'Synthetic credit supplier' });
    for (const [name, qty, total, paid] of [['old', 10, 1000, 1000], ['new', 6, 600, 200]]) {
      const purchaseId = 'accept-purchase-' + name;
      insert('purchases', { id: purchaseId, ...base(stamp), shop_id: shopId,
        invoice_no: 'ACCEPT-PUR-' + name, supplier_id: 'accept-supplier',
        total, payment_terms: 'cod', paid_amount: paid, invoice_date: date });
      insert('purchase_items', { id: 'accept-purchase-item-' + name, ...base(stamp), shop_id: shopId,
        purchase_id: purchaseId, medicine_id: batch.medicineId, batch_no: 'ACCEPT-' + name,
        expiry_date: '2030-12-31', qty, purchase_price: 100, sale_price: 200,
        status: 'received', received_at: stamp });
      insert('batches', { id: 'accept-batch-' + name, ...base(stamp), shop_id: shopId,
        medicine_id: batch.medicineId, batch_no: 'ACCEPT-' + name, expiry_date: '2030-12-31',
        stock: 0, purchase_price: 100, sale_price: 200 });
      insert('inventory_movements', { id: 'accept-purchase-movement-' + name, ...base(stamp), shop_id: shopId,
        batch_id: 'accept-batch-' + name, change_qty: qty, reason: 'purchase',
        ref_id: purchaseId, created_by: ownerId });
      insert('payments', { id: 'accept-supplier-payment-' + name, ...base(stamp), shop_id: shopId,
        type: 'supplier_payment', party_id: 'accept-supplier', amount: paid,
        method: 'cash', ref_id: purchaseId, created_by: ownerId });
    }
    insert('purchase_returns', { id: 'accept-credit-return', ...base(stamp), shop_id: shopId,
      purchase_id: 'accept-purchase-old', purchase_item_id: 'accept-purchase-item-old',
      qty: 4, credit_amount: 400, reason: 'Synthetic supplier credit', created_by: ownerId });
    insert('inventory_movements', { id: 'accept-credit-return-movement', ...base(stamp), shop_id: shopId,
      batch_id: 'accept-batch-old', change_qty: -4, reason: 'return',
      ref_id: 'accept-credit-return', created_by: ownerId });
    insert('conflict_queue', { id: 'accept-resolved-conflict', shop_id: shopId,
      table_name: 'medicines', row_id: batch.medicineId, local_value: JSON.stringify(local),
      remote_value: JSON.stringify(remote), resolved: 1, resolution: 'keep_remote',
      resolved_at: stamp, created_at: stamp, updated_at: stamp,
      superseded_payloads: JSON.stringify([{ id: 'accept-superseded-pending', seq: 101,
        op: 'update', payload: JSON.stringify(local) }]) });

    // A complete, already-sent refund operation: no pending app work.
    remember.forEach(({ table, row, op, rowId = row.id }, sequence) => {
      insert('sync_queue', { id: 'accept-group-' + sequence, shop_id: shopId,
        table_name: table, row_id: rowId, op, payload: JSON.stringify(Object.fromEntries(Object.entries(row).map(([key, value]) => [key, key.startsWith('is_') && (value === 0 || value === 1) ? Boolean(value) : value]))),
        created_at: refundStamp, seq: sequence + 1, status: 'sent',
        operation_group_id: 'accept-refund', operation_kind: 'refund',
        operation_sequence: sequence, operation_expected_count: remember.length });
    });
  };

  const openCredits = [];
  let invoiceCounter = 0;
  for (let day = 0; day < options.days; day += 1) {
    const dayStart = new Date(firstDay.getTime() + day * 24 * 60 * 60 * 1000);
    const date = businessDate(dayStart);

    // Opening cash resets daily and is never inherited (CLAUDE.md rule 5);
    // the fixture writes a fresh drawer row per business date.
    insert('cash_drawer', {
      id: nextId.drawer(), ...base(iso(dayStart)), shop_id: shopId,
      business_date: date, opening_cash: 0, opened_by: ownerId,
      opened_at: iso(dayStart),
    });

    for (let s = 0; s < options.salesPerDay; s += 1) {
      const at = new Date(dayStart.getTime() + (8 + Math.floor(random() * 12)) * 3_600_000);
      const createdAt = iso(at);
      const saleId = nextId.sale();
      const lineCount = 1 + Math.floor(random() * 4);
      const lines = [];
      let subtotal = 0;
      for (let l = 0; l < lineCount; l += 1) {
        const batch = batches[Math.floor(random() * batches.length)];
        const qty = 1 + Math.floor(random() * 3);
        const lineTotal = batch.salePrice * qty;
        subtotal += lineTotal;
        lines.push({ batch, qty, lineTotal });
      }

      // Three payment shapes, because migration 0010's validation trigger
      // enforces different arithmetic for each and a fixture that only ever
      // writes cash never exercises two thirds of it.
      const roll = random();
      const kind = roll < 0.12 ? 'credit' : roll < 0.2 ? 'split' : 'cash';
      const cashApplied = kind === 'cash' ? subtotal : kind === 'split' ? Math.max(1, Math.floor(subtotal / 2)) : 0;
      const creditAmount = subtotal - cashApplied;
      const customerId = kind === 'cash' ? null : customers[Math.floor(random() * customers.length)];

      invoiceCounter += 1;
      insert('sales', {
        id: saleId, ...base(createdAt), shop_id: shopId,
        invoice_no: `INV-${String(invoiceCounter).padStart(7, '0')}`,
        total: subtotal, paid: cashApplied, change: 0,
        payment_type: kind, customer_id: customerId,
        staff_id: random() < 0.5 ? ownerId : staffId,
        business_date: date, subtotal, discount_amount: 0,
        cash_applied: cashApplied, credit_amount: creditAmount,
      });
      for (const line of lines) {
        insert('sale_items', {
          id: nextId.saleItem(), ...base(createdAt), shop_id: shopId, sale_id: saleId,
          medicine_id: line.batch.medicineId, batch_id: line.batch.batchId,
          qty: line.qty, unit_price: line.batch.salePrice, discount_amount: 0,
          line_total: line.lineTotal, cogs: line.batch.purchasePrice * line.qty,
        });
        insert('inventory_movements', {
          id: nextId.movement(), ...base(createdAt), shop_id: shopId,
          batch_id: line.batch.batchId, change_qty: -line.qty, reason: 'sale',
          ref_id: saleId, created_by: ownerId,
        });
      }

      if (creditAmount > 0 && customerId) {
        const creditId = nextId.credit();
        insert('credits', {
          id: creditId, ...base(createdAt), shop_id: shopId, customer_id: customerId,
          sale_id: saleId, amount: creditAmount, balance: creditAmount,
        });
        openCredits.push({ creditId, customerId, balance: creditAmount });
      }
    }

    // Collections: a customer pays, the payment is ALLOCATED against their
    // oldest open credits (FIFO, as db/customers.ts does), and each credit's
    // balance drops by exactly what was allocated to it. Partial collections
    // are the common case and are what the balance invariant is guarding.
    if (day % 3 === 0 && openCredits.length > 0) {
      const collectAt = iso(new Date(dayStart.getTime() + 17 * 3_600_000));
      const target = openCredits[Math.floor(random() * openCredits.length)];
      const settled = random() < 0.5;
      const amount = settled ? target.balance : Math.max(1, Math.floor(target.balance / 2));
      if (amount > 0) {
        const paymentId = nextId.payment();
        insert('payments', {
          id: paymentId, ...base(collectAt), shop_id: shopId,
          type: 'customer_payment', party_id: target.customerId, amount,
          method: 'cash', ref_id: null, created_by: ownerId, note: null,
        });
        insert('credit_payment_allocations', {
          id: nextId.allocation(), ...base(collectAt), shop_id: shopId,
          customer_id: target.customerId, payment_id: paymentId,
          credit_id: target.creditId, amount,
        });
        db.prepare('UPDATE `credits` SET `balance` = `balance` - ? WHERE `id` = ?')
          .run(amount, target.creditId);
        target.balance -= amount;
        if (target.balance === 0) {
          openCredits.splice(openCredits.indexOf(target), 1);
        }
        audit(collectAt, 'credit_collected', target.customerId);
      }
    }

    // A supplier payment every fortnight, so the payable derivation has both
    // sides of its ledger.
    if (day % 14 === 0 && purchaseLedger.length > 0) {
      const payAt = iso(new Date(dayStart.getTime() + 18 * 3_600_000));
      const paymentIndex = Math.floor(day / 14);
      const purchase = purchaseLedger[paymentIndex % purchaseLedger.length];
      const currentPaid = Number(db.prepare('SELECT `paid_amount` FROM `purchases` WHERE `id` = ?')
        .get(purchase.id).paid_amount);
      const remaining = Number(purchase.total) - currentPaid;
      const amount = paymentIndex % 2 === 0 ? remaining : Math.max(1, Math.floor(remaining / 2));
      insert('payments', {
        id: nextId.payment(), ...base(payAt), shop_id: shopId,
        type: 'supplier_payment', party_id: purchase.supplier_id,
        amount, method: 'cash', ref_id: purchase.id, created_by: ownerId, note: null,
      });
      db.prepare('UPDATE `purchases` SET `paid_amount` = `paid_amount` + ? WHERE `id` = ?')
        .run(amount, purchase.id);
    }

    if (day % 7 === 0) {
      const expenseId = nextId.expense();
      const expenseAmount = 50_000 + Math.floor(random() * 100_000);
      insert('expenses', {
        id: expenseId, ...base(iso(dayStart)), shop_id: shopId,
        // Canonical taxonomy from migration 0018; anything else is rewritten
        // by that migration's triggers and the fixture would drift.
        category: 'utilities', amount: expenseAmount,
        description: 'Weekly utilities', created_by: ownerId,
      });
      insert('payments', {
        id: nextId.payment(), ...base(iso(dayStart)), shop_id: shopId,
        type: 'expense', party_id: null, amount: expenseAmount, method: 'cash',
        ref_id: expenseId, created_by: ownerId, note: null,
      });
    }

    if (day % 10 === 5) {
      insert('payments', {
        id: nextId.payment(), ...base(iso(new Date(dayStart.getTime() + 19 * 3_600_000))),
        shop_id: shopId, type: 'withdrawal', party_id: null, amount: 10_000,
        method: 'cash', ref_id: null, created_by: ownerId, note: 'Fixture bank deposit',
      });
    }

    if (day === options.days - 1) seedAcceptanceGraph(new Date(dayStart.getTime() + 19 * 3_600_000 + 60_000), date);

    // Closing the day is what makes the drawer row reconcilable, and a
    // reconciled day is the one shape the restore drill compares against.
    const closedAt = iso(new Date(dayStart.getTime() + 20 * 3_600_000));
    const cash = db.prepare(
      'SELECT '
      + 'COALESCE((SELECT `opening_cash` FROM `cash_drawer` WHERE `shop_id`=? AND `business_date`=?),0) '
      + '+ COALESCE((SELECT SUM(`cash_applied`) FROM `sales` WHERE `shop_id`=? AND `business_date`=? AND `is_deleted`=0),0) '
      + "+ COALESCE((SELECT SUM(`amount`) FROM `payments` WHERE `shop_id`=? AND `type`='customer_payment' AND `method`='cash' AND date(`created_at`, '+06:00')=? AND `is_deleted`=0),0) "
      + '- COALESCE((SELECT SUM(`amount`) FROM `expenses` WHERE `shop_id`=? AND date(`created_at`, \'+06:00\')=? AND `is_deleted`=0),0) '
      + "- COALESCE((SELECT SUM(`amount`) FROM `payments` WHERE `shop_id`=? AND `type` IN ('supplier_payment','withdrawal') AND `method`='cash' AND date(`created_at`, '+06:00')=? AND `is_deleted`=0),0) "
      + "- COALESCE((SELECT SUM(amount) FROM refund_tenders WHERE shop_id=? AND (kind='cash' OR (kind='collection_refund' AND method='cash')) AND is_deleted=0 AND date(created_at, '+06:00')=?),0) "
      + "- COALESCE((SELECT SUM(refund_amount) FROM sales_returns WHERE shop_id=? AND refund_id IS NULL AND refund_method='cash' AND is_deleted=0 AND date(created_at, '+06:00')=?),0) AS expected",
    ).get(shopId, date, shopId, date, shopId, date, shopId, date, shopId, date, shopId, date, shopId, date);
    db.prepare(
      'UPDATE `cash_drawer` SET `closed_by` = ?, `closed_at` = ?, `closing_expected` = ?, '
      + '`closing_counted` = ?, `reconciled_counted_amount` = ?, `reconciled_at` = ?, '
      + '`reconciled_by` = ?, `updated_at` = ? WHERE `business_date` = ? AND `shop_id` = ?',
    ).run(
      ownerId, closedAt, Number(cash.expected), Number(cash.expected),
      Number(cash.expected), closedAt, ownerId, closedAt, date, shopId,
    );
  }


  db.exec('COMMIT');

  // Prove the fixture is usable BEFORE reporting it as one. A file that
  // violated any of these would fail the drill's own postchecks later, at the
  // point where telling a fixture bug from a restore bug is most expensive.
  validateHistoryFixture(db);

  const counts = {};
  let total = 0;
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  ).all();
  for (const row of tables) {
    const n = Number(db.prepare(`SELECT COUNT(*) AS n FROM \`${row.name}\``).get().n);
    if (n > 0) counts[row.name] = n;
    total += n;
  }

  const money = db.prepare(
    'SELECT (SELECT COALESCE(SUM(`total`), 0) FROM `sales`) AS sales_paisa,'
    + ' (SELECT COALESCE(SUM(`credit_amount`), 0) FROM `sales`) AS credit_paisa,'
    + ' (SELECT COALESCE(SUM(`balance`), 0) FROM `credits`) AS receivable_paisa,'
    + ' (SELECT COALESCE(SUM(`amount`), 0) FROM `payments`) AS payments_paisa,'
    + ' (SELECT COALESCE(SUM(`total` - `paid_amount`), 0) FROM `purchases`) AS payable_paisa,'
    + ' (SELECT COALESCE(SUM(`stock`), 0) FROM `batches`) AS units_in_stock',
  ).get();

  // Fold the write-ahead log back in so the reported size is what a device
  // would actually have to migrate.
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  db.close();

  const bytes = statSync(outPath).size;
  const taka = (paisa) => (Number(paisa) / 100).toFixed(2);
  console.log(`fixture:      ${outPath}`);
  console.log(`migrations:   ${migrationCount} applied`);
  console.log(`rows:         ${total} across ${Object.keys(counts).length} tables`);
  console.log(`size:         ${(bytes / 1024 / 1024).toFixed(2)} MiB (${bytes} bytes)`);
  console.log(`generated in: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  console.log(`invariants:   ${INVARIANTS.length} checked, all pass`);
  console.log('');
  console.log(`sales:        BDT ${taka(money.sales_paisa)}`);
  console.log(`  of which credit: BDT ${taka(money.credit_paisa)}`);
  console.log(`receivable:   BDT ${taka(money.receivable_paisa)} still owed`);
  console.log(`payments total: BDT ${taka(money.payments_paisa)}`);
  console.log(`payable:      BDT ${taka(money.payable_paisa)} owed to suppliers`);
  console.log(`stock:        ${money.units_in_stock} units`);
  console.log('');
  for (const [table, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${table.padEnd(34)} ${n}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main();
}
