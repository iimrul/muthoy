// Batch 3 §8.11 — the settings store, the flag states, the read-only
// templates, the environment panel, and the authorized write.
//
// THE KEY LIST IS COMPARED AGAINST THE MIGRATION, NOT AGAINST ANOTHER COPY.
// §8.11 asks for the six keys in three places with a test that they are
// identical. Three TypeScript copies compared to each other is what revision 5
// already had — and all three had drifted from the migration's CHECK constraint
// together, so the test passed while the panel would have written a key the
// database refuses. So the SQL is parsed and treated as the source.
//
// THE FLAG IS THREE-VALUED, and each value has to come from a different cause:
// a row saying false is `disabled`, no row is `enabled`, and an unreadable
// store is `unknown`. Collapsing the last two into a boolean is what makes a
// database outage look like a feature somebody switched off.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const cookieStore = vi.hoisted(() => ({ value: undefined as string | undefined }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'muthoy_admin_session' && cookieStore.value !== undefined
        ? { name, value: cookieStore.value }
        : undefined,
  }),
}));

const { AUDITABLE_SETTING_KEYS, recentAdminAudit } = await import('./adminAudit');
const { newSessionPayload, signAdminSession } = await import('./adminSession');
const {
  ADMIN_FEATURE_FLAG_KEYS,
  ADMIN_NOTIFICATION_TEMPLATE_KEYS,
  ADMIN_SETTINGS_KEYS,
  DIAGNOSTIC_ENV_NAMES,
  NOTIFICATION_TEMPLATE_UNAVAILABLE_REASON,
  environmentDiagnostics,
  featureState,
  featureStateFromRow,
  isAdminFeatureFlagKey,
  isFeatureEnabled,
  readSettings,
  settingsView,
  writeSetting,
} = await import('./adminSettings');
const { setPlatformFeatureFlag } = await import('./adminSettingsActions');
const { ADMIN_SETTING_KEYS, ADMIN_WRITABLE_SETTING_KEYS } = await import('@muthoy/validation');

type Role = 'super_admin' | 'billing' | 'support' | 'read_only';

const SECRET = 'a'.repeat(32);
const NOW = new Date('2026-10-25T06:00:00.000Z');
const MIGRATION = join(
  process.cwd(),
  'backend/supabase/migrations/20261023000000_e4_batch3_admin_platform.sql',
);

function envFor(roles: Record<string, Role>): Record<string, string> {
  return { ADMIN_SESSION_SECRET: SECRET, ADMIN_ROLES: JSON.stringify(roles) };
}

async function signInAs(username: string, role: Role): Promise<void> {
  cookieStore.value = await signAdminSession(
    newSessionPayload({ sub: username, role, epoch: 0, now: Date.now() }),
    SECRET,
  );
}

function settingRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    key: 'flag.maps_enabled',
    value: false,
    updated_by: 'admin-a',
    updated_at: '2026-10-25T00:00:00.000Z',
    ...overrides,
  };
}

interface ClientCall {
  op: 'select' | 'insert' | 'update';
  table: string;
  values?: Record<string, unknown>;
  filters: { method: string; args: unknown[] }[];
}

/** The same PostgREST-shaped fake as the identity store's, narrowed the same way. */
function createClient(
  options: { rows?: Record<string, unknown>[]; selectError?: string; writeError?: string; responseCap?: number } = {},
) {
  const calls: ClientCall[] = [];
  const rows = options.rows ?? [];

  const result = () =>
    options.selectError === undefined
      ? { data: rows, error: null }
      : { data: null, error: { message: options.selectError } };
  const writeResult = () =>
    options.writeError === undefined
      ? { data: null, error: null }
      : { data: null, error: { message: options.writeError } };

  const client = {
    from(table: string) {
      return {
        select(columns: string) {
          const call: ClientCall = {
            op: 'select',
            table,
            filters: [{ method: 'select', args: [columns] }],
          };
          calls.push(call);
          const chain: Record<string, unknown> = {
            range: (...args: unknown[]) => {
              call.filters.push({ method: 'range', args });
              const response = result();
              const [from, to] = args as [number, number];
              return Promise.resolve({
                ...response,
                data: response.data?.slice(from, Math.min(to + 1, from + (options.responseCap ?? Infinity))) ?? null,
              });
            },
            limit: (...args: unknown[]) => {
              call.filters.push({ method: 'limit', args });
              return Promise.resolve(result());
            },
          };
          for (const method of ['eq', 'order']) {
            chain[method] = (...args: unknown[]) => {
              call.filters.push({ method, args });
              return chain;
            };
          }
          return chain;
        },
        insert(values: Record<string, unknown>) {
          calls.push({ op: 'insert', table, values, filters: [] });
          return Promise.resolve(writeResult());
        },
        update(values: Record<string, unknown>) {
          const call: ClientCall = { op: 'update', table, values, filters: [] };
          calls.push(call);
          return {
            eq: (...args: unknown[]) => {
              call.filters.push({ method: 'eq', args });
              return Promise.resolve(writeResult());
            },
          };
        },
      };
    },
  };

  return { client: client as never, calls };
}

beforeEach(() => {
  cookieStore.value = undefined;
  recentAdminAudit.clear();
});

describe('the six keys do not drift from the migration', () => {
  /** The CHECK constraint's own list, read out of the SQL. */
  function migrationSettingKeys(): string[] {
    const sql = readFileSync(MIGRATION, 'utf8');
    const table = sql.slice(
      sql.indexOf('create table if not exists public.admin_platform_settings'),
    );
    const check = table.slice(table.indexOf('key in ('), table.indexOf('))'));
    return [...check.matchAll(/'([^']+)'/g)].map((match) => match[1] ?? '');
  }

  test('the migration really does constrain the key column', () => {
    // If this fails, the parse above is reading the wrong thing and every
    // assertion below would be vacuously true.
    expect(migrationSettingKeys()).toHaveLength(6);
  });

  test('this module names exactly the migration’s six keys', () => {
    expect([...ADMIN_SETTINGS_KEYS].sort()).toEqual(migrationSettingKeys().sort());
  });

  test('the shared schema names exactly the migration’s six keys', () => {
    expect([...ADMIN_SETTING_KEYS].sort()).toEqual(migrationSettingKeys().sort());
  });

  test('the audit allowlist names exactly the migration’s six keys', () => {
    expect([...AUDITABLE_SETTING_KEYS].sort()).toEqual(migrationSettingKeys().sort());
  });

  test('the three WRITABLE keys are the three flags, and nothing else', () => {
    expect([...ADMIN_WRITABLE_SETTING_KEYS].sort()).toEqual([...ADMIN_FEATURE_FLAG_KEYS].sort());
  });

  test('flags and templates partition the six — no key is in both or neither', () => {
    expect(ADMIN_FEATURE_FLAG_KEYS).toHaveLength(3);
    expect(ADMIN_NOTIFICATION_TEMPLATE_KEYS).toHaveLength(3);
    expect(new Set(ADMIN_SETTINGS_KEYS).size).toBe(6);
  });

  test('a template key is not a flag key', () => {
    for (const key of ADMIN_NOTIFICATION_TEMPLATE_KEYS) {
      expect(isAdminFeatureFlagKey(key)).toBe(false);
    }
    for (const key of ADMIN_FEATURE_FLAG_KEYS) {
      expect(isAdminFeatureFlagKey(key)).toBe(true);
    }
  });
});

describe('the flag state is three-valued', () => {
  function row(value: unknown) {
    return {
      key: 'flag.maps_enabled' as const,
      value,
      updatedBy: 'admin-a',
      updatedAt: '2026-10-25T00:00:00.000Z',
    };
  }

  test('NO ROW is enabled — absence of configuration is not a decision', () => {
    expect(featureStateFromRow(undefined)).toBe('enabled');
  });

  test('a row saying false is disabled', () => {
    expect(featureStateFromRow(row(false))).toBe('disabled');
  });

  test('a row saying true is enabled', () => {
    expect(featureStateFromRow(row(true))).toBe('enabled');
  });

  test.each([
    ['the STRING "false"', 'false'],
    ['the number 0', 0],
    ['null', null],
    ['an object', {}],
  ])('%s is unknown, not a guess', (_label, value) => {
    expect(featureStateFromRow(row(value))).toBe('unknown');
  });

  test('an UNREADABLE store is unknown, not disabled', async () => {
    const { client } = createClient({ selectError: 'connection refused' });

    // Reported as unknown so the page shows an error rather than telling an
    // operator to switch on a feature that was never switched off.
    await expect(featureState('flag.maps_enabled', { client })).resolves.toBe('unknown');
  });

  test('isFeatureEnabled is false for unknown, so a boolean caller fails safe', async () => {
    const { client } = createClient({ selectError: 'connection refused' });

    await expect(isFeatureEnabled('flag.maps_enabled', { client })).resolves.toBe(false);
  });

  test('isFeatureEnabled is TRUE on an empty table, so a fresh deploy works', async () => {
    const { client } = createClient({ rows: [] });

    await expect(isFeatureEnabled('flag.analytics_enabled', { client })).resolves.toBe(true);
  });
});

describe('reading the settings', () => {
  test('a capped response cannot turn a stored disabled flag back on', async () => {
    const { client } = createClient({
      responseCap: 1,
      rows: [
        settingRow({ key: 'flag.analytics_enabled', value: true }),
        settingRow({ key: 'flag.maps_enabled', value: false }),
        settingRow({ key: 'flag.reports_pdf_enabled', value: false }),
      ],
    });
    expect((await readSettings({ client })).size).toBe(3);
    expect(await featureState('flag.maps_enabled', { client })).toBe('disabled');
    expect(await featureState('flag.reports_pdf_enabled', { client })).toBe('disabled');
  });

  test('saving a flag omitted from the first capped page updates its existing row', async () => {
    const { client, calls } = createClient({
      responseCap: 1,
      rows: [
        settingRow({ key: 'flag.analytics_enabled', value: true }),
        settingRow({ key: 'flag.maps_enabled', value: false }),
      ],
    });
    expect(await writeSetting(
      { key: 'flag.maps_enabled', value: true, updatedBy: 'founder' }, { client },
    )).toBe('updated');
    expect(calls.filter((call) => call.op === 'insert')).toEqual([]);
    expect(calls.find((call) => call.op === 'update')?.filters).toEqual([
      { method: 'eq', args: ['key', 'flag.maps_enabled'] },
    ]);
  });

  test('a key outside the six is dropped, not surfaced as configuration', async () => {
    const { client } = createClient({
      rows: [settingRow(), settingRow({ key: 'flag.something_else', value: true })],
    });

    const settings = await readSettings({ client });

    expect([...settings.keys()]).toEqual(['flag.maps_enabled']);
  });

  test('a read failure THROWS rather than reporting an empty settings table', async () => {
    const { client } = createClient({ selectError: 'connection refused' });

    await expect(readSettings({ client })).rejects.toThrow();
  });
});

describe('the templates are read-only', () => {
  test('every template carries isReadOnly and the reason', async () => {
    const { client } = createClient({ rows: [] });

    const view = await settingsView({ client, env: {} });

    expect(view.templates).toHaveLength(3);
    for (const template of view.templates) {
      expect(template.isReadOnly).toBe(true);
      expect(template.reason).toBe(NOTIFICATION_TEMPLATE_UNAVAILABLE_REASON);
      expect(template.text.length).toBeGreaterThan(0);
    }
  });

  test('the reason says no dispatcher exists, so the form is not a permissions puzzle', () => {
    expect(NOTIFICATION_TEMPLATE_UNAVAILABLE_REASON).toContain('no admin notification dispatch');
  });

  test('a stored template text is shown in place of the default', async () => {
    const { client } = createClient({
      rows: [settingRow({ key: 'notification.template.trial_ending', value: 'Custom text' })],
    });

    const view = await settingsView({ client, env: {} });
    const trial = view.templates.find((t) => t.key === 'notification.template.trial_ending');

    expect(trial?.text).toBe('Custom text');
  });

  test('writeSetting REFUSES a template key at the table boundary too', async () => {
    const { client, calls } = createClient({ rows: [] });

    await expect(
      writeSetting(
        // Cast past the type, because the point is the RUNTIME refusal: the
        // type already forbids this, and a caller bypassing the action surface
        // would not have been type-checked against it.
        { key: 'notification.template.trial_ending' as never, value: true, updatedBy: 'a' },
        { client },
      ),
    ).rejects.toThrow();

    expect(calls).toEqual([]);
  });
});

describe('the environment panel shows names, never values', () => {
  test('a set variable reports isSet without carrying its value', () => {
    const diagnostics = environmentDiagnostics({
      env: { SUPABASE_SERVICE_ROLE_KEY: 'super-secret-value' },
    });
    const entry = diagnostics.find((d) => d.name === 'SUPABASE_SERVICE_ROLE_KEY');

    expect(entry?.isSet).toBe(true);
    // The whole structure, serialised: the secret must appear nowhere in it.
    expect(JSON.stringify(diagnostics)).not.toContain('super-secret-value');
  });

  test('an unset or whitespace variable reports not set', () => {
    const diagnostics = environmentDiagnostics({ env: { SUPABASE_URL: '   ' } });

    expect(diagnostics.find((d) => d.name === 'SUPABASE_URL')?.isSet).toBe(false);
  });

  test('every diagnostic carries exactly two fields, so there is nowhere to leak', () => {
    for (const entry of environmentDiagnostics({ env: {} })) {
      expect(Object.keys(entry).sort()).toEqual(['isSet', 'name']);
    }
  });

  test('the name list is FIXED, so the panel cannot become an env dump', () => {
    const diagnostics = environmentDiagnostics({ env: { SOMETHING_NEW: 'value' } });

    expect(diagnostics.map((d) => d.name)).toEqual([...DIAGNOSTIC_ENV_NAMES]);
  });
});

describe('the authorized write', () => {
  function deps(client: never, roles: Record<string, Role>) {
    return {
      client,
      env: envFor(roles),
      now: () => NOW,
      sinks: [recentAdminAudit],
      readAssignment: async () => null,
    };
  }

  test.each(['billing', 'support', 'read_only'] as const)(
    '%s is denied and reaches no client at all',
    async (role) => {
      await signInAs('actor', role);
      const { client, calls } = createClient({ rows: [] });

      await expect(
        setPlatformFeatureFlag({ key: 'flag.maps_enabled', value: false }, deps(client, { actor: role })),
      ).rejects.toThrow();

      expect(calls).toEqual([]);
    },
  );

  test('a NARROWED super_admin is denied too', async () => {
    await signInAs('actor', 'super_admin');
    const { client, calls } = createClient({ rows: [] });

    await expect(
      setPlatformFeatureFlag(
        { key: 'flag.maps_enabled', value: false },
        {
          client,
          env: envFor({ actor: 'super_admin' }),
          now: () => NOW,
          sinks: [recentAdminAudit],
          readAssignment: async () => ({
            username: 'actor',
            role: 'read_only' as const,
            isActive: true,
            sessionsRevokedAtMs: null,
            sessionsRevokedAt: null,
            assignedBy: 'founder',
            assignedAt: '2026-10-25T00:00:00.000Z',
            updatedAt: '2026-10-25T00:00:00.000Z',
          }),
        },
      ),
    ).rejects.toThrow();

    expect(calls).toEqual([]);
  });

  test('super_admin creates the row when none exists, and audits it', async () => {
    await signInAs('founder', 'super_admin');
    const { client, calls } = createClient({ rows: [] });

    const result = await setPlatformFeatureFlag(
      { key: 'flag.maps_enabled', value: false },
      deps(client, { founder: 'super_admin' }),
    );

    expect(result.ok).toBe(true);
    const insert = calls.find((call) => call.op === 'insert');
    expect(insert?.table).toBe('admin_platform_settings');
    expect(insert?.values).toEqual({
      key: 'flag.maps_enabled',
      value: false,
      updated_by: 'founder',
      updated_at: NOW.toISOString(),
    });
    expect(recentAdminAudit.entries()).toMatchObject([
      {
        actor: 'founder',
        action: 'settings.update',
        target: 'flag.maps_enabled',
        outcome: 'success',
        actorVerified: true,
      },
    ]);
  });

  test('an existing row is UPDATED on exactly the three granted columns', async () => {
    await signInAs('founder', 'super_admin');
    const { client, calls } = createClient({ rows: [settingRow({ value: false })] });

    const result = await setPlatformFeatureFlag(
      { key: 'flag.maps_enabled', value: true },
      deps(client, { founder: 'super_admin' }),
    );

    expect(result.ok).toBe(true);
    const update = calls.find((call) => call.op === 'update');
    // `key` is excluded from the update grant, so it must not be in the payload.
    expect(Object.keys(update?.values ?? {}).sort()).toEqual(['updated_at', 'updated_by', 'value']);
    expect(update?.filters).toEqual([{ method: 'eq', args: ['key', 'flag.maps_enabled'] }]);
  });

  test('the audit entry records what the flag changed FROM', async () => {
    await signInAs('founder', 'super_admin');
    const { client } = createClient({ rows: [settingRow({ value: false })] });

    await setPlatformFeatureFlag(
      { key: 'flag.maps_enabled', value: true },
      deps(client, { founder: 'super_admin' }),
    );

    // `settingKey` and `settingValue`, not `key`/`value`: those are the names
    // lib/adminAudit.ts's redaction allowlist carries, and a meta key outside
    // it is dropped in silence — which would leave this entry recording that
    // something changed without saying what.
    expect(recentAdminAudit.entries()[0]?.meta).toMatchObject({
      reason: 'updated from disabled',
      settingKey: 'flag.maps_enabled',
      settingValue: true,
    });
  });

  test('a template key is refused with a reason, and writes nothing', async () => {
    await signInAs('founder', 'super_admin');
    const { client, calls } = createClient({ rows: [] });

    const result = await setPlatformFeatureFlag(
      { key: 'notification.template.trial_ending', value: true },
      deps(client, { founder: 'super_admin' }),
    );

    expect(result.ok).toBe(false);
    expect(calls.filter((call) => call.op !== 'select')).toEqual([]);
    expect(recentAdminAudit.entries()).toMatchObject([{ outcome: 'failure' }]);
  });

  test('the string "false" is refused — it must not read as true', async () => {
    await signInAs('founder', 'super_admin');
    const { client, calls } = createClient({ rows: [] });

    const result = await setPlatformFeatureFlag(
      { key: 'flag.maps_enabled', value: 'false' },
      deps(client, { founder: 'super_admin' }),
    );

    expect(result.ok).toBe(false);
    expect(calls.filter((call) => call.op !== 'select')).toEqual([]);
  });

  test('a write failure is audited and reports that nothing changed', async () => {
    await signInAs('founder', 'super_admin');
    const { client } = createClient({ rows: [], writeError: 'permission denied' });

    const result = await setPlatformFeatureFlag(
      { key: 'flag.maps_enabled', value: false },
      deps(client, { founder: 'super_admin' }),
    );

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.committed).toBeUndefined();
    expect(recentAdminAudit.entries()).toMatchObject([{ outcome: 'failure' }]);
  });

  test('a committed write whose audit fails reports applied-but-unrecorded', async () => {
    await signInAs('founder', 'super_admin');
    const { client } = createClient({ rows: [] });
    // A sink that cannot record. The row is already written by then, so the
    // caller must be told NOT to retry, rather than that the write failed.
    const failingSink = {
      write: () => {},
      flush: async () => {
        throw new Error('audit store unavailable');
      },
    };

    const result = await setPlatformFeatureFlag(
      { key: 'flag.maps_enabled', value: false },
      {
        client,
        env: envFor({ founder: 'super_admin' }),
        now: () => NOW,
        sinks: [failingSink],
        readAssignment: async () => null,
      },
    );

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.committed).toBe(true);
    expect(result.ok === false && result.committed === true && result.code).toBe(
      'audit_write_failed',
    );
  });
});
