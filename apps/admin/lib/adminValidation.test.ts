// Batch 3 §8.13 — every admin write payload goes through a SHARED schema.
//
// docs/playbook/02-system-architecture.md:127 is explicit: "packages/validation
// — every Zod schema. A form in apps/mobile and any future admin-side write
// both import from here — never duplicated." So this file asserts two things a
// unit test alone cannot:
//
//  1. SOURCE-LEVEL: every exported write action parses a shared schema BEFORE
//     its first client call. A schema that exists but is not reached is not a
//     gate;
//  2. UNIT: each schema actually refuses what it claims to refuse, including
//     the cases a hand-written check would have let through.
//
// `isUuid` in lib/adminViews.ts is deliberately NOT replaced. It guards READ
// paths — route params and drill-down ids — where there is no write payload,
// and a test below pins that the two predicates agree, so the write path is
// never the looser of the two.

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  ADMIN_EXPORT_FORMATS,
  ADMIN_MAX_PAGE_SIZE,
  ADMIN_MAX_RANGE_DAYS,
  ADMIN_REPORT_IDS,
  ADMIN_ROLE_NAME_VALUES,
  ADMIN_SETTING_KEYS,
  ADMIN_WRITABLE_SETTING_KEYS,
  adminAccountIdActionSchema,
  adminListQuerySchema,
  adminPaymentOrderIdActionSchema,
  adminReportExportQuerySchema,
  adminRoleAssignmentUpdateSchema,
  adminSessionRevocationSchema,
  adminSettingUpdateSchema,
  adminSupportCaseCreateSchema,
  adminSupportCaseUpdateSchema,
  adminSupportNoteCreateSchema,
} from '@muthoy/validation';
import { AUDITABLE_REPORT_IDS, AUDITABLE_SETTING_KEYS } from './adminAudit';
import { isUuid } from './adminViews';

const UUID = '7b000000-0000-4000-8000-000000000001';
const OTHER_UUID = '86666666-6666-4666-8666-666666666666';

const ADMIN_ROOT = join(import.meta.dirname, '..');

function collect(directory: string): { path: string; code: string }[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((dirent) => {
    const absolute = join(directory, dirent.name);
    if (dirent.isDirectory()) {
      return ['node_modules', '.next', '.turbo', 'test'].includes(dirent.name)
        ? []
        : collect(absolute);
    }
    if (!/\.(ts|tsx)$/.test(dirent.name) || /\.test\.tsx?$/.test(dirent.name)) return [];
    const contents = readFileSync(absolute, 'utf8');
    return [{
      path: relative(ADMIN_ROOT, absolute).split(sep).join('/'),
      // Comments stripped, so a schema named only in prose does not count as a
      // parse.
      code: contents.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1'),
    }];
  });
}

const SOURCES = collect(ADMIN_ROOT);

/** The ten §8.13 schema names, as they appear in source. */
const SHARED_SCHEMAS: readonly string[] = [
  'adminSupportCaseCreateSchema',
  'adminSupportCaseUpdateSchema',
  'adminSupportNoteCreateSchema',
  'adminRoleAssignmentUpdateSchema',
  'adminSessionRevocationSchema',
  'adminSettingUpdateSchema',
  'adminReportExportQuerySchema',
  'adminListQuerySchema',
  'adminAccountIdActionSchema',
  'adminPaymentOrderIdActionSchema',
];

describe('the shared schemas are reached, not merely present', () => {
  test('finds the admin source tree', () => {
    expect(SOURCES.length).toBeGreaterThan(10);
  });

  test('all ten §8.13 schemas exist and are importable', () => {
    const schemas = [
      adminSupportCaseCreateSchema,
      adminSupportCaseUpdateSchema,
      adminSupportNoteCreateSchema,
      adminRoleAssignmentUpdateSchema,
      adminSessionRevocationSchema,
      adminSettingUpdateSchema,
      adminReportExportQuerySchema,
      adminListQuerySchema,
      adminAccountIdActionSchema,
      adminPaymentOrderIdActionSchema,
    ];

    expect(schemas).toHaveLength(SHARED_SCHEMAS.length);
    for (const schema of schemas) expect(typeof schema.safeParse).toBe('function');
  });

  // The write modules that exist today. Each later step adds its own, and a
  // module added to the §8.12 write manifest without landing here would be a
  // write with no payload contract.
  const WRITE_MODULES: readonly string[] = [
    'lib/adminActions.ts',
    'lib/adminIdentityActions.ts',
    'lib/adminSettingsActions.ts',
    'lib/adminSupportActions.ts',
  ];

  test.each(WRITE_MODULES)('%s parses a shared schema', (path) => {
    const source = SOURCES.find((candidate) => candidate.path === path);

    expect(source, path + ' is missing').toBeDefined();
    const parsed = SHARED_SCHEMAS.filter((schema) => source?.code.includes(schema + '.safeParse'));
    expect(parsed.length, path + ' parses no shared schema').toBeGreaterThan(0);
  });

  test.each(WRITE_MODULES)('%s parses BEFORE its first client call', (path) => {
    const source = SOURCES.find((candidate) => candidate.path === path);
    const code = source?.code ?? '';

    const firstParse = Math.min(
      ...SHARED_SCHEMAS
        .map((schema) => code.indexOf(schema + '.safeParse'))
        .filter((index) => index >= 0),
    );
    // Every way this module can reach the database — directly, or through the
    // store module that owns the table. The list must grow with each new store
    // function, or a module whose only reach is an unlisted one would score
    // ZERO client calls and pass this test vacuously.
    const clientCalls = [
      '.rpc(',
      '.from(',
      'getSupabaseAdmin()',
      'writeRoleAssignment(',
      'writeSetting(',
      'readSettings(',
      'insertSupportCase(',
      'updateSupportCase(',
      'insertSupportNote(',
      'readSupportCase(',
    ]
      .map((needle) => code.indexOf(needle))
      .filter((index) => index >= 0);

    expect(clientCalls.length, path + ' reaches no client at all').toBeGreaterThan(0);
    for (const call of clientCalls) {
      expect(firstParse, path + ' touches a client before it validates').toBeLessThan(call);
    }
  });

  test('no admin write module hand-rolls a UUID check in place of a schema', () => {
    // isUuid is a READ-path helper. A write module calling it is the exact
    // substitution round-3 finding 47 caught.
    const offenders = SOURCES
      .filter((source) => WRITE_MODULES.includes(source.path))
      .filter((source) => /\bisUuid\s*\(/.test(source.code));

    expect(offenders.map((source) => source.path)).toEqual([]);
  });

  test('no admin module defines its own Zod schema', () => {
    // A schema defined in apps/admin is a schema apps/mobile cannot share, and
    // the two drifting is the failure docs/playbook:127 exists to prevent.
    const offenders = SOURCES.filter((source) => /\bz\s*\.\s*object\s*\(/.test(source.code));

    expect(offenders.map((source) => source.path)).toEqual([]);
  });

  test('negative control: the before-client scan catches a reversed order', () => {
    const synthetic = "await client.rpc('x'); const p = adminAccountIdActionSchema.safeParse(v);";
    const firstParse = synthetic.indexOf('adminAccountIdActionSchema.safeParse');
    const firstCall = synthetic.indexOf('.rpc(');

    expect(firstCall).toBeLessThan(firstParse);
  });
});

describe('the id-only payloads match the read path exactly', () => {
  test('accepts a real UUID', () => {
    expect(adminAccountIdActionSchema.safeParse({ accountId: UUID }).success).toBe(true);
    expect(adminPaymentOrderIdActionSchema.safeParse({ orderId: UUID }).success).toBe(true);
  });

  test.each([
    ['the nil UUID', '00000000-0000-0000-0000-000000000000'],
    ['a v6 version nibble', '7b000000-0000-6000-8000-000000000001'],
    ['a bad variant nibble', '7b000000-0000-4000-c000-000000000001'],
    ['a truncated id', '7b000000-0000-4000-8000-00000000000'],
    ['a route-shaped string', '../../accounts'],
    ['a SQL fragment', "' or '1'='1"],
    ['an empty string', ''],
  ])('refuses %s', (_label, value) => {
    expect(adminAccountIdActionSchema.safeParse({ accountId: value }).success).toBe(false);
  });

  test('the write schema is not LOOSER than the read helper', () => {
    // Zod's own z.string().uuid() accepts the nil UUID and any variant nibble,
    // so this is the assertion that keeps the two predicates the same one.
    const candidates = [
      UUID,
      OTHER_UUID,
      '00000000-0000-0000-0000-000000000000',
      '7b000000-0000-6000-8000-000000000001',
      '7b000000-0000-4000-c000-000000000001',
      'not-an-id',
      '',
    ];

    for (const candidate of candidates) {
      expect(
        adminAccountIdActionSchema.safeParse({ accountId: candidate }).success,
        candidate + ' disagrees with isUuid',
      ).toBe(isUuid(candidate));
    }
  });

  test('a missing field is refused rather than treated as empty', () => {
    expect(adminAccountIdActionSchema.safeParse({}).success).toBe(false);
    expect(adminPaymentOrderIdActionSchema.safeParse(null).success).toBe(false);
  });
});

describe('the identity payloads', () => {
  test('accepts each of the four roles', () => {
    for (const role of ADMIN_ROLE_NAME_VALUES) {
      expect(adminRoleAssignmentUpdateSchema.safeParse({
        username: 'ops',
        role,
        isActive: true,
      }).success).toBe(true);
    }
  });

  test.each([
    ['a fifth role', { username: 'ops', role: 'owner', isActive: true }],
    ['an upper-case role', { username: 'ops', role: 'SUPER_ADMIN', isActive: true }],
    ['a string isActive', { username: 'ops', role: 'support', isActive: 'true' }],
    ['a missing isActive', { username: 'ops', role: 'support' }],
    ['a whitespace username', { username: 'two words', role: 'support', isActive: true }],
    ['a reserved username', { username: '__proto__', role: 'support', isActive: true }],
    ['a constructor username', { username: 'constructor', role: 'support', isActive: true }],
    ['an over-long username', { username: 'o'.repeat(65), role: 'support', isActive: true }],
    ['an empty username', { username: '', role: 'support', isActive: true }],
    ['a numeric username', { username: 7, role: 'support', isActive: true }],
  ])('refuses %s', (_label, payload) => {
    expect(adminRoleAssignmentUpdateSchema.safeParse(payload).success).toBe(false);
  });

  test('a padded username is TRIMMED, not refused, and the stored value is clean', () => {
    const parsed = adminRoleAssignmentUpdateSchema.safeParse({
      username: '  ops  ',
      role: 'support',
      isActive: true,
    });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.username).toBe('ops');
  });

  test('revocation takes a username and nothing else it could act on', () => {
    expect(adminSessionRevocationSchema.safeParse({ username: 'ops' }).success).toBe(true);
    expect(adminSessionRevocationSchema.safeParse({ username: '' }).success).toBe(false);
    expect(adminSessionRevocationSchema.safeParse({}).success).toBe(false);
  });
});

describe('the support payloads', () => {
  test('a case with no shop is REFUSED — shop_id is not null in the table', () => {
    // Revision 5 §3.4 declares `shop_id uuid not null`. A schema that accepted
    // a shopless case would pass here and fail at the insert, which is the one
    // failure a shared schema exists to make impossible.
    expect(adminSupportCaseCreateSchema.safeParse({
      requestId: UUID,
      category: 'payment',
      priority: 'normal',
      summary: 'Payment stuck',
    }).success).toBe(false);
  });

  test('a shop-scoped case needs a real id, not a label', () => {
    expect(adminSupportCaseCreateSchema.safeParse({
      requestId: UUID,
      shopId: UUID,
      category: 'sync',
      priority: 'high',
      summary: 'Sync stalled',
    }).success).toBe(true);

    expect(adminSupportCaseCreateSchema.safeParse({
      requestId: UUID,
      shopId: 'Banani Pharmacy',
      category: 'sync',
      priority: 'high',
      summary: 'Sync stalled',
    }).success).toBe(false);
  });

  test.each([
    ['an unknown category', { shopId: UUID, category: 'refunds', priority: 'normal', summary: 'x' }],
    // 'billing' and 'inventory' read like categories and are NOT in the CHECK;
    // the migration's list is onboarding/sync/payment/data/device/account/other.
    ['a plausible but unlisted category', { shopId: UUID, category: 'billing', priority: 'normal', summary: 'x' }],
    ['an unknown priority', { shopId: UUID, category: 'payment', priority: 'critical', summary: 'x' }],
    ['an empty summary', { shopId: UUID, category: 'payment', priority: 'normal', summary: '' }],
    ['a whitespace summary', { shopId: UUID, category: 'payment', priority: 'normal', summary: '   ' }],
    ['an over-long summary', { shopId: UUID, category: 'payment', priority: 'normal', summary: 'x'.repeat(2_001) }],
  ])('refuses %s', (_label, payload) => {
    expect(adminSupportCaseCreateSchema.safeParse({ requestId: UUID, ...payload }).success).toBe(false);
  });

  test('a summary at the CHECK bound is accepted, not refused one short of it', () => {
    // The app cap and the column's cap are the same number on purpose: a
    // tighter app cap would refuse an edit to a row the table already holds.
    expect(adminSupportCaseCreateSchema.safeParse({
      requestId: UUID,
      shopId: UUID,
      category: 'data',
      priority: 'low',
      summary: 'x'.repeat(2_000),
    }).success).toBe(true);
  });

  test('an unassigned case is a real state; an empty assignee becomes null', () => {
    const parsed = adminSupportCaseUpdateSchema.safeParse({
      caseId: UUID,
      status: 'pending',
      priority: 'high',
      assignee: '',
      summary: 'Still looking',
    });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.assignee).toBeNull();
  });

  test('a case update needs a real case id', () => {
    expect(adminSupportCaseUpdateSchema.safeParse({
      caseId: 'case-7',
      status: 'open',
      priority: 'low',
      summary: 'x',
    }).success).toBe(false);
  });

  test('a note cannot be empty and cannot be unbounded', () => {
    expect(adminSupportNoteCreateSchema.safeParse({ requestId: UUID, caseId: UUID, body: 'Called the owner.' }).success)
      .toBe(true);
    expect(adminSupportNoteCreateSchema.safeParse({ requestId: UUID, caseId: UUID, body: '  ' }).success).toBe(false);
    expect(adminSupportNoteCreateSchema.safeParse({ requestId: UUID, caseId: UUID, body: 'x'.repeat(8_000) }).success)
      .toBe(true);
    expect(adminSupportNoteCreateSchema.safeParse({ requestId: UUID, caseId: UUID, body: 'x'.repeat(8_001) }).success)
      .toBe(false);
  });
});

describe('the settings payload', () => {
  test('accepts each of the three writable flags', () => {
    for (const key of ADMIN_WRITABLE_SETTING_KEYS) {
      expect(adminSettingUpdateSchema.safeParse({ key, value: true }).success).toBe(true);
      expect(adminSettingUpdateSchema.safeParse({ key, value: false }).success).toBe(true);
    }
  });

  test('refuses every notification template — no dispatcher exists to consume one', () => {
    const templates = ADMIN_SETTING_KEYS.filter((key) => key.startsWith('notification.template.'));

    expect(templates).toHaveLength(3);
    for (const key of templates) {
      expect(adminSettingUpdateSchema.safeParse({ key, value: true }).success).toBe(false);
    }
  });

  test('the writable keys are a strict subset of the six', () => {
    for (const key of ADMIN_WRITABLE_SETTING_KEYS) {
      expect(ADMIN_SETTING_KEYS).toContain(key);
    }
    expect(ADMIN_WRITABLE_SETTING_KEYS.length).toBeLessThan(ADMIN_SETTING_KEYS.length);
  });

  test.each([
    ['an unlisted key', { key: 'flag.everything_enabled', value: true }],
    // The pre-revision-5 spelling. It must be refused, or the drift the
    // migration's CHECK caught could come back unnoticed.
    ['the old feature.* spelling', { key: 'feature.maps', value: true }],
    ['the string "false"', { key: 'flag.maps_enabled', value: 'false' }],
    ['the string "true"', { key: 'flag.maps_enabled', value: 'true' }],
    ['the number 1', { key: 'flag.maps_enabled', value: 1 }],
    ['a missing value', { key: 'flag.maps_enabled' }],
    ['a prototype key', { key: '__proto__', value: true }],
  ])('refuses %s', (_label, payload) => {
    expect(adminSettingUpdateSchema.safeParse(payload).success).toBe(false);
  });
});

describe('the enumerations do not drift between their copies', () => {
  // §8.11 requires the six setting keys to be enumerated in three places with a
  // test asserting they are identical. Two of the three exist today — the
  // shared schema and the audit allowlist — and lib/adminSettings.ts is the
  // third. The audit module keeps its OWN copy deliberately: it is the last
  // gate before a value is stored, so a settings bug must not be able to widen
  // what the audit log accepts.
  test('the audit allowlist names exactly the six shared setting keys', () => {
    expect([...AUDITABLE_SETTING_KEYS].sort()).toEqual([...ADMIN_SETTING_KEYS].sort());
  });

  test('the audit allowlist names exactly the six shared report ids', () => {
    expect([...AUDITABLE_REPORT_IDS].sort()).toEqual([...ADMIN_REPORT_IDS].sort());
  });

  test('a settingKey the schema refuses is also refused by the audit allowlist', () => {
    // The two lists agreeing is not the same as both being right, so this walks
    // a planted key through both gates.
    expect(adminSettingUpdateSchema.safeParse({ key: 'feature.everything', value: true }).success)
      .toBe(false);
    expect(AUDITABLE_SETTING_KEYS).not.toContain('feature.everything');
  });
});

describe('the query shapes', () => {
  test('accepts each report id in each format', () => {
    for (const reportId of ADMIN_REPORT_IDS) {
      for (const format of ADMIN_EXPORT_FORMATS) {
        expect(adminReportExportQuerySchema.safeParse({ reportId, format }).success).toBe(true);
      }
    }
  });

  test.each([
    ['an unlisted report', { reportId: 'all_the_money', format: 'csv' }],
    ['an unsupported format', { reportId: 'subscriptions', format: 'xlsx' }],
    ['a timestamp where a day belongs', { reportId: 'subscriptions', format: 'csv', from: '2026-01-01T00:00:00Z' }],
    ['a reversed range', { reportId: 'subscriptions', format: 'csv', from: '2026-03-01', to: '2026-01-01' }],
    ['a status with a metacharacter', { reportId: 'subscriptions', format: 'csv', status: "a' or '1" }],
  ])('refuses %s', (_label, payload) => {
    expect(adminReportExportQuerySchema.safeParse(payload).success).toBe(false);
  });

  test('a range at the cap is accepted and one day past it is not', () => {
    const day = 86_400_000;
    const from = '2026-01-01';
    const at = new Date(Date.parse(from + 'T00:00:00Z') + ADMIN_MAX_RANGE_DAYS * day)
      .toISOString()
      .slice(0, 10);
    const past = new Date(Date.parse(from + 'T00:00:00Z') + (ADMIN_MAX_RANGE_DAYS + 1) * day)
      .toISOString()
      .slice(0, 10);

    expect(adminReportExportQuerySchema.safeParse({
      reportId: 'subscriptions', format: 'csv', from, to: at,
    }).success).toBe(true);
    expect(adminReportExportQuerySchema.safeParse({
      reportId: 'subscriptions', format: 'csv', from, to: past,
    }).success).toBe(false);
  });

  test('a list query coerces its numeric strings, because searchParams are strings', () => {
    const parsed = adminListQuerySchema.safeParse({ page: '3', pageSize: '25' });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.page).toBe(3);
    expect(parsed.success && parsed.data.pageSize).toBe(25);
  });

  test('page and pageSize are BOUNDED, so a page number cannot become an unbounded offset', () => {
    expect(adminListQuerySchema.safeParse({ page: '0' }).success).toBe(false);
    expect(adminListQuerySchema.safeParse({ page: '-1' }).success).toBe(false);
    expect(adminListQuerySchema.safeParse({ page: '1.5' }).success).toBe(false);
    expect(adminListQuerySchema.safeParse({ page: '10001' }).success).toBe(false);
    expect(adminListQuerySchema.safeParse({ pageSize: String(ADMIN_MAX_PAGE_SIZE) }).success)
      .toBe(true);
    expect(adminListQuerySchema.safeParse({ pageSize: String(ADMIN_MAX_PAGE_SIZE + 1) }).success)
      .toBe(false);
  });

  test('search text is bounded', () => {
    expect(adminListQuerySchema.safeParse({ search: 'napa' }).success).toBe(true);
    expect(adminListQuerySchema.safeParse({ search: 'x'.repeat(121) }).success).toBe(false);
  });

  test('a sort value outside the four is refused, so it cannot reach an order clause', () => {
    expect(adminListQuerySchema.safeParse({ sort: 'registered_desc' }).success).toBe(true);
    expect(adminListQuerySchema.safeParse({ sort: 'name; drop table shops' }).success).toBe(false);
    expect(adminListQuerySchema.safeParse({ sort: 'created_at' }).success).toBe(false);
  });

  test('an empty query is valid — a list page with no filters is the default view', () => {
    expect(adminListQuerySchema.safeParse({}).success).toBe(true);
  });

  test('the list query caps its range too', () => {
    expect(adminListQuerySchema.safeParse({ from: '2026-03-01', to: '2026-01-01' }).success)
      .toBe(false);
  });
});
