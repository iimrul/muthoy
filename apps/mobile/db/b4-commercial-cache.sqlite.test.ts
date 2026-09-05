import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const sqlite = new DatabaseSync(':memory:');
const migration = (name: string) => sqlite.exec(readFileSync(resolve('apps/mobile/db/migrations', name), 'utf8'));

describe('B4 commercial cache migration', () => {
  beforeAll(() => {
    sqlite.exec('PRAGMA foreign_keys=ON');
    for (let index = 0; index <= 26; index += 1) {
      const prefix = String(index).padStart(4, '0');
      const file = index === 0 ? '0000_open_senator_kelly.sql'
        : index === 1 ? '0001_medicines_fts.sql'
        : index === 2 ? '0002_furry_celestials.sql'
        : index === 3 ? '0003_curious_wild_pack.sql'
        : index === 4 ? '0004_deep_boomer.sql'
        : index === 5 ? '0005_eminent_legion.sql'
        : index === 6 ? '0006_inventory_movement_ledger.sql'
        : index === 7 ? '0007_staff_device_login.sql'
        : index === 8 ? '0008_native_pin_lookup.sql'
        : index === 9 ? '0009_strong_gargoyle.sql'
        : index === 10 ? '0010_known_ares.sql'
        : index === 11 ? '0011_black_zarda.sql'
        : index === 12 ? '0012_small_meltdown.sql'
        : index === 13 ? '0013_owner_dashboard_credit_period.sql'
        : index === 14 ? '0014_owner_dashboard_credit_period_guard.sql'
        : index === 15 ? '0015_b3_shop_settings.sql'
        : index === 16 ? '0016_payment_note.sql'
        : index === 17 ? '0017_cash_reconcile.sql'
        : index === 18 ? '0018_expense_category_taxonomy.sql'
        : index === 19 ? '0019_supplier_archive.sql'
        : index === 20 ? '0020_purchase_item_status.sql'
        : index === 21 ? '0021_purchase_void.sql'
        : index === 22 ? '0022_supplier_profile_fields.sql'
        : index === 23 ? '0023_purchase_invoice_metadata.sql'
        : index === 24 ? '0024_b3_report_indexes.sql'
        : index === 25 ? '0025_b3_sale_tax_snapshot.sql'
        : '0026_b4_commercial_cache.sql';
      expect(file.startsWith(prefix)).toBe(true);
      migration(file);
    }
  });
  afterAll(() => sqlite.close());

  it('creates indexed local-only membership, entitlement, directory, and payment caches', () => {
    const tables = sqlite.prepare("select name from sqlite_master where type='table'").all().map((row) => String(row.name));
    expect(tables).toEqual(expect.arrayContaining(['billing_accounts','shop_memberships','shop_directory','shop_summary_cache','entitlement_cache','payment_attempts']));
    const indexes = sqlite.prepare("select name from sqlite_master where type='index'").all().map((row) => String(row.name));
    expect(indexes).toEqual(expect.arrayContaining(['shop_memberships_principal_active_idx','shop_memberships_billing_account_idx','shop_directory_account_idx','shop_summary_cache_lookup_idx','entitlement_cache_verified_idx','payment_attempts_account_status_idx','payment_attempts_server_order_idx']));
  });

  it('keeps account/member/shop relationships guarded by explicit foreign keys', () => {
    expect(() => sqlite.prepare(`insert into shop_memberships(
      id,billing_account_id,principal_user_id,shop_id,actor_user_id,role,is_active,created_at,updated_at
    ) values('m','missing','missing','missing','missing','owner',1,'now','now')`).run()).toThrow(/FOREIGN KEY/);
  });

  it('rejects fake local plan/payment shapes at the database boundary', () => {
    expect(() => sqlite.prepare(`insert into entitlement_cache(
      billing_account_id,tier,status,verified_at,version,updated_at
    ) values('missing','god','active','now',1,'now')`).run()).toThrow();
    expect(() => sqlite.prepare(`insert into payment_attempts(
      id,billing_account_id,client_request_id,tier,billing_cycle,amount_paisa,provider,status,created_at,updated_at
    ) values('p','missing','r','pro','monthly',-1,'sslcommerz','verified','now','now')`).run()).toThrow();
  });
});
