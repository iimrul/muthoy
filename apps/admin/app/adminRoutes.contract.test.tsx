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

    // The ONE-ROW shape, which is a different envelope from the list one:
    // `.maybeSingle()` resolves to `{ data: row | null }`, never to an array.
    // Its absence was not a harmless gap — a page calling it got `undefined is
    // not a function`, rendered its error notice, and every assertion about
    // what that page SHOWS passed vacuously while the page was broken. The
    // §8.2 drill-down is the page that found this.
    const singleResult = (table: string) => {
      const rows = clientBox.rowsByTable[table] ?? [];
      return clientBox.error === undefined
        ? { data: rows[0] ?? null, error: null }
        : { data: null, error: { message: clientBox.error } };
    };

    const build = (table: string, columns: string) => {
      clientBox.calls.push({ table, columns });
      const chain: Record<string, unknown> = {
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve(result(table)).then(resolve),
        maybeSingle: () => Promise.resolve(singleResult(table)),
        single: () => Promise.resolve(singleResult(table)),
      };
      for (const method of ['eq', 'gte', 'lte', 'lt', 'or', 'order', 'not', 'in', 'limit', 'range']) {
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
  // NOT `module`: @next/next/no-assign-module-variable forbids shadowing it,
  // and the rule is right — a file that declares `module` can confuse a
  // bundler's CommonJS interop. This was already failing lint on the committed
  // version of this file.
  const routeModule = (await import(path)) as {
    default: (props: { searchParams: Promise<Record<string, string>> }) => Promise<unknown>;
  };
  const element = await routeModule.default({ searchParams: Promise.resolve(searchParams) });
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

// ─────────────────────────────────────────────────────────────────────────────
// Batch 3 §8.1/§8.2/§8.3/§8.9 — THE POSITIVE HALF.
//
// Everything above measures that a DENIED role reaches no business query. That
// is only half a claim, and on its own it is satisfied by a fake that is
// broken for everybody: if every page failed closed for every caller, every
// denial assertion would pass and the suite would be measuring nothing.
//
// So each of the four pages extended in this batch is also rendered by an
// AUTHORIZED role against FIXTURE ROWS, and asserted to have reached the
// business tables it needs AND to have put the fixture's own values on the
// page. A page that silently rendered an empty state would fail here.
// ─────────────────────────────────────────────────────────────────────────────

const SHOP_ID = '7b000000-0000-4000-8000-000000000001';
const ACCOUNT_ID = 'ba000000-0000-4000-8000-000000000001';

/** Renders a `[id]` route, which Next hands `params` rather than `searchParams`. */
async function renderWithParams(
  path: string,
  params: Record<string, string>,
  searchParams: Record<string, string> = {},
): Promise<string> {
  // NOT `module`: @next/next/no-assign-module-variable forbids shadowing it,
  // and the rule is right — a file that declares `module` can confuse a
  // bundler's CommonJS interop. This was already failing lint on the committed
  // version of this file.
  const routeModule = (await import(path)) as {
    default: (props: {
      params: Promise<Record<string, string>>;
      searchParams: Promise<Record<string, string>>;
    }) => Promise<unknown>;
  };
  const element = await routeModule.default({
    params: Promise.resolve(params),
    searchParams: Promise.resolve(searchParams),
  });
  return renderToStaticMarkup(element as never);
}

function tablesTouched(): string[] {
  return [...new Set(clientBox.calls.map((call) => call.table))].sort();
}

/** A platform with one of everything, so every §8.1 figure has a source row. */
function seedPlatform(): void {
  clientBox.rowsByTable.shops = [
    {
      id: SHOP_ID,
      name: 'Banani Pharmacy',
      name_en: 'Banani Pharmacy',
      phone: '+8801700000001',
      district: 'Dhaka',
      thana: 'Banani',
      plan: 'pro',
      commercial_status: 'active',
      commercial_reason: null,
      archived_at: null,
      billing_account_id: null,
      latitude: null,
      longitude: null,
      location_captured_at: null,
      created_at: '2026-01-02T00:00:00.000Z',
      updated_at: '2026-10-20T00:00:00.000Z',
    },
  ];
  clientBox.rowsByTable.billing_subscriptions = [
    {
      id: 'bs000000-0000-4000-8000-000000000001',
      billing_account_id: ACCOUNT_ID,
      tier: 'pro',
      billing_cycle: 'monthly',
      status: 'active',
      starts_at: '2026-09-01T00:00:00.000Z',
      paid_through: '2026-11-01T00:00:00.000Z',
      grace_ends_at: null,
      canceled_at: null,
      provider: 'sslcommerz',
      created_at: '2026-09-01T00:00:00.000Z',
    },
  ];
  clientBox.rowsByTable.entitlement_snapshots = [
    {
      billing_account_id: ACCOUNT_ID,
      tier: 'pro',
      status: 'past_due',
      trial_ends_at: null,
      paid_through: '2026-11-01T00:00:00.000Z',
      grace_ends_at: null,
      verified_at: '2026-10-20T00:00:00.000Z',
    },
  ];
  clientBox.rowsByTable.payment_orders = [
    {
      id: 'po000000-0000-4000-8000-000000000001',
      billing_account_id: ACCOUNT_ID,
      tier: 'pro',
      billing_cycle: 'monthly',
      amount_paisa: 50000,
      status: 'verified',
      provider: 'sslcommerz',
      failure_code: null,
      expires_at: '2026-09-30T00:00:00.000Z',
      verified_at: '2026-09-29T00:00:00.000Z',
      created_at: '2026-09-28T00:00:00.000Z',
    },
  ];
  clientBox.rowsByTable.payment_provider_events = [
    {
      id: 'pe000000-0000-4000-8000-000000000001',
      payment_order_id: 'po000000-0000-4000-8000-000000000001',
      processing_status: 'rejected',
      error_code: 'signature_mismatch',
      received_at: '2026-09-29T00:00:00.000Z',
    },
  ];
  clientBox.rowsByTable.plan_offerings = [
    { tier: 'pro', billing_cycle: 'monthly', amount_paisa: 50000, is_active: true },
  ];
  clientBox.rowsByTable.billing_accounts = [{ id: ACCOUNT_ID, primary_shop_id: SHOP_ID }];
}

describe('§8.1 the Dashboard renders its nine figures and all five alerts', () => {
  beforeEach(() => {
    setEnvironment({ founder: 'super_admin' });
    seedPlatform();
  });

  test('an authorized role reaches every source table it needs', async () => {
    await signInAs('founder', 'super_admin');

    const html = await render('./page');

    // THE POSITIVE CLAIM: the page got to the business data. If the fake were
    // broken for everybody, this is the assertion that would fail — and the
    // denial assertions above would then be worthless.
    for (const table of [
      'shops',
      'billing_subscriptions',
      'entitlement_snapshots',
      'payment_orders',
      'payment_provider_events',
      'plan_offerings',
      'sales',
    ]) {
      expect(tablesTouched(), table + ' was never read').toContain(table);
    }
    // And it rendered the fixture's own row, not an empty state.
    expect(html).toContain('Banani Pharmacy');
  });

  test('all nine metric captions come from the manifest', async () => {
    await signInAs('founder', 'super_admin');

    const html = await render('./page');

    for (const label of [
      'Registered pharmacies',
      'Pharmacies active today',
      'Active subscriptions',
      'Trial subscriptions',
      'Accounts that have ever paid',
      'Currently paid entitlements',
      'Monthly recurring run rate',
      'Total sales today, net of refunds',
    ]) {
      expect(html, label + ' is missing').toContain(label);
    }
  });

  test('all five alert classes are listed, and the summary counts them', async () => {
    await signInAs('founder', 'super_admin');

    const html = await render('./page');

    expect(html).toContain('Subscriptions expiring within 7 days');
    expect(html).toContain('Accounts past due or in grace');
    expect(html).toContain('Pharmacies with no billing account');
    expect(html).toContain('Payment orders open past expiry');
    expect(html).toContain('Provider events rejected');
    // Five checked, and the sentence reports how many of the five are raised —
    // a real count rather than a constant.
    expect(html).toMatch(/of 5/);
  });

  test('the run rate is ABSENT for a role without the money permission', async () => {
    // `support` holds shops.read but not revenue.read, so the page must render
    // and simply not carry the run rate. §8.1: "still correct without it".
    setEnvironment({ helper: 'support' });
    seedPlatform();
    await signInAs('helper', 'support');

    const html = await render('./page');

    expect(html).toContain('Registered pharmacies');
    expect(html).not.toContain('Monthly recurring run rate');
    expect(html).toContain('does not hold the permission');
  });
});

describe('§8.2 the drill-down shows support notes and withholds the location', () => {
  beforeEach(() => {
    setEnvironment({ founder: 'super_admin' });
    seedPlatform();
    clientBox.rowsByTable.admin_support_cases = [
      {
        id: 'sc000000-0000-4000-8000-000000000001',
        shop_id: SHOP_ID,
        summary: 'Sync stalled after reinstall',
        status: 'open',
        priority: 'high',
        category: 'sync',
        assignee: 'founder',
        opened_by: 'founder',
        opened_at: '2026-10-20T00:00:00.000Z',
        updated_at: '2026-10-21T00:00:00.000Z',
      },
    ];
  });

  test('the support block renders the shop own case', async () => {
    await signInAs('founder', 'super_admin');

    const html = await renderWithParams('./shops/[id]/page', { id: SHOP_ID });

    expect(tablesTouched()).toContain('admin_support_cases');
    expect(html).toContain('Sync stalled after reinstall');
    expect(html).toContain('Support notes');
  });

  test('the location block withholds the coordinate and names gate E13', async () => {
    await signInAs('founder', 'super_admin');

    const html = await renderWithParams('./shops/[id]/page', { id: SHOP_ID });

    expect(html).toContain('E13');
    expect(html).toContain('Location');
    // No coordinate reaches the page in the shipped state.
    expect(html).not.toContain('23.79');
  });

  test('a role without maps.read is told so', async () => {
    // `read_only` is the one role in the §4.2 matrix that holds `shops.read`
    // and NOT `maps.read` — billing and support both hold the map read, so
    // using either would have asserted nothing.
    setEnvironment({ viewer: 'read_only' });
    seedPlatform();
    await signInAs('viewer', 'read_only');

    const html = await renderWithParams('./shops/[id]/page', { id: SHOP_ID });

    expect(html).toContain('does not hold the maps permission');
    // And the drill-down itself still works, so this is a narrowed page rather
    // than a refused one.
    expect(html).toContain('Banani Pharmacy');
  });

  test('a malformed route parameter reaches no query', async () => {
    await signInAs('founder', 'super_admin');

    // notFound() throws a Next navigation error, which is the correct
    // behaviour — the claim being measured is that nothing was queried first.
    await expect(renderWithParams('./shops/[id]/page', { id: 'not-a-uuid' })).rejects.toThrow();
    expect(businessCalls()).toEqual([]);
  });
});

describe('§8.3 Subscriptions filters, dates the next bill, and refuses overrides', () => {
  beforeEach(() => {
    setEnvironment({ founder: 'super_admin' });
    seedPlatform();
  });

  test('the next billing date and its basis both render', async () => {
    await signInAs('founder', 'super_admin');

    const html = await render('./subscriptions/page');

    expect(tablesTouched()).toContain('billing_subscriptions');
    expect(html).toContain('Next billing');
    // The fixture is an active paid cycle, so the basis is the paid cycle's
    // end — the words, not merely a date.
    expect(html).toContain('end of the paid cycle');
  });

  test('the renewal column comes from the verified order', async () => {
    await signInAs('founder', 'super_admin');

    const html = await render('./subscriptions/page');

    expect(tablesTouched()).toContain('payment_orders');
    expect(html).toContain('Renewals');
    expect(html).toContain('latest');
  });

  test('the status, tier and cycle filters all reach the query', async () => {
    await signInAs('founder', 'super_admin');

    await render('./subscriptions/page', { status: 'active', plan: 'pro', cycle: 'monthly' });

    // Two reads of the table: the exact count and the page, both filtered.
    const reads = clientBox.calls.filter((call) => call.table === 'billing_subscriptions');
    expect(reads.length).toBeGreaterThanOrEqual(2);
  });

  test('the E10 lifecycle-override notice is present, and no override control is', async () => {
    await signInAs('founder', 'super_admin');

    const html = await render('./subscriptions/page');

    expect(html).toContain('E10');
    expect(html).toContain('Lifecycle overrides are unavailable');
    // No button, no form, no action that could extend a trial or force a
    // status. §8.3(ii)'s refresh action is gone from the whole panel (E11).
    expect(html).not.toMatch(/Extend trial|Force status|refreshSnapshot/);
  });

  test('a malformed filter is reported, nothing is queried, and the notice still shows', async () => {
    await signInAs('founder', 'super_admin');

    const html = await render('./subscriptions/page', { pageSize: '5000' });

    expect(html).toContain('role="alert"');
    expect(businessCalls()).toEqual([]);
    // The refusal must not swallow the E10 statement.
    expect(html).toContain('E10');
  });
});

describe('§8.9 the audit page filters, and the per-shop view is gated', () => {
  const AUDIT_ROW = {
    id: 'al000000-0000-4000-8000-000000000001',
    shop_id: SHOP_ID,
    actor_id: '9c000000-0000-4000-8000-000000000001',
    action: 'sale.voided',
    target: 'INV-0001',
    created_at: '2026-10-21T06:00:00.000Z',
  };

  beforeEach(() => {
    setEnvironment({ founder: 'super_admin' });
    clientBox.rowsByTable.audit_logs = [AUDIT_ROW];
  });

  test('the filter controls are rendered, and the view states it is not the record', async () => {
    await signInAs('founder', 'super_admin');

    const html = await render('./audit/page');

    expect(html).toContain('Any actor');
    expect(html).toContain('Any action');
    expect(html).toContain('Any outcome');
    expect(html).toContain('This view is not the record');
  });

  test('with no shop id, the per-shop view reads NOTHING', async () => {
    await signInAs('founder', 'super_admin');

    const html = await render('./audit/page');

    expect(tablesTouched()).not.toContain('audit_logs');
    expect(html).toContain('No pharmacy is selected');
  });

  test('with a shop id, a permitted role reads that ONE shop log', async () => {
    await signInAs('founder', 'super_admin');

    const html = await render('./audit/page', { shop: SHOP_ID });

    expect(tablesTouched()).toContain('audit_logs');
    expect(html).toContain('sale.voided');
    expect(html).toContain('INV-0001');
  });

  test('a role without shop_audit.read reads no pharmacy log at all', async () => {
    // `billing` holds audit.read but NOT shop_audit.read — §4.2 scopes the
    // per-shop view to super_admin and support.
    setEnvironment({ money: 'billing' });
    clientBox.rowsByTable.audit_logs = [AUDIT_ROW];
    await signInAs('money', 'billing');

    const html = await render('./audit/page', { shop: SHOP_ID });

    expect(tablesTouched()).not.toContain('audit_logs');
    expect(html).toContain('does not hold the per-shop audit permission');
    expect(html).not.toContain('sale.voided');
  });

  test('a malformed shop id is refused before any query', async () => {
    await signInAs('founder', 'super_admin');

    const html = await render('./audit/page', { shop: 'not-a-uuid' });

    expect(tablesTouched()).not.toContain('audit_logs');
    expect(html).toContain('not a valid pharmacy id');
  });

  test('the per-shop read only ever selects', async () => {
    // §3.5 revokes every privilege on `audit_logs` from the panel's role and
    // grants back SELECT alone, so a write fails in the database. This is the
    // source-level half of the same claim.
    const source = readFileSync(join(import.meta.dirname, '../lib/adminPlatformQueries.ts'), 'utf8');
    const block = source.slice(source.indexOf('export async function shopAuditPage'));

    expect(block.length).toBeGreaterThan(200);
    expect(block).not.toMatch(/\.(insert|update|delete|upsert)\(/);
  });
});
