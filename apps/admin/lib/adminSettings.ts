import 'server-only';

// Batch 3 §8.11 — platform settings: the key allowlist, the feature flags that
// are genuinely consumed, and the environment panel that shows names only.
//
// This is the ONLY module that reads or writes `admin_platform_settings`, and
// §8.12's write manifest names it as such. lib/adminSettingsActions.ts is the
// authorized surface: it checks `settings.write`, parses the shared schema,
// audits, and calls down to here.
//
// THE SIX KEYS ARE ENUMERATED HERE AS WELL AS IN THREE OTHER PLACES, and that
// is deliberate, not duplication:
//
//   1. the migration's CHECK constraint — the database's own refusal;
//   2. packages/validation's ADMIN_SETTING_KEYS — the write payload's refusal;
//   3. lib/adminAudit.ts's AUDITABLE_SETTING_KEYS — the audit log's refusal;
//   4. this file — the reader's view of what exists.
//
// adminSettings.test.ts asserts all four are the same list, PARSING THE SQL for
// the first. Revision 5's own schemas had already drifted from the migration on
// three of these names and nothing caught it, because every copy that existed
// was compared only against another copy.
//
// ONLY SETTINGS WITH A REAL CONSUMER ARE EDITABLE. The three `flag.*` keys are
// read by the Analytics, Maps and Reports-PDF routes themselves. The three
// `notification.template.*` keys are stored and rendered READ-ONLY, because no
// admin notification dispatcher exists anywhere in the product — a save button
// behind which nothing reads the value is a placeholder wearing a feature's
// clothes. The shared schema refuses them, and so does this module's writer.

import { MAP_TILE_URL_ENV } from './adminGeo';
import { ACCOUNTS_ENV_NAMES, accountsEnvDiagnostics } from './adminIdentity';
import { SESSION_ENV_NAMES, sessionEnvDiagnostics } from './adminSession';
import { SUPABASE_ENV_NAMES, supabaseEnvDiagnostics } from './env';
import { AdminDataError } from './errors';
import { getSupabaseAdmin } from './supabaseAdmin';
import { readAllPages } from './queries';

/** The three editable flags, in the migration's own spelling. */
export const ADMIN_FEATURE_FLAG_KEYS = [
  'flag.analytics_enabled',
  'flag.maps_enabled',
  'flag.reports_pdf_enabled',
] as const;

/** The three stored-but-unconsumed templates. */
export const ADMIN_NOTIFICATION_TEMPLATE_KEYS = [
  'notification.template.trial_ending',
  'notification.template.payment_failed',
  'notification.template.subscription_expired',
] as const;

/** All six, in the order the page renders them. */
export const ADMIN_SETTINGS_KEYS = [
  ...ADMIN_FEATURE_FLAG_KEYS,
  ...ADMIN_NOTIFICATION_TEMPLATE_KEYS,
] as const;

export type AdminFeatureFlagKey = (typeof ADMIN_FEATURE_FLAG_KEYS)[number];
export type AdminSettingKey = (typeof ADMIN_SETTINGS_KEYS)[number];

export function isAdminFeatureFlagKey(value: unknown): value is AdminFeatureFlagKey {
  return (
    typeof value === 'string' && (ADMIN_FEATURE_FLAG_KEYS as readonly string[]).includes(value)
  );
}

/**
 * Why a template cannot be edited, rendered beside the disabled form.
 *
 * The page states the reason rather than greying a control out silently: a
 * disabled field with no explanation reads as a permissions problem, and an
 * operator would go asking for a permission that would not help.
 */
export const NOTIFICATION_TEMPLATE_UNAVAILABLE_REASON =
  'Not yet consumed — no admin notification dispatch exists anywhere in the '
  + 'product, so this text is stored and shown but never sent. Editing is '
  + 'disabled rather than offered, because a save with nothing behind it is '
  + 'worse than no control at all.';

/**
 * The default text each template shows when no row exists.
 *
 * Defaults rather than an empty state, because the page's job here is to show
 * what WOULD be sent if a dispatcher existed, and a blank box shows nothing.
 */
export const NOTIFICATION_TEMPLATE_DEFAULTS: ReadonlyMap<string, string> = new Map([
  [
    'notification.template.trial_ending',
    'Your Muthoy trial ends on {date}. Subscribe to keep premium features.',
  ],
  [
    'notification.template.payment_failed',
    'We could not verify your payment for {tier}. Your access continues until {date}.',
  ],
  [
    'notification.template.subscription_expired',
    'Your Muthoy {tier} subscription expired on {date}. Renew to restore premium features.',
  ],
]);

// ─────────────────────────────────────────────────────────────────── reading

/** The service-role surface this module needs. Injected whole in tests. */
export type AdminSettingsClient = Pick<ReturnType<typeof getSupabaseAdmin>, 'from'>;

export interface AdminSettingsDeps {
  client?: AdminSettingsClient;
  now?: () => Date;
  /** The environment the diagnostics panel reports on. */
  env?: Record<string, string | undefined>;
}

function clientFor(deps: AdminSettingsDeps | undefined): AdminSettingsClient {
  return deps?.client ?? getSupabaseAdmin();
}

export interface AdminSettingRow {
  key: AdminSettingKey;
  value: unknown;
  updatedBy: string;
  updatedAt: string;
}

export const ADMIN_SETTING_COLUMNS = 'key,value,updated_by,updated_at';

/**
 * Every stored setting, keyed.
 *
 * A key outside the six is DROPPED rather than returned. The CHECK constraint
 * makes one unreachable through the database, so a row carrying one did not
 * come from that table — and surfacing it would put an unrecognised key in
 * front of an operator as though it were configuration.
 */
export async function readSettings(
  deps?: AdminSettingsDeps,
): Promise<ReadonlyMap<AdminSettingKey, AdminSettingRow>> {
  const client = clientFor(deps);
  // An omitted false flag looks like an absent row and defaults to enabled,
  // so even this six-key table must exhaust a capped response before deciding.
  const data = await readAllPages<Record<string, unknown>>('platform settings', (from, to) =>
    client.from('admin_platform_settings')
      .select(ADMIN_SETTING_COLUMNS)
      .order('key', { ascending: true })
      .range(from, to),
  );

  const rows = new Map<AdminSettingKey, AdminSettingRow>();
  for (const raw of data ?? []) {
    const row = raw as Record<string, unknown>;
    const key = row.key;
    if (typeof key !== 'string') continue;
    if (!(ADMIN_SETTINGS_KEYS as readonly string[]).includes(key)) continue;
    rows.set(key as AdminSettingKey, {
      key: key as AdminSettingKey,
      value: row.value,
      updatedBy: typeof row.updated_by === 'string' ? row.updated_by : '',
      updatedAt: typeof row.updated_at === 'string' ? row.updated_at : '',
    });
  }
  return rows;
}

/**
 * THREE values, not a boolean. The distinction is the whole point.
 *
 *   enabled   a row says true, or no row exists at all;
 *   disabled  a row says false;
 *   unknown   the store could not be read, or the row's value is not a boolean.
 */
export type FeatureState = 'enabled' | 'disabled' | 'unknown';

/**
 * NO ROW MEANS ENABLED. Absence of configuration is not a decision to turn a
 * feature off: a fresh deployment has an empty settings table, and defaulting
 * to disabled would present three deliberately-built pages as switched off
 * with no record of anyone having switched them.
 *
 * A NON-BOOLEAN VALUE IS `unknown`, NOT a guess. A jsonb value that is neither
 * `true` nor `false` is a row this product did not write, and deciding which
 * way it was meant would be deciding about a control on no evidence.
 */
export function featureStateFromRow(row: AdminSettingRow | undefined): FeatureState {
  if (row === undefined) return 'enabled';
  if (row.value === true) return 'enabled';
  if (row.value === false) return 'disabled';
  return 'unknown';
}

/**
 * AN UNREADABLE STORE IS `unknown`, NOT `disabled`. Silently disabling on a
 * transient database error would send an operator to Settings to turn on a
 * feature that is already on, and the real fault — the database — would go
 * unreported. The route renders an error state for `unknown`.
 */
export async function featureState(
  key: AdminFeatureFlagKey,
  deps?: AdminSettingsDeps,
): Promise<FeatureState> {
  try {
    const settings = await readSettings(deps);
    return featureStateFromRow(settings.get(key));
  } catch (error: unknown) {
    console.error('[admin] feature flag read failed for ' + key + ':', error);
    return 'unknown';
  }
}

/**
 * The convenience the routes call. TRUE only for a definite `enabled`.
 *
 * `unknown` is false here, so a caller that only wants a boolean fails toward
 * not rendering the feature. A caller that needs to tell an operator WHY asks
 * `featureState` instead, and the three pages that gate on a flag all do.
 */
export async function isFeatureEnabled(
  key: AdminFeatureFlagKey,
  deps?: AdminSettingsDeps,
): Promise<boolean> {
  return (await featureState(key, deps)) === 'enabled';
}

// ─────────────────────────────────────────────────────────────────── writing

export type SettingWriteEffect = 'created' | 'updated';

export interface SettingWrite {
  key: AdminFeatureFlagKey;
  value: boolean;
  /** The acting admin. Recorded on the row as well as in the audit log. */
  updatedBy: string;
}

/**
 * Creates or updates one flag row. The ONLY writer of this table.
 *
 * NO UPSERT, for the same reason lib/adminIdentityStore.ts avoids one:
 * PostgREST's upsert is `insert ... on conflict do update` over the SAME column
 * list, so the conflict path would attempt to set `key` — and `key` is excluded
 * from the column-level update grant (§3.4), so the write would be refused. It
 * reads, then inserts or updates, which is also the only shape that can tell
 * the audit entry whether a flag was created or changed.
 *
 * A NON-FLAG KEY IS REFUSED HERE TOO, not only by the schema. The shared schema
 * is the payload boundary and this is the table boundary; a template key
 * reaching this function means something bypassed the action surface, and that
 * is exactly when the second refusal matters.
 */
export async function writeSetting(
  input: SettingWrite,
  deps?: AdminSettingsDeps,
): Promise<SettingWriteEffect> {
  if (!isAdminFeatureFlagKey(input.key)) {
    throw new AdminDataError('that platform setting is not editable');
  }

  const client = clientFor(deps);
  const nowIso = (deps?.now?.() ?? new Date()).toISOString();
  const existing = await readSettings(deps);

  if (!existing.has(input.key)) {
    const { error } = await client.from('admin_platform_settings').insert({
      key: input.key,
      value: input.value,
      updated_by: input.updatedBy,
      updated_at: nowIso,
    });
    if (error) {
      console.error('[admin] admin_platform_settings insert failed:', error.message);
      throw new AdminDataError('platform setting write failed');
    }
    return 'created';
  }

  // Exactly the three columns the grant permits.
  const { error } = await client
    .from('admin_platform_settings')
    .update({ value: input.value, updated_by: input.updatedBy, updated_at: nowIso })
    .eq('key', input.key);
  if (error) {
    console.error('[admin] admin_platform_settings update failed:', error.message);
    throw new AdminDataError('platform setting write failed');
  }
  return 'updated';
}

// ───────────────────────────────────────── environment diagnostics (read-only)

export interface EnvironmentDiagnostic {
  name: string;
  isSet: boolean;
}

/**
 * The variables THIS module owns. Everything else is reported by its owner.
 *
 * `ADMIN_MAP_TILE_URL` is not a secret and nothing else reads it, so it is
 * named here. The three secrets are NOT: serviceRoleExposure.test.ts asserts
 * that `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_SESSION_SECRET` and `ADMIN_ACCOUNTS`
 * each appear in exactly ONE module's source, and that containment is the guard
 * against a second reader. A settings module naming them in order to check
 * whether they were set would be exactly that second reader — so lib/env.ts,
 * lib/adminSession.ts and lib/adminIdentity.ts each report their own presence,
 * and this module composes the answers without ever naming a secret.
 */
const OWN_DIAGNOSTIC_ENV_NAMES = [MAP_TILE_URL_ENV] as const;

/**
 * Every name the panel reports on, in render order.
 *
 * Derived from the owners rather than re-listed, so adding a variable to an
 * owner cannot leave the panel silently out of date.
 */
export const DIAGNOSTIC_ENV_NAMES: readonly string[] = [
  ...SUPABASE_ENV_NAMES,
  ...SESSION_ENV_NAMES,
  ...ACCOUNTS_ENV_NAMES,
  ...OWN_DIAGNOSTIC_ENV_NAMES,
];

/**
 * Presence, never content.
 *
 * Every entry carries a NAME and a BOOLEAN. There is no field a value could be
 * put in, which is stronger than remembering not to put one there — the page
 * cannot render a secret it was never handed.
 */
export function environmentDiagnostics(deps?: AdminSettingsDeps): readonly EnvironmentDiagnostic[] {
  const env = deps?.env ?? process.env;
  return [
    ...supabaseEnvDiagnostics(env),
    ...sessionEnvDiagnostics(env),
    ...accountsEnvDiagnostics(env),
    ...OWN_DIAGNOSTIC_ENV_NAMES.map((name) => ({
      name,
      isSet: (env[name] ?? '').trim().length > 0,
    })),
  ];
}

// ──────────────────────────────────────────────────────────── the page's view

export interface FeatureFlagView {
  key: AdminFeatureFlagKey;
  state: FeatureState;
  updatedBy: string | null;
  updatedAt: string | null;
}

export interface NotificationTemplateView {
  key: string;
  text: string;
  /** Always true. The field exists so the form cannot forget to ask. */
  isReadOnly: true;
  reason: string;
}

export interface AdminSettingsView {
  flags: readonly FeatureFlagView[];
  templates: readonly NotificationTemplateView[];
  environment: readonly EnvironmentDiagnostic[];
}

/** Everything the Settings page renders, in one read. */
export async function settingsView(deps?: AdminSettingsDeps): Promise<AdminSettingsView> {
  const settings = await readSettings(deps);

  return {
    flags: ADMIN_FEATURE_FLAG_KEYS.map((key) => {
      const row = settings.get(key);
      return {
        key,
        state: featureStateFromRow(row),
        updatedBy: row?.updatedBy ?? null,
        updatedAt: row?.updatedAt ?? null,
      };
    }),
    templates: ADMIN_NOTIFICATION_TEMPLATE_KEYS.map((key) => {
      const stored = settings.get(key)?.value;
      return {
        key,
        text: typeof stored === 'string' ? stored : (NOTIFICATION_TEMPLATE_DEFAULTS.get(key) ?? ''),
        isReadOnly: true as const,
        reason: NOTIFICATION_TEMPLATE_UNAVAILABLE_REASON,
      };
    }),
    environment: environmentDiagnostics(deps),
  };
}
