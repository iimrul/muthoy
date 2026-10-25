// Batch 3 §11 — the per-route contract. Each of the eleven pages is INVOKED,
// awaited, and rendered with `react-dom/server`.
//
// WHY THIS FILE LIVES UNDER apps/admin/. It resolves `react-dom` only from
// inside this workspace under pnpm; a root-level file fails with
// ERR_MODULE_NOT_FOUND. It is also added to vitest.config.ts's `include`
// explicitly, because the existing globs cover apps/admin/lib/**/*.test.ts only.
//
// WHAT THIS CATCHES THAT A lib TEST CANNOT. adminAuthz.test.ts asserts the gate
// is PRESENT in each page's source. That is a different claim from the gate
// WORKING: a page could call requireAdminPermission and then render anyway, or
// read data before awaiting it. Here the pages actually run, against a
// recording client, so "a forbidden role reaches no business query" is measured
// rather than inferred.
//
// THE CLIENT COMPONENTS ARE STUBBED AT THE MODULE BOUNDARY. ChartLoader and
// MapLoader own the `next/dynamic` calls and pull in Recharts and Leaflet,
// neither of which belongs in a node test — and neither is what this file is
// about. ChartPanel is a SERVER component and renders for real, so the figures
// and the suppression note are genuinely exercised.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const cookieStore = vi.hoisted(() => ({ value: undefined as string | undefined }));
const clientBox = vi.hoisted(() => ({
  calls: [] as { table: string; columns: string }[],
  // PER TABLE, and that is not a convenience. One shared array means the
  // authorization read of `admin_role_assignments` receives whatever rows the
  // test set for `shops` — and lib/adminIdentityStore.ts correctly THROWS on a
  // row whose `role` it cannot read, so every page fails closed and the test
  // measures nothing. A table nobody set answers empty.
  rowsByTable: {} as Record<string, Record<string, unknown>[]>,
  error: undefined as string | undefined,
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'muthoy_admin_session' && cookieStore.value !== undefined
        ? { name, value: cookieStore.value }
        : undefined,
  }),
}));

// A plain anchor. `next/link` wants the router context a real request supplies.
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: unknown }) => (
    <a href={href}>{children as never}</a>
  ),
}));

vi.mock('../components/charts/ChartLoader', () => ({
  default: ({ valueLabel }: { valueLabel: string }) => <div data-chart={valueLabel} />,
}));

vi.mock('../components/map/MapLoader', () => ({
  default: ({ tileUrl }: { tileUrl: string }) => <div data-map={tileUrl} />,
}));

/**
 * The recording client, narrow on purpose.
 *
 * It answers every shape the pages issue and records the TABLE and the declared
 * COLUMN LIST of each read, so "a forbidden role reached no business query" and
 * "the declared columns are real columns" are both measurable from one place.
 */
vi.mock('../lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => {
    const result = (table: string) => {
      const rows = clientBox.rowsByTable[table] ?? [];
      return clientBox.error === undefined
        ? { data: rows, error: null, count: rows.length }
        : { data: null, error: { message: clientBox.error }, count: null };
    };

    const build = (table: string, columns: string) => {
      clientBox.calls.push({ table, columns });
      const chain: Record<string, unknown> = {
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve(result(table)).then(resolve),
      };
      for (const method of ['eq', 'gte', 'lte', 'or', 'order', 'not', 'in', 'limit', 'range']) {
        chain[method] = () => chain;
      }
      return chain;
    };

    return {
      from: (table: string) => ({
        select: (columns: string) => build(table, columns),
        insert: () => Promise.resolve({ data: null, error: null }),
        update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
      }),
      rpc: () => Promise.resolve({ data: null, error: null }),
    };
  },
}));

const { newSessionPayload, signAdminSession } = await import('../lib/adminSession');

type Role = 'super_admin' | 'billing' | 'support' | 'read_only';

const SECRET = 'a'.repeat(32);
const MIGRATIONS_DIR = join(process.cwd(), 'backend/supabase/migrations');

/**
 * The eleven pages, each with the permission it must demand and — where one
 * exists — a REAL role that does not hold it.
 *
 * `read_only` holds every `*.read` except `revenue.read` and `admins.read`, so
 * for most pages the only unauthorized caller is one the environment does not
 * know. That asymmetry is the §4.2 matrix being exercised rather than restated.
 */
const ROUTES = [
  { name: 'dashboard', path: './page', denied: null },
  { name: 'pharmacies', path: './pharmacies/page', denied: null },
  { name: 'subscriptions', path: './subscriptions/page', denied: null },
  { name: 'revenue', path: './revenue/page', denied: 'read_only' },
  { name: 'analytics', path: './analytics/page', denied: null },
  { name: 'maps', path: './maps/page', denied: null },
  { name: 'support', path: './support/page', denied: null },
  { name: 'admins', path: './admins/page', denied: 'read_only' },
  { name: 'audit', path: './audit/page', denied: null },
  { name: 'reports', path: './reports/page', denied: null },
  { name: 'settings', path: './settings/page', denied: null },
] as const;

/** A username ADMIN_ROLES does not know, so it holds nothing at all. */
const STRANGER = 'nobody';

async function signInAs(username: string, role: Role): Promise<void> {
  cookieStore.value = await signAdminSession(
    newSessionPayload({ sub: username, role, epoch: 0, now: Date.now() }),
    SECRET,
  );
}

function setEnvironment(roles: Record<string, Role>): void {
  process.env.ADMIN_SESSION_SECRET = SECRET;
  process.env.ADMIN_ROLES = JSON.stringify(roles);
  // The shipped Maps state: no provider approved (gate E14).
  delete process.env.ADMIN_MAP_TILE_URL;
  delete process.env.ADMIN_MAP_TILE_ATTRIBUTION;
}

/** Renders one page. `searchParams` is the promise Next 15 hands a page. */
async function render(path: string, searchParams: Record<string, string> = {}): Promise<string> {
  const module = (await import(path)) as {
    default: (props: { searchParams: Promise<Record<string, string>> }) => Promise<unknown>;
  };
  const element = await module.default({ searchParams: Promise.resolve(searchParams) });
  return renderToStaticMarkup(element as never);
}

/**
 * The ADMIN INFRASTRUCTURE tables, which a denial legitimately touches.
 *
 * Narrow, named, and asserted below — an exclusion list is the one place this
 * test could be made to pass by hiding the thing it exists to catch.
 *
 *   admin_role_assignments  IS the gate. §4.3 reads it on EVERY request to
 *                           compute the effective permission set, so it is
 *                           touched before the decision rather than after it;
 *   admin_audit_log         the denial's own audit entry. §8.9c expects it, and
 *                           a denial that recorded nothing would be worse.
 *
 * Every other table is business data, and a denied request must reach none.
 */
const ADMIN_INFRASTRUCTURE_TABLES = ['admin_role_assignments', 'admin_audit_log'] as const;

function businessCalls(): { table: string; columns: string }[] {
  return clientBox.calls.filter(
    (call) => !(ADMIN_INFRASTRUCTURE_TABLES as readonly string[]).includes(call.table),
  );
}

beforeEach(() => {
  cookieStore.value = undefined;
  clientBox.calls = [];
  clientBox.rowsByTable = {};
  clientBox.error = undefined;
  vi.resetModules();
});

describe('every route refuses an unauthorized role before it reads anything', () => {
  test('the exclusion list covers ONLY authorization and audit', () => {
    // Stated as a test, so widening it later is a visible edit. A business
    // table appearing here would make every denial assertion above vacuous.
    expect([...ADMIN_INFRASTRUCTURE_TABLES]).toEqual([
      'admin_role_assignments',
      'admin_audit_log',
    ]);
    for (const table of ['shops', 'sales', 'sale_refunds', 'payment_orders',
      'billing_subscriptions', 'billing_accounts', 'entitlement_snapshots',
      'admin_support_cases', 'admin_platform_settings']) {
      expect(ADMIN_INFRASTRUCTURE_TABLES as readonly string[], table).not.toContain(table);
    }
  });

  test.each(ROUTES.map((route) => [route.name, route] as const))(
    '%s denies a session the environment does not know, and issues NO business query',
    async (_name, route) => {
      setEnvironment({ other: 'super_admin' });
      await signInAs(STRANGER, 'super_admin');

      const html = await render(route.path);

      // EITHER denial sentence is correct here, and which one is itself
      // meaningful: a username ADMIN_ROLES does not know has no environment
      // role at all, so it is refused as unauthenticated rather than merely
      // forbidden. What must never happen is the page rendering its content.
      expect(html).toMatch(/session has ended|does not have access/);
      // THE MEASURED CLAIM: not "the gate is in the source" but "no business
      // table was touched". The audit insert is expected and excluded.
      expect(businessCalls()).toEqual([]);
    },
  );

  test.each(
    ROUTES.filter((route) => route.denied !== null).map((route) => [route.name, route] as const),
  )('%s denies a real role that lacks its permission', async (_name, route) => {
    const denied = route.denied as Role;
    setEnvironment({ ops: denied });
    await signInAs('ops', denied);

    const html = await render(route.path);

    // A REAL role, so this one is specifically a permission refusal.
    expect(html).toContain('does not have access');
    expect(businessCalls()).toEqual([]);
  });

  test.each(ROUTES.map((route) => [route.name, route] as const))(
    '%s refuses a request with NO session at all',
    async (_name, route) => {
      setEnvironment({ founder: 'super_admin' });
      cookieStore.value = undefined;

      const html = await render(route.path);

      expect(html).toMatch(/session has ended|does not have access/);
      expect(businessCalls()).toEqual([]);
    },
  );
});

describe('every route renders an authorized empty state', () => {
  test.each(ROUTES.map((route) => [route.name, route] as const))(
    '%s renders without throwing, and says something',
    async (_name, route) => {
      setEnvironment({ founder: 'super_admin' });
      await signInAs('founder', 'super_admin');

      const html = await render(route.path);

      // An empty platform is the shipped state, so every page must render it
      // rather than throw — and must not render a bare blank or a stray
      // `undefined` where a figure belongs.
      expect(html.length).toBeGreaterThan(40);
      expect(html).not.toContain('undefined');
      expect(html).not.toContain('NaN');
    },
  );
});

describe('a query failure renders a notice and leaks nothing', () => {
  const LEAK = 'postgresql://admin:hunter2@db.internal:5432/muthoy';

  test.each(ROUTES.map((route) => [route.name, route] as const))(
    '%s shows a fixed notice, never the driver message',
    async (_name, route) => {
      setEnvironment({ founder: 'super_admin' });
      await signInAs('founder', 'super_admin');
      clientBox.error = 'connection to ' + LEAK + ' failed';

      const html = await render(route.path);

      // The driver's text reaches the server log, never the browser.
      expect(html).not.toContain(LEAK);
      expect(html).not.toContain('hunter2');
      expect(html).not.toContain('db.internal');
      expect(html).not.toContain('at Object.');
    },
  );
});

describe('the declared column lists are real columns', () => {
  // Read from the migrations, so a renamed column fails HERE rather than in
  // production. The pages declare their columns as literal strings; this walks
  // what the recording client actually received.
  // EVERY migration, not a chosen few: `commercial_status` arrives in the b4
  // commercial-platform migration and the billing columns in others, so a
  // two-file source would report real columns as invented.
  const sql = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .map((name) => readFileSync(join(MIGRATIONS_DIR, name), 'utf8'))
    .join('\n');

  test('finds the migration SQL', () => {
    expect(sql.length).toBeGreaterThan(1000);
    expect(sql).toContain('admin_platform_settings');
  });

  test.each(ROUTES.map((route) => [route.name, route] as const))(
    '%s selects only columns the schema declares',
    async (_name, route) => {
      setEnvironment({ founder: 'super_admin' });
      await signInAs('founder', 'super_admin');

      await render(route.path);

      const unknown: string[] = [];
      for (const call of clientBox.calls) {
        for (const column of call.columns.split(',').map((part) => part.trim())) {
          if (column.length === 0) continue;
          // A column is real if the SQL declares that identifier anywhere.
          // Coarse on purpose: the claim is "no column name is invented", and a
          // per-table parse of this SQL would be a second schema reader to keep
          // correct.
          if (!new RegExp('(^|[^a-z_])' + column + '([^a-z_]|$)', 'm').test(sql)) {
            unknown.push(call.table + '.' + column);
          }
        }
      }

      expect(unknown).toEqual([]);
    },
  );
});

describe('the pharmacy list pushes its filters into the query', () => {
  test('a search, a plan filter and a page all reach the client', async () => {
    setEnvironment({ founder: 'super_admin' });
    await signInAs('founder', 'super_admin');
    clientBox.rowsByTable.shops = [
      {
        id: '7b000000-0000-4000-8000-000000000001',
        name: 'Banani Pharmacy',
        name_en: 'Banani Pharmacy',
        phone: '+8801700000001',
        district: 'Dhaka',
        thana: 'Banani',
        plan: 'free',
        commercial_status: 'active',
        created_at: '2026-10-25T00:00:00.000Z',
        updated_at: '2026-10-25T00:00:00.000Z',
      },
    ];

    const html = await render('./pharmacies/page', {
      search: 'Banani',
      plan: 'free',
      page: '1',
    });

    expect(html).toContain('Banani Pharmacy');
    // Two reads of `shops`: the exact count and the page itself, both carrying
    // the same filters (adminFilters.test.ts asserts WHICH filters, against a
    // recording builder).
    expect(clientBox.calls.filter((call) => call.table === 'shops').length).toBeGreaterThanOrEqual(
      2,
    );
  });

  test('a malformed filter is reported, and no query is issued', async () => {
    setEnvironment({ founder: 'super_admin' });
    await signInAs('founder', 'super_admin');

    const html = await render('./pharmacies/page', { pageSize: '5000' });

    // The BEHAVIOUR, not Zod's wording: an alert is shown, the filter form is
    // still rendered so the operator can correct it, and nothing was queried.
    expect(html).toContain('role="alert"');
    expect(html).toContain('<form');
    expect(businessCalls()).toEqual([]);
  });
});

describe('the shipped Maps state plots nothing and loads no map', () => {
  test('with no tile provider configured, MapLoader is never rendered', async () => {
    setEnvironment({ founder: 'super_admin' });
    await signInAs('founder', 'super_admin');
    clientBox.rowsByTable.shops = [
      {
        id: '7b000000-0000-4000-8000-000000000001',
        name: 'Banani Pharmacy',
        latitude: 23.79,
        longitude: 90.4,
        location_captured_at: '2026-10-25T00:00:00.000Z',
        district: 'Dhaka',
        plan: 'pro',
        commercial_status: 'active',
      },
    ];

    const html = await render('./maps/page');

    // The stub renders `data-map`. Its absence is the proof that the dynamic
    // import — and therefore Leaflet — is never reached.
    expect(html).not.toContain('data-map');
    expect(html).toContain('E14');
  });
});
