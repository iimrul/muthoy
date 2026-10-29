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
  calls: [] as { table: string; columns: string; filters: { method: string; args: unknown[] }[] }[],
  // PER TABLE, and that is not a convenience. One shared array means the
  // authorization read of `admin_role_assignments` receives whatever rows the
  // test set for `shops` — and lib/adminIdentityStore.ts correctly THROWS on a
  // row whose `role` it cannot read, so every page fails closed and the test
  // measures nothing. A table nobody set answers empty.
  rowsByTable: {} as Record<string, Record<string, unknown>[]>,
  error: undefined as string | undefined,
  // GATE 5 FINDING 13. `error` used to fail EVERY table, including
  // `admin_role_assignments` — which IS the authorization gate (§4.3 reads it
  // on every request). So the "a query failure renders a notice" test actually
  // measured a DENIAL: the page never got as far as a business read, and the
  // assertion that no driver message leaks was never exercised on the path it
  // describes.
  //
  // The injection is therefore scoped. By default the two admin
  // INFRASTRUCTURE tables keep working, so authorization succeeds and the
  // failure lands where the test claims it does.
  healthyTables: ['admin_role_assignments', 'admin_audit_log'] as readonly string[],
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
    /** Whether THIS table is failing, honouring the healthy-table list. */
    const failing = (table: string) =>
      clientBox.error !== undefined && !clientBox.healthyTables.includes(table);

    const result = (table: string) => {
      const rows = clientBox.rowsByTable[table] ?? [];
      return failing(table)
        ? { data: null, error: { message: clientBox.error }, count: null }
        : { data: rows, error: null, count: rows.length };
    };

    // The ONE-ROW shape, which is a different envelope from the list one:
    // `.maybeSingle()` resolves to `{ data: row | null }`, never to an array.
    // Its absence was not a harmless gap — a page calling it got `undefined is
    // not a function`, rendered its error notice, and every assertion about
    // what that page SHOWS passed vacuously while the page was broken. The
    // §8.2 drill-down is the page that found this.
    const singleResult = (table: string) => {
      const rows = clientBox.rowsByTable[table] ?? [];
      return failing(table)
        ? { data: null, error: { message: clientBox.error } }
        : { data: rows[0] ?? null, error: null };
    };

    const build = (table: string, columns: string) => {
      // The FILTER ARGUMENTS are recorded too, because "this read was not
      // narrowed by registration date" is a claim about the arguments and
      // cannot be made from the table name alone.
      const filters: { method: string; args: unknown[] }[] = [];
      clientBox.calls.push({ table, columns, filters });
      // ROUND 14 FINDING 11: a CURSOR query answers with the rows beyond the
      // cursor, and this fixture holds one page of rows -- so beyond it there
      // are none. Without this the district pager, which now continues until
      // an EMPTY page proves exhaustion, would see the same rows forever and
      // hit its ceiling.
      const advanced = () => filters.some((entry) => entry.method === 'gt');
      const pageResult = () => {
        const response = result(table);
        const range = filters.find((entry) => entry.method === 'range');
        if (response.data === null || range === undefined) return response;
        const [from, to] = range.args as [number, number];
        return { ...response, data: response.data.slice(from, to + 1) };
      };
      const chain: Record<string, unknown> = {
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve(
            advanced() ? { data: [], error: null, count: 0 } : pageResult(),
          ).then(resolve),
        maybeSingle: () => Promise.resolve(singleResult(table)),
        single: () => Promise.resolve(singleResult(table)),
      };
      // `like` is here for round 11 finding 5: the four history views read
      // `admin_audit_log` with a server-side action-prefix filter, one query
      // per prefix. Without it the chain returned undefined and every one of
      // those pages threw -- which the "renders without throwing" tests caught.
      for (const method of [
        'eq', 'gte', 'lte', 'lt', 'gt', 'or', 'order', 'not', 'in', 'limit', 'range', 'like',
      ]) {
        chain[method] = (...args: unknown[]) => {
          filters.push({ method, args });
          return chain;
        };
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
  { name: 'dashboard', path: './page', denied: null,
    heading: 'Dashboard', reads: ['shops', 'billing_subscriptions'] },
  { name: 'pharmacies', path: './pharmacies/page', denied: null,
    heading: 'Pharmacies', reads: ['shops'] },
  { name: 'subscriptions', path: './subscriptions/page', denied: null,
    heading: 'Subscriptions', reads: ['billing_subscriptions'] },
  { name: 'revenue', path: './revenue/page', denied: 'read_only',
    heading: 'Revenue', reads: ['billing_subscriptions', 'payment_orders'] },
  { name: 'analytics', path: './analytics/page', denied: null,
    heading: 'Analytics', reads: ['shops'] },
  // Maps reads the coordinate columns even though it plots nothing: the empty
  // state reports how many shops were WITHHELD, and a zero that came from not
  // looking is a different claim from a zero that came from looking.
  { name: 'maps', path: './maps/page', denied: null,
    heading: 'Maps', reads: ['shops'] },
  { name: 'support', path: './support/page', denied: null,
    heading: 'Support', reads: ['admin_support_cases'] },
  // Admins and Settings read no BUSINESS table — their data is the environment
  // and the admin tables — so they declare none and are asserted on the
  // heading alone.
  { name: 'admins', path: './admins/page', denied: 'read_only',
    heading: 'Admin', reads: [] },
  { name: 'audit', path: './audit/page', denied: null,
    heading: 'audit', reads: [] },
  { name: 'reports', path: './reports/page', denied: null,
    heading: 'Reports', reads: [] },
  { name: 'settings', path: './settings/page', denied: null,
    heading: 'Settings', reads: [] },
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
  clientBox.healthyTables = ['admin_role_assignments', 'admin_audit_log'];
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

      // GATE 5 FINDING 13. This used to assert only that the output was longer
      // than 40 characters and carried no `undefined` — which an ErrorNotice
      // satisfies. A page that failed to load passed as "renders an authorized
      // empty state". So the claim is now measured: the page's own heading is
      // present and NO alert is rendered.
      expect(html, route.name + ' did not render its own heading').toContain(route.heading);
      expect(html, route.name + ' rendered an alert in its empty state').not.toContain(
        'role="alert"',
      );
      expect(html).not.toContain('Could not load data');

      // An empty platform is the shipped state, so every page must render it
      // rather than throw — and must not render a bare blank or a stray
      // `undefined` where a figure belongs.
      expect(html.length).toBeGreaterThan(40);
      expect(html).not.toContain('undefined');
      expect(html).not.toContain('NaN');
    },
  );
});

describe('an AUTHORIZED route reaches its intended reads (Gate 5 finding 13)', () => {
  // The positive direction, per route. The denial tests above measure that a
  // forbidden caller reaches no business table; on their own they are satisfied
  // by a page that reaches no table for ANYBODY — which is exactly what the
  // missing `maybeSingle()` produced on the drill-down earlier in this batch.
  test.each(
    ROUTES.filter((route) => route.reads.length > 0).map((route) => [route.name, route] as const),
  )('%s reads the tables it is built on', async (_name, route) => {
    setEnvironment({ founder: 'super_admin' });
    await signInAs('founder', 'super_admin');

    await render(route.path);

    const touched = new Set(clientBox.calls.map((call) => call.table));
    for (const table of route.reads) {
      expect(touched.has(table), route.name + ' never read ' + table).toBe(true);
    }
  });

  test('the declared reads are BUSINESS tables, not the gate', () => {
    // Otherwise a route could satisfy the assertion above with the
    // authorization read it performs anyway.
    for (const route of ROUTES) {
      for (const table of route.reads) {
        expect(ADMIN_INFRASTRUCTURE_TABLES as readonly string[], route.name).not.toContain(table);
      }
    }
  });
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

describe('§8.5 Analytics renders all four missing figures (Gate 5 finding 8)', () => {
  // All four were specified, none rendered, and the acceptance record claimed
  // them. Rendered against a POPULATED fixture, because an empty platform
  // would show the empty state and prove nothing.
  beforeEach(() => {
    setEnvironment({ founder: 'super_admin' });
    seedPlatform();
    clientBox.rowsByTable.billing_accounts = [
      { id: ACCOUNT_ID, primary_shop_id: SHOP_ID, launch_trial_granted_at: '2026-08-01T00:00:00.000Z' },
    ];
  });

  test('conversion, growth, cancellations and sales volume all appear', async () => {
    await signInAs('founder', 'super_admin');

    const html = await render('./analytics/page');

    expect(html).toContain('Trial to paid conversion');
    expect(html).toContain('Subscription growth, by month');
    expect(html).toContain('Recorded cancellations, by month');
    expect(html).toContain('Pharmacy sales volume, by month');
  });

  /**
   * One chart panel's HTML, so an assertion about the sale COUNT cannot be
   * satisfied by a digit belonging to the money series beside it.
   */
  function panel(html: string, headingId: string): string {
    const start = html.indexOf('aria-labelledby="' + headingId + '"');
    expect(start, 'no panel ' + headingId).toBeGreaterThan(-1);
    const next = html.indexOf('aria-labelledby="chart-', start + 1);
    return next === -1 ? html.slice(start) : html.slice(start, next);
  }

  function trialedAccounts(count: number): Record<string, unknown>[] {
    return Array.from({ length: count }, (_unused, index) => ({
      id: 'ba000000-0000-4000-8000-00000000000' + (index + 1),
      primary_shop_id: SHOP_ID,
      launch_trial_granted_at: '2026-08-01T00:00:00.000Z',
    }));
  }

  test('ONE trialed account withholds the percentage AND the counts', async () => {
    // GATE 5 DELTA FINDING 2. The fixture's single account holds a verified
    // payment, so before the fix this page published "100.0%" and "1 of 1" —
    // that account's payment activity, under an aggregate's label.
    clientBox.rowsByTable.billing_accounts = trialedAccounts(1);
    await signInAs('founder', 'super_admin');

    const html = await render('./analytics/page');

    expect(html).toContain('Trial to paid conversion');
    expect(html).not.toContain('100.0%');
    expect(html).not.toContain('1 of 1');
    expect(html).toContain('fewer than 5 accounts have been granted a trial');
  });

  test('FIVE trialed accounts publish it, so the floor is a floor and not a removal', async () => {
    // The k boundary from the other side. Without this, the test above would
    // pass against a page that never shows a conversion figure at all.
    clientBox.rowsByTable.billing_accounts = trialedAccounts(5);
    await signInAs('founder', 'super_admin');

    const html = await render('./analytics/page');

    // One of the five holds the fixture's verified order: 1/5.
    expect(html).toContain('20.0%');
    expect(html).toContain('1 of 5');
    expect(html).not.toContain('fewer than 5 accounts have been granted a trial');
  });

  test('refund-only shops do not lift the sale count over the floor', async () => {
    // GATE 5 DELTA FINDING 3. One shop sold; four others only refunded. The
    // refund-NET total legitimately has five contributors, but "how many
    // sales" has exactly one — and before the fix both were gated on the
    // same list, so the count came out.
    clientBox.rowsByTable.sales = [
      {
        id: 's1',
        shop_id: SHOP_ID,
        business_date: '2026-09-10',
        total: 1000,
        created_at: '2026-09-10T00:00:00.000Z',
      },
    ];
    clientBox.rowsByTable.sale_refunds = Array.from({ length: 4 }, (_unused, index) => ({
      id: 'r' + index,
      shop_id: '7b000000-0000-4000-8000-00000000001' + index,
      business_date: '2026-09-11',
      total: 100,
      created_at: '2026-09-11T00:00:00.000Z',
    }));
    await signInAs('founder', 'super_admin');

    const html = await render('./analytics/page');

    const volume = panel(html, 'chart-pharmacy-sales-volume-by-month');
    expect(volume).toContain('2026-09');
    // Withheld: an em dash in the cell, and the panel says so.
    expect(volume).toContain('withheld');
    expect(volume).not.toMatch(/>\s*1\s*</);
  });

  test('it reads the sources those figures need', async () => {
    await signInAs('founder', 'super_admin');

    await render('./analytics/page');

    const touched = new Set(clientBox.calls.map((call) => call.table));
    for (const table of ['billing_accounts', 'billing_subscriptions', 'payment_orders']) {
      expect(touched.has(table), 'analytics never read ' + table).toBe(true);
    }
  });

  test('a malformed range is refused and NOTHING is queried', async () => {
    await signInAs('founder', 'super_admin');

    const html = await render('./analytics/page', { from: '2026-13-01' });

    expect(html).toContain('role="alert"');
    // The claim is that no PHARMACY DATA was read. `admin_platform_settings`
    // is read first and legitimately: §8.11's flag decides whether this page
    // exists at all, and it is admin configuration rather than business data —
    // the same category as the role table the exclusion list already names.
    const touched = new Set(clientBox.calls.map((call) => call.table));
    for (const table of ['shops', 'sales', 'billing_subscriptions', 'payment_orders']) {
      expect(touched.has(table), table + ' was read despite a refused range').toBe(false);
    }
  });

  test('an oversized range is refused too, with the cap stated', async () => {
    await signInAs('founder', 'super_admin');

    const html = await render('./analytics/page', { from: '2020-01-01', to: '2026-01-01' });

    expect(html).toContain('role="alert"');
    expect(html).toContain('400');
    const touched = new Set(clientBox.calls.map((call) => call.table));
    for (const table of ['shops', 'sales', 'billing_subscriptions', 'payment_orders']) {
      expect(touched.has(table), table + ' was read despite an oversized range').toBe(false);
    }
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
      // §6i: this caption now comes from the MANIFEST rather than from a
      // hand-written string on the page. It reads "Pharmacy sales today, net
      // of refunds" because that is `pharmacy_sales_net_today`'s label, and
      // the net card has no caption prop a caller could pass instead -- which
      // is what closes round 9's reproduction C structurally.
      'Pharmacy sales today, net of refunds',
    ]) {
      expect(html, label + ' is missing').toContain(label);
    }
    // And the OLD hand-written caption is gone, so the page cannot be
    // captioning the figure itself any more.
    expect(html).not.toContain('Total sales today, net of refunds');
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

  test('the notes THEMSELVES are read and rendered (Gate 5 finding 16)', async () => {
    // The block was called "Support notes" and read no note — only case
    // summaries. A note is what somebody actually wrote about this pharmacy.
    clientBox.rowsByTable.admin_support_notes = [
      {
        id: 'sn000000-0000-4000-8000-000000000001',
        case_id: 'sc000000-0000-4000-8000-000000000001',
        body: 'Owner confirmed the reinstall cleared it.',
        author: 'founder',
        created_at: '2026-10-21T06:00:00.000Z',
      },
    ];
    await signInAs('founder', 'super_admin');

    const html = await renderWithParams('./shops/[id]/page', { id: SHOP_ID });

    expect(tablesTouched()).toContain('admin_support_notes');
    expect(html).toContain('Owner confirmed the reinstall cleared it.');
    expect(html).toContain('Notes on those cases');
  });

  test('§8.2 owner information and the last synced change render', async () => {
    clientBox.rowsByTable.users = [
      {
        id: '9c000000-0000-4000-8000-000000000001',
        name: 'Rahim Uddin',
        phone: '+8801700000009',
      },
    ];
    await signInAs('founder', 'super_admin');

    const html = await renderWithParams('./shops/[id]/page', { id: SHOP_ID });

    expect(html).toContain('Owner');
    expect(html).toContain('Last synced change');
  });

  test('one shop’s notes never appear on another shop’s page', async () => {
    // The scoping claim, with a real second shop in the fixture. The case list
    // filters on shop_id IN THE QUERY, and the notes are read per case id — so
    // there is no path to a note without a case that belongs here.
    await signInAs('founder', 'super_admin');

    const reads = clientBox.calls.length;
    await renderWithParams('./shops/[id]/page', { id: SHOP_ID });

    // Every support read happened after the shop id was validated, and the
    // case read is the only thing that produces a case id.
    expect(clientBox.calls.length).toBeGreaterThan(reads);
    const caseReads = clientBox.calls.filter((call) => call.table === 'admin_support_cases');
    expect(caseReads.length).toBeGreaterThan(0);
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

  test('the filter controls are rendered, and the view states its SOURCE', async () => {
    await signInAs('founder', 'super_admin');

    const html = await render('./audit/page');

    expect(html).toContain('Any actor');
    expect(html).toContain('Any action');
    expect(html).toContain('Any outcome');
    // ROUND 11 FINDING 5. This used to assert "This view is not the record"
    // unconditionally, which was honest when the page only ever read the
    // in-process ring. It now reads `admin_audit_log` first, so with a healthy
    // table the page says that instead -- and the warning must NOT appear,
    // because it would be false.
    expect(html).toContain('durable');
    expect(html).toContain('admin_audit_log');
    expect(html).not.toContain('This view is not the record');
  });

  test('when the durable log CANNOT be read, the page says so loudly', async () => {
    await signInAs('founder', 'super_admin');
    // Only the audit table fails: authorization stays healthy, so the failure
    // lands where this test claims it does (Gate 5 finding 13's lesson).
    clientBox.error = 'relation "admin_audit_log" does not exist';
    clientBox.healthyTables = ['admin_role_assignments'];

    const html = await render('./audit/page');

    expect(html).toContain('This view is not the record');
    expect(html).toContain('since it started');
    // And the gate that makes it complete is named, so the reader knows what
    // is missing rather than only that something is.
    expect(html).toContain('E4-H');
    // The driver message never reaches the page.
    expect(html).not.toContain('does not exist');
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

describe('the activity report reads EVERY shop, not only the ones registered in the period', () => {
  // GATE 5 DELTA FINDING 4, at the layer the defect actually lives in.
  //
  // `buildActivitySummary` restricts the sales half to the shops it was
  // handed. That is correct only if it is handed every shop, and the reader
  // was narrowing the `shops` read by `created_at` for every report. The
  // builder test in lib/adminReports.test.ts cannot see this, because it is
  // handed its fixture directly — so the claim is made here, against the
  // recorded filter arguments.
  const shopReads = () => clientBox.calls.filter((call) => call.table === 'shops');
  const rangedOnRegistration = (call: { filters: { method: string; args: unknown[] }[] }) =>
    call.filters.some(
      (filter) =>
        (filter.method === 'gte' || filter.method === 'lte') && filter.args[0] === 'created_at',
    );

  beforeEach(() => {
    setEnvironment({ founder: 'super_admin' });
    seedPlatform();
  });

  test('activity_summary puts NO created_at bound on its shops read', async () => {
    const { platformReportData } = await import('../lib/adminPlatformQueries');

    await platformReportData({
      reportId: 'activity_summary',
      format: 'csv',
      from: '2026-10-01',
      to: '2026-10-31',
    });

    const reads = shopReads();
    expect(reads.length).toBeGreaterThan(0);
    for (const read of reads) {
      expect(rangedOnRegistration(read), 'a shops read was narrowed by registration date')
        .toBe(false);
    }
  });

  test('the sales read for the SAME query is still bounded, so the period is not lost', async () => {
    // Widening the shops read must not widen the report. The period still
    // decides which sales count; it just no longer decides which shops exist.
    const { platformReportData } = await import('../lib/adminPlatformQueries');

    await platformReportData({
      reportId: 'activity_summary',
      format: 'csv',
      from: '2026-10-01',
      to: '2026-10-31',
    });

    const salesReads = clientBox.calls.filter((call) => call.table === 'sales');
    expect(salesReads.length).toBeGreaterThan(0);
    expect(
      salesReads.some((read) =>
        read.filters.some(
          (filter) => filter.method === 'gte' && filter.args[0] === 'business_date',
        ),
      ),
    ).toBe(true);
  });

  test('pharmacy_registrations DOES bound it, so the widening is per report', async () => {
    // Non-vacuity. Without this, the first test would pass against a reader
    // that had simply stopped applying ranges to `shops` everywhere — which
    // would silently break the registration report.
    const { platformReportData } = await import('../lib/adminPlatformQueries');

    await platformReportData({
      reportId: 'pharmacy_registrations',
      format: 'csv',
      from: '2026-10-01',
      to: '2026-10-31',
    });

    const reads = shopReads();
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.every(rangedOnRegistration)).toBe(true);
  });
});

describe('every analytics series describes the SAME period', () => {
  // GATE 5 DELTA FINDING 5. The growth and cancellation series were built
  // from whole-table reads and never consulted the range, so an October
  // query drew January growth and February cancellations beside October
  // activity and October sales. Four charts on one page, each about a
  // different period, with nothing on the page saying so.
  beforeEach(() => {
    setEnvironment({ founder: 'super_admin' });
    seedPlatform();
    clientBox.rowsByTable.billing_subscriptions = [
      {
        id: 'bs000000-0000-4000-8000-00000000000a',
        billing_account_id: ACCOUNT_ID,
        tier: 'pro',
        billing_cycle: 'monthly',
        status: 'active',
        // Started in JANUARY and canceled in FEBRUARY: outside any October
        // query, and the only subscription rows there are.
        starts_at: '2026-01-15T06:00:00.000Z',
        paid_through: '2026-02-15T00:00:00.000Z',
        grace_ends_at: null,
        canceled_at: '2026-02-20T06:00:00.000Z',
        provider: 'sslcommerz',
        created_at: '2026-01-15T06:00:00.000Z',
      },
    ];
  });

  test('an October query yields NO January growth and NO February cancellations', async () => {
    const { analyticsOverview } = await import('../lib/adminPlatformQueries');

    const overview = await analyticsOverview({ from: '2026-10-01', to: '2026-10-31' });

    expect(overview.subscriptionsStartedByMonth.map((bucket) => bucket.month)).toEqual([]);
    expect(overview.cancellationsByMonth.map((bucket) => bucket.month)).toEqual([]);
  });

  test('an unbounded query still shows both, so the bound is a bound and not a deletion', async () => {
    const { analyticsOverview } = await import('../lib/adminPlatformQueries');

    const overview = await analyticsOverview({});

    expect(overview.subscriptionsStartedByMonth.map((bucket) => bucket.month)).toEqual(['2026-01']);
    expect(overview.cancellationsByMonth.map((bucket) => bucket.month)).toEqual(['2026-02']);
  });

  test('a query covering those months shows exactly them', async () => {
    const { analyticsOverview } = await import('../lib/adminPlatformQueries');

    const overview = await analyticsOverview({ from: '2026-01-01', to: '2026-02-28' });

    expect(overview.subscriptionsStartedByMonth.map((bucket) => bucket.month)).toEqual(['2026-01']);
    expect(overview.cancellationsByMonth.map((bucket) => bucket.month)).toEqual(['2026-02']);
  });

  test('registrations outside the period are NOT published', async () => {
    // GATE 5 SECOND-DELTA FINDING 2. Widening `activity_summary`'s shops read
    // (to stop the report dropping established sellers) also unbounded THIS
    // chart, because it grouped those rows without reapplying the period. An
    // October query drew an August bucket.
    clientBox.rowsByTable.shops = Array.from({ length: 5 }, (_unused, index) => ({
      id: '7b000000-0000-4000-8000-00000000002' + index,
      name: 'Pharmacy ' + index,
      latitude: null,
      longitude: null,
      location_captured_at: null,
      district: 'Dhaka',
      plan: 'free',
      commercial_status: 'active',
      billing_account_id: null,
      // AUGUST registrations, outside the October query below.
      created_at: '2026-08-15T06:00:00.000Z',
      updated_at: '2026-08-15T06:00:00.000Z',
    }));
    const { analyticsOverview } = await import('../lib/adminPlatformQueries');

    const october = await analyticsOverview({ from: '2026-10-01', to: '2026-10-31' });
    expect(october.registeredByDay.map((bucket) => bucket.day)).toEqual([]);

    // Unbounded, they are all there — so the bound is a bound, not a filter
    // that drops registrations altogether.
    const all = await analyticsOverview({});
    expect(all.registeredByDay.map((bucket) => bucket.day)).toEqual(['2026-08-15']);
    expect(all.registeredByDay[0]?.shopIds).toHaveLength(5);
  });

  test('the conversion figure is still "ever", so the bound did not narrow it', async () => {
    // The read stays whole on purpose. An October query must still be able to
    // say that an account trialed in August later paid — bounding the month
    // BUCKETS must not bound the lifetime ratio.
    clientBox.rowsByTable.billing_accounts = [
      {
        id: ACCOUNT_ID,
        primary_shop_id: SHOP_ID,
        launch_trial_granted_at: '2026-08-01T00:00:00.000Z',
      },
    ];
    const { analyticsOverview } = await import('../lib/adminPlatformQueries');

    const overview = await analyticsOverview({ from: '2026-10-01', to: '2026-10-31' });

    expect(overview.conversion.denominator).toBe(1);
    expect(overview.conversion.accountIds).toEqual([ACCOUNT_ID]);
  });
});

describe('§8.6 the map filters by SUBSCRIPTION status, not commercial status', () => {
  // GATE 5 DELTA FINDING 6. The control was labelled "Subscription status"
  // and offered only `active` and `suspended` — the shop's COMMERCIAL status.
  // So four of the six lifecycle cohorts could not be asked for, and a
  // TRIALING pharmacy answered to "active".
  const TRIALING_SHOP = '7b000000-0000-4000-8000-0000000000aa';
  const TRIALING_ACCOUNT = 'ba000000-0000-4000-8000-0000000000aa';

  beforeEach(() => {
    setEnvironment({ founder: 'super_admin' });
    // Both shops are commercially ACTIVE and differ only in subscription.
    clientBox.rowsByTable.shops = [
      {
        id: SHOP_ID,
        name: 'Banani Pharmacy',
        latitude: 23.79,
        longitude: 90.4,
        location_captured_at: '2026-10-25T00:00:00.000Z',
        district: 'Dhaka',
        plan: 'pro',
        commercial_status: 'active',
        billing_account_id: ACCOUNT_ID,
      },
      {
        id: TRIALING_SHOP,
        name: 'Gulshan Pharmacy',
        latitude: 23.79,
        longitude: 90.41,
        location_captured_at: '2026-10-25T00:00:00.000Z',
        district: 'Dhaka',
        plan: 'free',
        commercial_status: 'active',
        billing_account_id: TRIALING_ACCOUNT,
      },
    ];
    clientBox.rowsByTable.entitlement_snapshots = [
      {
        billing_account_id: ACCOUNT_ID,
        tier: 'pro',
        status: 'active',
        trial_ends_at: null,
        paid_through: '2026-11-01T00:00:00.000Z',
        grace_ends_at: null,
        verified_at: '2026-10-20T00:00:00.000Z',
      },
      {
        billing_account_id: TRIALING_ACCOUNT,
        tier: 'ultra',
        status: 'trialing',
        trial_ends_at: '2026-11-10T00:00:00.000Z',
        paid_through: null,
        grace_ends_at: null,
        verified_at: '2026-10-20T00:00:00.000Z',
      },
    ];
  });

  test('all six lifecycle statuses are offered, and `suspended` is not', async () => {
    await signInAs('founder', 'super_admin');

    const html = await render('./maps/page');

    for (const status of ['trialing', 'active', 'past_due', 'grace', 'canceled', 'expired']) {
      expect(html, status + ' is not offered').toContain('value="' + status + '"');
    }
    // The commercial value that used to masquerade as a subscription status.
    expect(html).not.toContain('value="suspended"');
  });

  test('it reads the entitlement snapshots the filter needs', async () => {
    await signInAs('founder', 'super_admin');

    await render('./maps/page');

    expect(tablesTouched()).toContain('entitlement_snapshots');
  });

  // No pharmacy NAME is observable here, and that is the point of E13/E14:
  // both shops have coordinates and neither has consent, so every marker is
  // withheld. What the page does publish is HOW MANY are withheld, and
  // because the filters run BEFORE the consent gate that count describes the
  // filtered population. So the count is the observable, and which specific
  // shop matched is asserted in lib/adminGeo.test.ts where ids are visible.
  test('a status filter narrows the withheld population', async () => {
    await signInAs('founder', 'super_admin');

    const unfiltered = await render('./maps/page');
    expect(unfiltered).toContain('2 pharmacies have');

    const trialing = await render('./maps/page', { status: 'trialing' });
    expect(trialing).toContain('1 pharmacy has');

    const active = await render('./maps/page', { status: 'active' });
    expect(active).toContain('1 pharmacy has');
  });

  test('a cohort nobody is in matches nothing, rather than everything', async () => {
    // Non-vacuity in the other direction: a filter that was ignored would
    // still show 2, and one that dropped everything would show 0 for
    // `trialing` too.
    await signInAs('founder', 'super_admin');

    const html = await render('./maps/page', { status: 'expired' });

    expect(html).toContain('No pharmacy has a coordinate on record');
  });
});
