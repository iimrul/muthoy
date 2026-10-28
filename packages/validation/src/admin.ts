import { z } from 'zod';

// Batch 3 §8.13 — the admin panel's write payloads and query shapes.
//
// They live HERE and not in apps/admin because
// docs/playbook/02-system-architecture.md:127 is explicit: "packages/validation
// — every Zod schema. A form in apps/mobile and any future admin-side write
// both import from here — never duplicated."
//
// An admin username is NOT a phone number and NOT an email. It is a key in the
// ADMIN_ROLES environment allowlist, and lib/adminRoles.ts already refuses a
// key with surrounding space, a reserved prototype name, or a case-duplicate.
// The schema enforces the same shape at the payload boundary so a malformed
// name is refused before it reaches a query, not after.
const adminUsername = z
  .string()
  .trim()
  .min(1, 'An admin username is required')
  .max(64, 'An admin username is at most 64 characters')
  .regex(/^\S+$/, 'An admin username contains no whitespace')
  .refine(
    (value) => value !== '__proto__' && value !== 'constructor' && value !== 'prototype',
    { message: 'That username is reserved' },
  );

/**
 * The four role names, duplicated nowhere: apps/admin asserts this list equals
 * ADMIN_ROLE_NAMES, so the two cannot drift.
 */
export const ADMIN_ROLE_NAME_VALUES = ['super_admin', 'billing', 'support', 'read_only'] as const;

export const adminRoleSchema = z.enum(ADMIN_ROLE_NAME_VALUES);

/**
 * Narrowing a role, and enabling or disabling the account, are one payload
 * because they are one row and one audited decision.
 */
export const adminRoleAssignmentUpdateSchema = z.object({
  username: adminUsername,
  role: adminRoleSchema,
  isActive: z.boolean(),
});

export const adminSessionRevocationSchema = z.object({
  username: adminUsername,
});

export type AdminRoleAssignmentUpdate = z.infer<typeof adminRoleAssignmentUpdateSchema>;
export type AdminSessionRevocation = z.infer<typeof adminSessionRevocationSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// The id-only write payloads.
//
// Batch 3 §8.13, round-3 finding 47: the two RETAINED write actions validated
// their UUID with apps/admin's own `isUuid` — hand-written, not a shared
// schema — which contradicts the rule that every write payload goes through
// packages/validation. `isUuid` itself stays, because route params and
// drill-down ids go through it on READ paths where no write payload exists.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A v1–v5 UUID with an RFC-4122 variant, matching apps/admin's `isUuid`
 * exactly. Zod's own `z.string().uuid()` accepts the nil UUID and any variant
 * nibble, so it is NOT the same predicate, and a write payload validated more
 * loosely than the read path would be a gap rather than a safeguard.
 */
const adminUuid = z
  .string()
  .trim()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    'That is not a valid id',
  );

export const adminAccountIdActionSchema = z.object({ accountId: adminUuid });
export const adminPaymentOrderIdActionSchema = z.object({ orderId: adminUuid });

export type AdminAccountIdAction = z.infer<typeof adminAccountIdActionSchema>;
export type AdminPaymentOrderIdAction = z.infer<typeof adminPaymentOrderIdActionSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Support (§8.7)
// ─────────────────────────────────────────────────────────────────────────────

// THESE THREE LISTS ARE THE MIGRATION'S CHECK CONSTRAINTS, TRANSCRIBED.
// 20261023000000_e4_batch3_admin_platform.sql:176-193 fixes the value space,
// plan §3.4 specifies it identically, and that migration is hash-recorded in
// the E4 evidence manifest — so it is the source of truth and this file is the
// transcription. A schema accepting a value the CHECK refuses is not a
// safeguard; it is a form that passes validation and then fails at the
// database, which is the one failure mode a shared schema exists to prevent.
export const ADMIN_SUPPORT_STATUS_VALUES = ['open', 'pending', 'resolved', 'closed'] as const;
export const ADMIN_SUPPORT_PRIORITY_VALUES = ['low', 'normal', 'high', 'urgent'] as const;
export const ADMIN_SUPPORT_CATEGORY_VALUES = [
  'onboarding',
  'sync',
  'payment',
  'data',
  'device',
  'account',
  'other',
] as const;

export const adminSupportStatusSchema = z.enum(ADMIN_SUPPORT_STATUS_VALUES);
export const adminSupportPrioritySchema = z.enum(ADMIN_SUPPORT_PRIORITY_VALUES);
export const adminSupportCategorySchema = z.enum(ADMIN_SUPPORT_CATEGORY_VALUES);

/**
 * Free text a support admin types. Bounded, because an unbounded text column
 * reachable from a form is a storage-exhaustion surface.
 *
 * The bounds are the CHECK constraints' bounds exactly — 2000 for a summary,
 * 8000 for a note. A TIGHTER app-level cap would look harmless and is not: the
 * panel renders a stored 2000-character summary into an edit form, so a 500-cap
 * would refuse a payload that changed one word of a row the database already
 * holds, and the operator would have no way to save it.
 */
const supportSummary = z.string().trim().min(1, 'A summary is required').max(2_000);
const supportBody = z.string().trim().min(1, 'A note cannot be empty').max(8_000);

export const adminSupportCaseCreateSchema = z.object({
  // REQUIRED, because `shop_id uuid not null` is. Every case is about a shop;
  // a nullable field here would accept a platform-wide case the table refuses
  // to store.
  shopId: adminUuid,
  category: adminSupportCategorySchema,
  priority: adminSupportPrioritySchema,
  summary: supportSummary,
});

export const adminSupportCaseUpdateSchema = z.object({
  caseId: adminUuid,
  status: adminSupportStatusSchema,
  priority: adminSupportPrioritySchema,
  // An unassigned case is a real state, so null is allowed and '' becomes null.
  assignee: z
    .string()
    .trim()
    .max(64)
    .regex(/^\S*$/, 'An assignee contains no whitespace')
    .nullish()
    .transform((value) => (value === undefined || value === null || value === '' ? null : value)),
  summary: supportSummary,
});

export const adminSupportNoteCreateSchema = z.object({
  caseId: adminUuid,
  body: supportBody,
});

export type AdminSupportCaseCreate = z.infer<typeof adminSupportCaseCreateSchema>;
export type AdminSupportCaseUpdate = z.infer<typeof adminSupportCaseUpdateSchema>;
export type AdminSupportNoteCreate = z.infer<typeof adminSupportNoteCreateSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Settings (§8.11)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The six keys, and only these six. The three feature flags are editable
 * because a real server-side consumer reads them; the three notification
 * templates are NOT writable at all — no admin notification dispatcher exists
 * anywhere in the product, so a form that accepted one would be a save button
 * with nothing behind it.
 */
// Again the migration's own CHECK, transcribed:
// 20261023000000_e4_batch3_admin_platform.sql:246-254.
export const ADMIN_SETTING_KEYS = [
  'flag.analytics_enabled',
  'flag.maps_enabled',
  'flag.reports_pdf_enabled',
  'notification.template.trial_ending',
  'notification.template.payment_failed',
  'notification.template.subscription_expired',
] as const;

export const ADMIN_WRITABLE_SETTING_KEYS = [
  'flag.analytics_enabled',
  'flag.maps_enabled',
  'flag.reports_pdf_enabled',
] as const;

export const adminSettingUpdateSchema = z.object({
  key: z.enum(ADMIN_WRITABLE_SETTING_KEYS),
  // Every writable key is a flag, so the value space is a boolean and nothing
  // else. The string 'false' must NOT read as true.
  value: z.boolean(),
});

export type AdminSettingUpdate = z.infer<typeof adminSettingUpdateSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Query shapes (§8.2, §8.10)
// ─────────────────────────────────────────────────────────────────────────────

export const ADMIN_REPORT_IDS = [
  'pharmacy_registrations',
  'subscriptions',
  'subscription_revenue_and_renewals',
  'plan_distribution',
  'activity_summary',
  'refund_net_pharmacy_sales',
] as const;

export const ADMIN_EXPORT_FORMATS = ['csv', 'pdf'] as const;

/**
 * A calendar day, not a timestamp: every report range is a Dhaka day range.
 *
 * The shape check alone was not enough. `/^\d{4}-\d{2}-\d{2}$/` accepts
 * `2026-13-01` and `2026-02-31`, which then reached Postgres as a `date`
 * literal and came back as a query error — so the operator was told "could not
 * load data" when the truth was "that is not a date". Found while writing the
 * range tests for Gate 5 finding 7.
 *
 * The refine round-trips the value through `Date.UTC` and compares: a real day
 * normalises to itself, and 13 as a month does not.
 */
const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date')
  .refine((value) => {
    const [year, month, day] = value.split('-').map(Number) as [number, number, number];
    const at = new Date(Date.UTC(year, month - 1, day));
    return (
      at.getUTCFullYear() === year && at.getUTCMonth() === month - 1 && at.getUTCDate() === day
    );
  }, 'That is not a real calendar date');

/** The widest range any report may cover (§8.5's 400-day analytics cap). */
export const ADMIN_MAX_RANGE_DAYS = 400;

function rangeIsSane(value: { from?: string; to?: string }): boolean {
  if (value.from === undefined || value.to === undefined) return true;
  if (value.from > value.to) return false;
  const days = (Date.parse(value.to + 'T00:00:00Z') - Date.parse(value.from + 'T00:00:00Z'))
    / 86_400_000;
  return Number.isFinite(days) && days <= ADMIN_MAX_RANGE_DAYS;
}

export const adminReportExportQuerySchema = z.object({
  reportId: z.enum(ADMIN_REPORT_IDS),
  format: z.enum(ADMIN_EXPORT_FORMATS),
  from: isoDate.optional(),
  to: isoDate.optional(),
  status: z.string().trim().max(32).regex(/^[a-z_]*$/, 'Not a valid status').optional(),
}).refine(rangeIsSane, { message: 'That date range is not valid' });

/** The maximum page size a list query may ask for. */
export const ADMIN_MAX_PAGE_SIZE = 100;

export const adminListQuerySchema = z.object({
  // Search text is bounded and passed as a bound value; the query layer escapes
  // the LIKE metacharacters. The length cap is what stops an unbounded ilike
  // pattern becoming a query-cost surface.
  search: z.string().trim().max(120).optional(),
  district: z.string().trim().max(64).optional(),
  plan: z.string().trim().max(32).regex(/^[a-z_]*$/, 'Not a valid plan').optional(),
  status: z.string().trim().max(32).regex(/^[a-z_]*$/, 'Not a valid status').optional(),
  // Batch 3 §8.3's billing-cycle filter. The same shape as `plan` and `status`
  // — bounded, lowercase, and an EQUALITY value the query layer binds rather
  // than a pattern, so no metacharacter is in play. Deliberately NOT a
  // `z.enum`: `billing_cycle` is CHECK-constrained in Postgres, and an enum
  // here would be a fourth copy of that list to keep in step. An unknown cycle
  // matches nothing, which is the honest answer to a stale bookmark.
  cycle: z.string().trim().max(32).regex(/^[a-z_]*$/, 'Not a valid billing cycle').optional(),
  // Batch 3 §8.9a's audit action filter. DOTS ARE THE POINT: action names are
  // dotted namespaces (`authz.denied`, `session.role_revoked`,
  // `settings.updated`), and the Audit page offers the namespace prefix as the
  // filter value. This previously rode on `plan`, whose `/^[a-z_]*$/` rejects a
  // dot — so every generated option except the dotless `login` was refused and
  // the filter reported "not valid" instead of filtering. A bounded field of
  // its own, matched as a PREFIX by the page.
  action: z
    .string()
    .trim()
    .max(64)
    .regex(/^[a-z_.]*$/, 'Not a valid action')
    .optional(),
  sort: z.enum(['registered_desc', 'registered_asc', 'activity_desc', 'activity_asc']).optional(),
  // coerce, because searchParams values are strings. The bounds are what stop a
  // page number from becoming an unbounded .range() offset.
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(ADMIN_MAX_PAGE_SIZE).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
}).refine(rangeIsSane, { message: 'That date range is not valid' });

export type AdminReportExportQuery = z.infer<typeof adminReportExportQuerySchema>;
export type AdminListQuery = z.infer<typeof adminListQuerySchema>;
