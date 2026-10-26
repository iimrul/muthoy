// The field-classification guard.
//
// domain/serverOwnedFields.ts decides which columns H-6's detector may compare.
// Getting it wrong in the "server-owned" direction blinds the detector
// SILENTLY — an absent conflict notice looks exactly like no conflict — and
// every draft of that list fell into exactly that trap: `cash_drawer`'s
// reconcile columns and `users.address/email` were both wrongly excluded, and
// `sales`' tax snapshot and `expenses.category` were both wrongly included.
//
// So the declaration is not trusted. This reads the four sources of truth and
// fails when they disagree:
//
//   1. sync-helpers.ts's upsertRemoteRow — which tables are append-only;
//   2. sync-helpers.ts's toSyncPayload / preservedLocalFields — stripped and
//      preserved fields;
//   3. the migration SQL — every wrapper's jsonb_build_object pin list, and the
//      CONDITIONAL `if not p_row ? '…'` form, which is a client-owned fallback
//      rather than a pin;
//   4. functions/sync/push.ts — applyUserProfileFields writes address/email
//      from the CLIENT payload in TypeScript, where no SQL parser would see it.
//
// Same read-the-source technique as tests/font-tokens.test.ts and
// tests/dev-production-safety.test.ts.

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CONFLICT_EXEMPT_TABLES,
  SERVER_OWNED_FIELDS,
  isComparableField,
} from '../domain/serverOwnedFields';
import { CONFLICT_TABLE_GATES } from '../domain/conflictTables';

const SYNC_HELPERS = readFileSync(resolve('apps/mobile/db/sync-helpers.ts'), 'utf8');
const PUSH_TS = readFileSync(
  resolve('backend/supabase/functions/sync/push.ts'),
  'utf8',
);
const MIGRATIONS_DIR = resolve('backend/supabase/migrations');
const MIGRATIONS = readdirSync(MIGRATIONS_DIR)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => readFileSync(join(MIGRATIONS_DIR, name), 'utf8'))
  .join('\n');

/** The `case "x":` arms of upsertRemoteRow, split by conflict strategy. */
function upsertArms(): { doNothing: string[]; doUpdate: string[] } {
  const start = SYNC_HELPERS.indexOf('function upsertRemoteRow');
  const end = SYNC_HELPERS.indexOf('export function applyRemoteRow');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const body = SYNC_HELPERS.slice(start, end);

  const doNothing: string[] = [];
  const doUpdate: string[] = [];
  for (const part of body.split('case "').slice(1)) {
    const name = part.slice(0, part.indexOf('"'));
    const arm = part.slice(0, part.indexOf('break;'));
    (arm.includes('onConflictDoNothing') ? doNothing : doUpdate).push(name);
  }
  return { doNothing, doUpdate };
}

describe('append-only tables (source 1: upsertRemoteRow)', () => {
  it('CONFLICT_EXEMPT_TABLES is exactly the onConflictDoNothing set', () => {
    const { doNothing } = upsertArms();
    expect([...doNothing].sort()).toEqual([...CONFLICT_EXEMPT_TABLES].sort());
  });

  it('the exempt set is six tables — a count that has to be revisited deliberately', () => {
    expect(CONFLICT_EXEMPT_TABLES).toHaveLength(6);
  });

  it('CONFLICT_TABLE_GATES covers exactly the non-exempt synced tables', () => {
    const { doNothing, doUpdate } = upsertArms();
    const exempt = new Set(doNothing);
    const expected = doUpdate.filter((table) => !exempt.has(table)).sort();
    expect(Object.keys(CONFLICT_TABLE_GATES).sort()).toEqual(expected);
  });
});

describe('stripped and preserved fields (source 2: sync-helpers.ts)', () => {
  const toWire = (camel: string): string =>
    camel.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

  /**
   * toSyncPayload's `delete payload.x` lines, grouped by the table whose
   * `if (tableName === "…")` branch they sit in — so a field is checked against
   * the table that actually strips it rather than against a flat set.
   */
  function strippedFieldsByTable(): Record<string, string[]> {
    const start = SYNC_HELPERS.indexOf('function toSyncPayload');
    const end = SYNC_HELPERS.indexOf('function readCommercialWriteState');
    const body = SYNC_HELPERS.slice(start, end);
    const out: Record<string, string[]> = {};
    for (const chunk of body.split('if (tableName === ').slice(1)) {
      const table = chunk.slice(1, chunk.indexOf('"', 1));
      out[table] = [...chunk.matchAll(/delete payload\.(\w+)/g)].map((m) => toWire(m[1]!));
    }
    return out;
  }

  it('declares each stripped field against the RIGHT table, with no extras', () => {
    // Flattening across tables was the earlier mistake: a field assigned to the
    // wrong table passed, while `push_superseded` went blind on the table that
    // actually strips it. Parsed per-table from toSyncPayload's own branches.
    const expected = strippedFieldsByTable();
    // Non-vacuity: a parser that silently returns nothing would make this whole
    // assertion pass while checking zero fields.
    expect(Object.keys(expected).length).toBeGreaterThanOrEqual(3);
    expect(Object.values(expected).flat().length).toBeGreaterThanOrEqual(8);
    for (const [table, fields] of Object.entries(expected)) {
      const declared = SERVER_OWNED_FIELDS[table as keyof typeof SERVER_OWNED_FIELDS] ?? [];
      for (const field of fields) {
        expect(declared, `toSyncPayload strips ${table}.${field}; declare it on ${table}`)
          .toContain(field);
      }
    }
    // And nothing is declared server-owned for a table that has no reason to:
    // an extra exclusion is the silent-blindness direction.
    const TABLES_WITH_A_REASON = new Set([
      // 'medicines' is W2-03's device-local search_key, whose authority is the
      // strip in toSyncPayload — stated in the EVIDENCE table above with its
      // own scoped needle, exactly like the three sale_attachments fields.
      'batches', 'shops', 'users', 'sales', 'expenses', 'sale_attachments', 'medicines',
    ]);
    for (const table of Object.keys(SERVER_OWNED_FIELDS)) {
      expect(TABLES_WITH_A_REASON, `${table} declares server-owned fields with no documented authority`)
        .toContain(table);
    }
  });

  it('batches.stock and oversold_at are server-owned, matching preservedLocalFields', () => {
    expect(SYNC_HELPERS).toContain('export function preservedLocalFields');
    expect(SERVER_OWNED_FIELDS.batches).toEqual(
      expect.arrayContaining(['stock', 'oversold_at']),
    );
    expect(isComparableField('batches', 'stock')).toBe(false);
    expect(isComparableField('batches', 'oversold_at')).toBe(false);
  });

  it('users.access_locked_at is server-owned — one device lock is never another device’s', () => {
    expect(isComparableField('users', 'access_locked_at')).toBe(false);
  });
});

describe('wrapper pins vs conditional fallbacks (source 3: migration SQL)', () => {
  it('the B4 commercial fields are pinned, and declared', () => {
    // v_row := p_row || jsonb_build_object('plan', v_shop.plan, …)
    expect(MIGRATIONS).toContain("'plan',v_shop.plan");
    for (const field of [
      'plan', 'trial_ends_at', 'billing_account_id',
      'commercial_status', 'commercial_reason', 'archived_at',
    ]) {
      expect(isComparableField('shops', field), `shops.${field} is pinned by B4`)
        .toBe(false);
    }
  });

  it('the sales tax snapshot is PINNED on update, so it is server-owned', () => {
    // 20260827010000 raises MU024 on a changed snapshot and then overwrites all
    // three from the existing row.
    expect(MIGRATIONS).toContain('sale tax snapshot is immutable');
    expect(MIGRATIONS).toContain("'tax_amount',v_existing_tax");
    for (const field of ['tax_amount', 'tax_rate_bp', 'tax_label']) {
      expect(isComparableField('sales', field)).toBe(false);
    }
  });

  it('cash_drawer reconcile columns are a FALLBACK, not a pin, so they stay comparable', () => {
    // `if not p_row ? 'reconciled_counted_amount'` — filled only when the key is
    // ABSENT, and recordChange always sends a complete row, so the client's
    // value always wins. Excluding these would blind the detector to a real
    // cash-drawer conflict.
    expect(MIGRATIONS).toContain("if not p_row ? 'reconciled_counted_amount'");
    for (const field of ['reconciled_counted_amount', 'reconciled_at', 'reconciled_by']) {
      expect(
        isComparableField('cash_drawer', field),
        `cash_drawer.${field} is a conditional fallback, not server-owned`,
      ).toBe(true);
    }
    expect(SERVER_OWNED_FIELDS.cash_drawer).toBeUndefined();
  });
});

describe('non-SQL server rewrites (source 4: functions/sync/push.ts)', () => {
  it('expenses.category is canonicalised server-side, so it is server-owned', () => {
    expect(PUSH_TS).toContain('canonicalizeExpensePayload');
    expect(isComparableField('expenses', 'category')).toBe(false);
  });

  it('users.address and email carry the CLIENT value, so they stay comparable', () => {
    // applyUserProfileFields assigns from row.payload and applies with
    // `.lte('updated_at', updatedAt)`, so on the equal-timestamp drop they land
    // even though the main upsert did not.
    expect(PUSH_TS).toContain('applyUserProfileFields');
    expect(PUSH_TS).toContain('values.address = row.payload.address');
    expect(isComparableField('users', 'address')).toBe(true);
    expect(isComparableField('users', 'email')).toBe(true);
  });
});

/** Scope bounds, so a needle must sit in the branch that owns it. */
const PRESERVE_BATCHES = [
  'export function preservedLocalFields',
  'if (tableName === "users")',
] as const;
// W2-03's strip sits FIRST in toSyncPayload, so its branch runs from itself to
// the shops branch that follows. Bounded like every other one: a needle
// satisfied anywhere else in the file would prove nothing about this branch.
const MEDICINES_STRIP = [
  'if (tableName === "medicines")',
  'if (tableName === "shops")',
] as const;
const SHOPS_STRIP = ['if (tableName === "shops")', 'if (tableName === "users")'] as const;
const USERS_STRIP = [
  'if (tableName === "users")',
  'if (tableName === "sale_attachments")',
] as const;
const ATTACHMENT_STRIP = [
  'if (tableName === "sale_attachments")',
  'function readCommercialWriteState',
] as const;
const STAFF_WRAPPER = '20260819000000_staff_device_login.sql';
const B4 = '20260831000000_b4_commercial_platform.sql';
const TAX_SNAPSHOT = '20260827010000_b3_group9_sale_tax_snapshot.sql';
const EXPENSE_CATEGORIES = 'expense-categories';
const HELPERS = 'sync-helpers';
/**
 * SQL branch bounds. Without these, a needle is satisfied anywhere in the file
 * — so changing the owning `p_table` condition while leaving the pin intact
 * would still pass, which is the precise hole the delta review named.
 */
const B4_SHOPS_BRANCH = ["if p_table='shops' and p_op<>'delete' then", "if p_table='users'"] as const;

/** W4-05, migration 35: the shop identity pin. */
const E4 = '20261023000000_e4_batch3_admin_platform.sql';
// Scoped to the pin block itself, so a mention of a column name anywhere else
// in that migration — the DDL, a comment, the owner predicate — cannot satisfy
// a needle. The block runs from the non-owner guard to the delegation.
const E4_SHOPS_PIN = [
  "if p_table = 'shops' and p_op <> 'delete'",
  'return sync_apply_row_pre_w405(',
] as const;
const STAFF_USERS_BRANCH = ["if p_table = 'users' then", 'if p_table <> '] as const;
const TAX_SALES_BRANCH = ["if p_table='sales' and p_op<>'delete' then", 'if v_result='] as const;

/**
 * WHY each declared field is server-owned: a needle, and the EXACT source that
 * must contain it.
 *
 * Two review rounds bit here. The first version validated only table NAMES, so
 * a bogus extra field passed and silently blinded that table's detector. The
 * second named its sources too loosely — it searched the whole concatenated
 * migration text, which any historical or superseded migration could satisfy,
 * and it cited push.ts's pre-apply SELECT as if READING a column were the same
 * as the server REWRITING it.
 *
 * So evidence is bound to one file — for a migration, the single file that
 * installs the behaviour — and `scope` narrows the search to the branch that
 * does the work, so a needle cannot be satisfied by text elsewhere in the file.
 */
interface Evidence {
  readonly source: string;
  readonly scope?: readonly [string, string];
  readonly needle: string;
}

const EVIDENCE: Record<string, Record<string, Evidence>> = {
  batches: {
    // applyToTable keeps the local ledger figures on the way in.
    stock: { source: HELPERS, scope: PRESERVE_BATCHES, needle: 'stock: local.stock' },
    oversold_at: {
      source: HELPERS,
      scope: PRESERVE_BATCHES,
      needle: 'oversoldAt: local.oversoldAt',
    },
  },
  shops: {
    // 20260831000000 (B4) pins the six commercial fields on the shops wrapper.
    plan: { source: B4, scope: B4_SHOPS_BRANCH, needle: "'plan',v_shop.plan" },
    trial_ends_at: { source: B4, scope: B4_SHOPS_BRANCH, needle: "'trial_ends_at',v_shop.trial_ends_at" },
    billing_account_id: { source: B4, scope: B4_SHOPS_BRANCH, needle: "'billing_account_id',v_shop.billing_account_id" },
    commercial_status: { source: B4, scope: B4_SHOPS_BRANCH, needle: "'commercial_status',v_shop.commercial_status" },
    commercial_reason: { source: B4, scope: B4_SHOPS_BRANCH, needle: "'commercial_reason',v_shop.commercial_reason" },
    archived_at: { source: B4, scope: B4_SHOPS_BRANCH, needle: "'archived_at',v_shop.archived_at" },
    cloud_linked_at: {
      source: HELPERS,
      scope: SHOPS_STRIP,
      needle: 'delete payload.cloudLinkedAt',
    },
    // W4-05 (migration 35) pins the eight identity fields from the stored row
    // whenever the caller is not the shop's owner. Each needle is the actual
    // overlay line, inside the pin block.
    name: { source: E4, scope: E4_SHOPS_PIN, needle: "'name', v_shop.name" },
    name_en: { source: E4, scope: E4_SHOPS_PIN, needle: "'name_en', v_shop.name_en" },
    phone: { source: E4, scope: E4_SHOPS_PIN, needle: "'phone', v_shop.phone" },
    latitude: { source: E4, scope: E4_SHOPS_PIN, needle: "'latitude', v_shop.latitude" },
    longitude: { source: E4, scope: E4_SHOPS_PIN, needle: "'longitude', v_shop.longitude" },
    thana: { source: E4, scope: E4_SHOPS_PIN, needle: "'thana', v_shop.thana" },
    district: { source: E4, scope: E4_SHOPS_PIN, needle: "'district', v_shop.district" },
    location_captured_at: {
      source: E4,
      scope: E4_SHOPS_PIN,
      needle: "'location_captured_at', v_shop.location_captured_at",
    },
  },
  users: {
    // Stripped inside toSyncPayload's OWN users branch — scoped, so a field
    // deleted for a different table cannot satisfy this.
    permission_version: {
      source: HELPERS,
      scope: USERS_STRIP,
      needle: 'delete payload.permissionVersion',
    },
    pin_lookup_tag: { source: HELPERS, scope: USERS_STRIP, needle: 'delete payload.pinLookupTag' },
    pin_lookup_pin_set_at: {
      source: HELPERS,
      scope: USERS_STRIP,
      needle: 'delete payload.pinLookupPinSetAt',
    },
    plan_suspended_at: {
      source: HELPERS,
      scope: USERS_STRIP,
      needle: 'delete payload.planSuspendedAt',
    },
    plan_suspension_reason: {
      source: HELPERS,
      scope: USERS_STRIP,
      needle: 'delete payload.planSuspensionReason',
    },
    access_locked_at: {
      source: HELPERS,
      scope: USERS_STRIP,
      needle: 'delete payload.accessLockedAt',
    },
    // 20260819000000's staff-device wrapper OVERWRITES these from the target
    // row. Reading a column is not rewriting it, which is what the previous
    // version of this table wrongly cited.
    role_id: { source: STAFF_WRAPPER, scope: STAFF_USERS_BRANCH, needle: "'role_id', to_jsonb(v_target.role_id)" },
    is_active: { source: STAFF_WRAPPER, scope: STAFF_USERS_BRANCH, needle: "'is_active', to_jsonb(v_target.is_active)" },
    is_deleted: { source: STAFF_WRAPPER, scope: STAFF_USERS_BRANCH, needle: "'is_deleted', to_jsonb(v_target.is_deleted)" },
    pin_hash: { source: STAFF_WRAPPER, scope: STAFF_USERS_BRANCH, needle: "'pin_hash', to_jsonb(v_target.pin_hash)" },
    pin_set_at: { source: STAFF_WRAPPER, scope: STAFF_USERS_BRANCH, needle: "'pin_set_at', to_jsonb(v_target.pin_set_at)" },
  },
  sales: {
    // 20260827010000 raises MU024 on a changed snapshot, then overwrites all three.
    tax_amount: { source: TAX_SNAPSHOT, scope: TAX_SALES_BRANCH, needle: "'tax_amount',v_existing_tax" },
    tax_rate_bp: { source: TAX_SNAPSHOT, scope: TAX_SALES_BRANCH, needle: "'tax_rate_bp',v_existing_rate" },
    tax_label: { source: TAX_SNAPSHOT, scope: TAX_SALES_BRANCH, needle: "'tax_label',v_existing_label" },
  },
  expenses: {
    // The rewrite itself, in the function that performs it — not the import.
    category: {
      source: EXPENSE_CATEGORIES,
      // The REWRITE, not the guard: a canonicalizer gutted to `return payload`
      // would still contain the table check, so the check alone proved nothing.
      needle: 'return { ...payload, category };',
    },
  },
  medicines: {
    // W2-03. The authority is the STRIP itself: Postgres `medicines` declares
    // no `search_key`, so toSyncPayload removing it is what makes the column
    // absent from every pushed payload — and applyToTable recomputes it
    // locally on the way in, so it is absent from the pulled side too.
    search_key: { source: HELPERS, scope: MEDICINES_STRIP, needle: 'delete payload.searchKey' },
  },
  sale_attachments: {
    local_uri: { source: HELPERS, scope: ATTACHMENT_STRIP, needle: 'delete payload.localUri' },
    upload_status: {
      source: HELPERS,
      scope: ATTACHMENT_STRIP,
      needle: 'delete payload.uploadStatus',
    },
    upload_error: {
      source: HELPERS,
      scope: ATTACHMENT_STRIP,
      needle: 'delete payload.uploadError',
    },
  },
};

describe('every server-owned declaration names real, specific evidence', () => {
  function sourceText(source: string): string {
    if (source === HELPERS) return SYNC_HELPERS;
    if (source === EXPENSE_CATEGORIES) {
      return readFileSync(
        resolve('backend/supabase/functions/sync/_shared/expenseCategories.ts'),
        'utf8',
      );
    }
    // A single migration FILE, not the concatenated chain: otherwise an
    // unrelated or superseded migration could satisfy the needle.
    return readFileSync(join(MIGRATIONS_DIR, source), 'utf8');
  }

  it('declares EXACTLY the fields the evidence table covers — no extras, none missing', () => {
    const declared = Object.fromEntries(
      Object.entries(SERVER_OWNED_FIELDS).map(([table, fields]) => [
        table,
        [...(fields ?? [])].sort(),
      ]),
    );
    const evidenced = Object.fromEntries(
      Object.entries(EVIDENCE).map(([table, fields]) => [table, Object.keys(fields).sort()]),
    );
    expect(declared).toEqual(evidenced);
  });

  it('each needle appears in the named file, inside the named scope', () => {
    let checked = 0;
    for (const [table, fields] of Object.entries(EVIDENCE)) {
      for (const [field, evidence] of Object.entries(fields)) {
        const text = sourceText(evidence.source);
        let haystack = text;
        if (evidence.scope) {
          const [from, to] = evidence.scope;
          const start = text.indexOf(from);
          const end = text.indexOf(to, start + 1);
          expect(start, `${table}.${field}: scope start not found: ${from}`).toBeGreaterThan(-1);
          expect(end, `${table}.${field}: scope end not found: ${to}`).toBeGreaterThan(start);
          haystack = text.slice(start, end);
        }
        expect(
          haystack,
          `${table}.${field}: ${evidence.source} lacks ${evidence.needle} in scope`,
        ).toContain(evidence.needle);
        checked += 1;
      }
    }
    // Non-vacuity: a mistyped loop that checked nothing would otherwise pass.
    expect(checked).toBeGreaterThanOrEqual(25);
  });

  it('and nothing outside the evidence table is treated as server-owned', () => {
    for (const [table, field] of [
      ['batches', 'sale_price'],
      // Was ['shops', 'name'], which W4-05 made server-owned in Batch 3.
      // owner_id replaces it: a shops column pinned by no wrapper.
      ['shops', 'owner_id'],
      ['users', 'name'],
      ['sales', 'total'],
      ['expenses', 'amount'],
      ['cash_drawer', 'reconciled_counted_amount'],
    ] as const) {
      expect(
        isComparableField(table, field),
        `${table}.${field} has no server-ownership evidence and must stay comparable`,
      ).toBe(true);
    }
  });
});

const SHOP_IDENTITY_FIELDS = [
  'name', 'name_en', 'phone', 'latitude', 'longitude',
  'thana', 'district', 'location_captured_at',
] as const;

describe('W4-05, now applied', () => {
  // This block was "the W4-05 forcing function", and its job was to fail the
  // moment the wrapper entered the chain so the eight identity fields got
  // reclassified. W4-05 landed in Batch 3, so it is inverted here: the same
  // relationship, asserted in the direction that is now true.
  //
  // IT DID NOT ACTUALLY FIRE, and that is worth recording. Its detector was
  //   MIGRATIONS.includes("'location_captured_at',v_shop.location_captured_at")
  // — no space after the comma, matching B4's formatting. Migration 35 writes
  // the same overlay with a space, so the needle missed, the assertion passed,
  // and the reclassification it exists to force was never demanded. A forcing
  // function that depends on whitespace is worse than none, because the batch
  // proceeds believing the reminder will catch it. The detection below is
  // whitespace-insensitive for that reason.
  const squeezed = MIGRATIONS.replace(/\s+/g, '');

  it('detects the wrapper regardless of how the SQL is formatted', () => {
    const applied = squeezed.includes("'location_captured_at',v_shop.location_captured_at")
      && squeezed.includes('sync_apply_row_pre_w405');
    expect(applied, 'W4-05 should be in the migration chain from Batch 3 onward').toBe(true);
  });

  it('would still detect the wrapper if it were written without spaces', () => {
    // Non-vacuity for the fix itself: the squeeze must be what makes the match
    // work, not an accident of the current formatting.
    const spaced = "'location_captured_at', v_shop.location_captured_at";
    const tight = "'location_captured_at',v_shop.location_captured_at";
    expect(MIGRATIONS).toContain(spaced);
    expect(MIGRATIONS).not.toContain(tight);
    expect(spaced.replace(/\s+/g, '')).toBe(tight);
  });

  it('treats all eight shop identity fields as server-owned', () => {
    for (const field of SHOP_IDENTITY_FIELDS) {
      expect(isComparableField('shops', field), `shops.${field}`).toBe(false);
    }
  });

  it('keeps a genuinely client-owned shops column comparable', () => {
    // The negative control that stops the above from being "shops is excluded
    // wholesale". owner_id is set at registration and pinned by nothing.
    expect(isComparableField('shops', 'owner_id')).toBe(true);
  });
});

describe('universal exclusions', () => {
  it('never compares bookkeeping columns', () => {
    for (const field of ['id', 'created_at', 'updated_at', 'is_dirty']) {
      expect(isComparableField('customers', field)).toBe(false);
    }
  });

  it('compares an ordinary business column', () => {
    expect(isComparableField('customers', 'name')).toBe(true);
    expect(isComparableField('customers', 'phone')).toBe(true);
  });
});
