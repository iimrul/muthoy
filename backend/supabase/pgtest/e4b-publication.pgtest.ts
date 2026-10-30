import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, migrationSql, seedShops, type Harness } from './harness';

// E4-B / migration 36 — the publication snapshot's EFFECTIVE behaviour, on a
// real Postgres.
//
// The same two layers e4-admin-platform.pgtest.ts established, because neither
// alone is enough: what `has_table_privilege` reports, and what the database
// actually does when the write is attempted. An immutable table whose
// privileges look right and whose rows can still be edited is the failure this
// file exists to prevent — and "immutable" is the entire value proposition
// here, so it is tested by trying to break it rather than by reading a
// catalogue.
//
// WHY THE NEGATIVES CARRY THE WEIGHT. A publication mechanism that publishes is
// easy. The properties that make it a PRIVACY control are all refusals: it must
// refuse a partial month, a second cohort, an ineligible period, a revision, a
// deletion, and a direct insert that skips the audit row. Every one of those is
// asserted below as a refusal with its SQLSTATE, not as an absence.

const PUBLISHER = 'founder@muthoy.test';
const METRIC = 'refund_net_pharmacy_sales';
const COHORT = 'platform_all';

interface Refusal {
  code: string | null;
  message: string;
}

/** The 15 arguments, in the function's declared order. */
interface PublishArgs {
  metric?: string;
  cohort?: string;
  start?: string;
  end?: string;
  gross?: number;
  refunds?: number;
  value?: number;
  saleRows?: number;
  refundRows?: number;
  digest?: string;
  k?: number;
  contributors?: number;
  daysRequiring?: number;
  daysClearing?: number;
  by?: string;
}

const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);

/** Single-quoted SQL literal. Test-local inputs only; nothing here is a user value. */
function quote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function publishCall(args: PublishArgs = {}): string {
  const a = {
    metric: METRIC,
    cohort: COHORT,
    start: '2026-09-01',
    end: '2026-09-30',
    gross: 50_000,
    refunds: 10_000,
    value: 40_000,
    saleRows: 12,
    refundRows: 7,
    digest: DIGEST_A,
    k: 5,
    contributors: 6,
    daysRequiring: 3,
    daysClearing: 3,
    by: PUBLISHER,
    ...args,
  };
  return `select * from publish_financial_snapshot(
    ${quote(a.metric)}, ${quote(a.cohort)}, ${quote(a.start)}::date, ${quote(a.end)}::date,
    ${a.gross}::bigint, ${a.refunds}::bigint, ${a.value}::bigint,
    ${a.saleRows}::integer, ${a.refundRows}::integer, ${quote(a.digest)},
    ${a.k}::integer, ${a.contributors}::integer,
    ${a.daysRequiring}::integer, ${a.daysClearing}::integer, ${quote(a.by)})`;
}

/** An INSERT straight at the table, for the constraint-level assertions. */
function rawInsert(values: string): string {
  return `insert into public.financial_publications
      (metric_family, cohort_key, period_grain, period_start, period_end,
       gross_paisa, refunds_paisa, value_paisa, source_sale_rows, source_refund_rows,
       source_digest, k_floor, contributor_count, days_requiring_floor,
       days_clearing_floor, published_by)
    values (${values})`;
}

describe('E4-B publication snapshots', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
    await seedShops(h);
  }, 180_000);
  afterAll(async () => {
    await h?.close();
  });

  function describeError(error: unknown): Refusal {
    const code =
      error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
        ? (error as { code: string }).code
        : null;
    return { code, message: error instanceof Error ? error.message : String(error) };
  }

  /** Runs `sql` as `role` and reports the SQLSTATE rather than throwing. */
  async function attempt(role: string, sql: string): Promise<Refusal | null> {
    return h.as(role, null, async () => {
      try {
        await h.exec(sql);
        return null;
      } catch (error) {
        return describeError(error);
      }
    });
  }

  /** Runs `sql` as the OWNER, which holds every privilege the REVOKEs removed. */
  async function attemptAsOwner(sql: string): Promise<Refusal | null> {
    try {
      await h.exec(sql);
      return null;
    } catch (error) {
      return describeError(error);
    }
  }

  async function publicationCount(): Promise<number> {
    const row = await h.one<{ n: string }>(
      'select count(*)::text as n from public.financial_publications',
    );
    return Number(row.n);
  }

  // ───────────────────────────────────────────── the object and its privileges

  it('created the table with RLS on and no policy at all', async () => {
    const row = await h.one<{ relrowsecurity: boolean; policies: string }>(`
      select c.relrowsecurity,
             (select count(*)::text from pg_policy p where p.polrelid = c.oid) as policies
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = 'financial_publications'`);
    expect(row.relrowsecurity).toBe(true);
    // NO POLICY is the point, not an omission: with RLS on and no policy the
    // API roles reach nothing at all, and service_role's BYPASSRLS is what the
    // panel reads through. A policy here would be a way in.
    expect(row.policies).toBe('0');
  });

  it('gives service_role SELECT and nothing else', async () => {
    const row = await h.one<Record<string, boolean>>(`
      select has_table_privilege('service_role', 'public.financial_publications', 'select') as sel,
             has_table_privilege('service_role', 'public.financial_publications', 'insert') as ins,
             has_table_privilege('service_role', 'public.financial_publications', 'update') as upd,
             has_table_privilege('service_role', 'public.financial_publications', 'delete') as del,
             has_table_privilege('service_role', 'public.financial_publications', 'truncate') as trunc`);
    expect(row.sel).toBe(true);
    // INSERT is absent BY DESIGN. The only writer is the SECURITY DEFINER
    // function, which is what makes "a publication without an audit row cannot
    // exist" true rather than a convention the panel is trusted to follow.
    expect(row.ins).toBe(false);
    expect(row.upd).toBe(false);
    expect(row.del).toBe(false);
    expect(row.trunc).toBe(false);
  });

  const SIGNATURE =
    'public.publish_financial_snapshot(text,text,date,date,bigint,bigint,bigint,integer,integer,text,integer,integer,integer,integer,text)';

  it('gives anon and authenticated nothing, and service_role EXECUTE', async () => {
    const row = await h.one<Record<string, boolean>>(`
      select has_table_privilege('anon', 'public.financial_publications', 'select') as anon_sel,
             has_table_privilege('authenticated', 'public.financial_publications', 'select') as auth_sel,
             has_function_privilege('anon', ${quote(SIGNATURE)}, 'execute') as anon_exec,
             has_function_privilege('authenticated', ${quote(SIGNATURE)}, 'execute') as auth_exec,
             has_function_privilege('service_role', ${quote(SIGNATURE)}, 'execute') as svc_exec`);
    expect(row.anon_sel).toBe(false);
    expect(row.auth_sel).toBe(false);
    expect(row.anon_exec).toBe(false);
    expect(row.auth_exec).toBe(false);
    expect(row.svc_exec).toBe(true);
  });

  it('declares the function SECURITY DEFINER with a pinned search_path', async () => {
    const row = await h.one<{ prosecdef: boolean; config: string | null }>(`
      select p.prosecdef, array_to_string(p.proconfig, ',') as config
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'publish_financial_snapshot'`);
    expect(row.prosecdef).toBe(true);
    // A SECURITY DEFINER function that resolves admin_audit_log through a
    // caller-controlled search_path executes the CALLER's table as the owner.
    expect(row.config ?? '').toContain('search_path=public, pg_temp');
  });

  // ─────────────────────────────────────────────────── authorized publication

  it('publishes an eligible month, and reports that it published it', async () => {
    const before = await publicationCount();
    const rows = await h.as('service_role', null, async () =>
      h.all<{ published_now: boolean; published_value_paisa: string }>(publishCall()),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.published_now).toBe(true);
    expect(Number(rows[0]!.published_value_paisa)).toBe(40_000);
    expect(await publicationCount()).toBe(before + 1);
  });

  it('wrote the audit row in the SAME transaction as the publication', async () => {
    const row = await h.one<{ action: string; actor: string; outcome: string; value: string }>(`
      select action, actor, outcome, (meta->>'value_paisa') as value
        from public.admin_audit_log
       where target = ${quote(`${METRIC}:${COHORT}:2026-09`)}
         and action = 'publication.published'`);
    expect(row.action).toBe('publication.published');
    expect(row.actor).toBe(PUBLISHER);
    expect(row.outcome).toBe('success');
    expect(Number(row.value)).toBe(40_000);
  });

  it('records the provenance it was given, not a recomputation', async () => {
    const row = await h.one<Record<string, string>>(`
      select gross_paisa::text as gross, refunds_paisa::text as refunds,
             value_paisa::text as value, source_sale_rows::text as sale_rows,
             source_refund_rows::text as refund_rows, source_digest,
             k_floor::text as k, contributor_count::text as contributors,
             days_requiring_floor::text as requiring, days_clearing_floor::text as clearing,
             period_end::text as period_end
        from public.financial_publications where period_start = '2026-09-01'`);
    expect(Number(row.gross)).toBe(50_000);
    expect(Number(row.refunds)).toBe(10_000);
    expect(Number(row.value)).toBe(40_000);
    expect(Number(row.sale_rows)).toBe(12);
    expect(Number(row.refund_rows)).toBe(7);
    expect(row.source_digest).toBe(DIGEST_A);
    expect(Number(row.k)).toBe(5);
    expect(Number(row.contributors)).toBe(6);
    expect(Number(row.requiring)).toBe(3);
    expect(Number(row.clearing)).toBe(3);
    expect(row.period_end).toBe('2026-09-30');
  });

  // ──────────────────────────────────── duplicate and concurrent publication

  it('a second publication of the same month writes NO second row', async () => {
    const before = await publicationCount();
    // A DIFFERENT VALUE, deliberately. The second caller has recomputed and got
    // 390.00 because a late refund arrived. If the mechanism took the new
    // figure, or stored it alongside the old one, the pair would be exactly the
    // disclosure this table exists to prevent.
    const rows = await h.as('service_role', null, async () =>
      h.all<{ published_now: boolean; published_value_paisa: string }>(
        publishCall({ refunds: 11_000, value: 39_000, digest: DIGEST_B }),
      ),
    );
    expect(rows[0]!.published_now).toBe(false);
    // The FIRST value, unchanged.
    expect(Number(rows[0]!.published_value_paisa)).toBe(40_000);
    expect(await publicationCount()).toBe(before);
    const stored = await h.one<{ value: string; digest: string }>(
      `select value_paisa::text as value, source_digest as digest
         from public.financial_publications where period_start = '2026-09-01'`,
    );
    expect(Number(stored.value)).toBe(40_000);
    expect(stored.digest).toBe(DIGEST_A);
  });

  it('records the repeat attempt in the audit log, as a distinct action', async () => {
    const row = await h.one<{ n: string }>(`
      select count(*)::text as n from public.admin_audit_log
       where action = 'publication.already_published'
         and target = ${quote(`${METRIC}:${COHORT}:2026-09`)}`);
    // Who tried to publish an already-published period is exactly what an
    // auditor asks, so it is recorded rather than silently swallowed.
    expect(Number(row.n)).toBe(1);
  });

  it('the unique constraint, not the function, is what makes that true', async () => {
    // THE CONCURRENCY CONTROL, tested directly as the OWNER so the function's
    // `on conflict do nothing` cannot be what passes this. Two sessions racing
    // to publish one period both reach this index, and one of them loses.
    //
    // HONEST LIMIT: PGlite is a single connection, so this proves the
    // CONSTRAINT exists and fires, not that it serialises two simultaneous
    // transactions. The latter is a Postgres guarantee about unique indexes
    // rather than a property of this schema, and nothing here measures it.
    const refusal = await attemptAsOwner(
      rawInsert(`${quote(METRIC)}, ${quote(COHORT)}, 'month', '2026-09-01', '2026-09-30',
         1, 0, 1, 1, 0, ${quote(DIGEST_B)}, 5, 6, 1, 1, 'someone-else'`),
    );
    expect(refusal?.code).toBe('23505');
    expect(refusal?.message).toContain('financial_publications_identity');
  });

  // ───────────────────────────────────────────────────────────── immutability

  it('refuses an UPDATE even from the table OWNER', async () => {
    const refusal = await attemptAsOwner(
      "update public.financial_publications set value_paisa = 1 where period_start = '2026-09-01'",
    );
    // The owner has the privilege; the trigger is what refuses. This is the
    // case the REVOKE cannot cover — a later migration or an operator at a
    // superuser prompt who re-grants UPDATE without reading the file.
    expect(refusal?.code).toBe('23001');
    expect(refusal?.message).toContain('append-only');
    const row = await h.one<{ value: string }>(
      `select value_paisa::text as value from public.financial_publications
        where period_start = '2026-09-01'`,
    );
    expect(Number(row.value)).toBe(40_000);
  });

  it('refuses a DELETE even from the table OWNER', async () => {
    const before = await publicationCount();
    const refusal = await attemptAsOwner(
      "delete from public.financial_publications where period_start = '2026-09-01'",
    );
    expect(refusal?.code).toBe('23001');
    expect(await publicationCount()).toBe(before);
  });

  it('refuses a TRUNCATE even from the table OWNER', async () => {
    const before = await publicationCount();
    const refusal = await attemptAsOwner('truncate table public.financial_publications');
    expect(refusal?.code).toBe('23001');
    expect(await publicationCount()).toBe(before);
  });

  it('refuses a direct INSERT from service_role, which has no way in but the function', async () => {
    const refusal = await attempt(
      'service_role',
      rawInsert(`${quote(METRIC)}, ${quote(COHORT)}, 'month', '2026-11-01', '2026-11-30',
          1, 0, 1, 1, 0, ${quote(DIGEST_A)}, 5, 6, 1, 1, 'bypass'`),
    );
    // 42501 insufficient_privilege. An INSERT that succeeded here would be a
    // publication with no audit row and no eligibility check.
    expect(refusal?.code).toBe('42501');
  });

  // ────────────────────────────────────── the privacy refusals, by SQLSTATE

  it('refuses a period whose trading days did not all clear the floor', async () => {
    const refusal = await attempt(
      'service_role',
      publishCall({ start: '2026-10-01', end: '2026-10-31', daysRequiring: 4, daysClearing: 2 }),
    );
    expect(refusal?.code).toBe('23001');
    // The reason has to be READABLE, or it is a refusal somebody works around.
    expect(refusal?.message).toContain('2 of 4 days');
    expect(refusal?.message).toContain('not publishable');
  });

  it('refuses a period with trade whose cohort is below the floor', async () => {
    const refusal = await attempt(
      'service_role',
      publishCall({ start: '2026-10-01', end: '2026-10-31', contributors: 4 }),
    );
    expect(refusal?.code).toBe('23001');
    expect(refusal?.message).toContain('below the k=5 floor');
  });

  it('ALLOWS a period with no trade at all and no contributors', async () => {
    // NON-VACUITY FOR THE TWO RULES ABOVE. If every ineligible shape were
    // refused and nothing were ever allowed, those tests would pass against a
    // function that refuses everything. A month nobody traded in discloses
    // nothing about anybody, so it publishes with zero contributors.
    const rows = await h.as('service_role', null, async () =>
      h.all<{ published_now: boolean }>(
        publishCall({
          start: '2026-08-01',
          end: '2026-08-31',
          gross: 0,
          refunds: 0,
          value: 0,
          saleRows: 0,
          refundRows: 0,
          contributors: 0,
          daysRequiring: 0,
          daysClearing: 0,
        }),
      ),
    );
    expect(rows[0]!.published_now).toBe(true);
  });

  it('refuses a period that does not start on the first of a month', async () => {
    const refusal = await attemptAsOwner(
      rawInsert(`${quote(METRIC)}, ${quote(COHORT)}, 'month', '2026-07-05', '2026-07-31',
         1, 0, 1, 1, 0, ${quote(DIGEST_A)}, 5, 6, 1, 1, 'x'`),
    );
    expect(refusal?.code).toBe('23514');
    expect(refusal?.message).toContain('whole_month');
  });

  it('refuses a period_end that is not the month end', async () => {
    const refusal = await attemptAsOwner(
      rawInsert(`${quote(METRIC)}, ${quote(COHORT)}, 'month', '2026-07-01', '2026-07-20',
         1, 0, 1, 1, 0, ${quote(DIGEST_A)}, 5, 6, 1, 1, 'x'`),
    );
    expect(refusal?.code).toBe('23514');
    expect(refusal?.message).toContain('whole_month');
  });

  it('accepts February in a leap year, so the month rule is arithmetic not a table', async () => {
    const accepted = await attemptAsOwner(
      rawInsert(`${quote(METRIC)}, ${quote(COHORT)}, 'month', '2028-02-01', '2028-02-29',
         1, 0, 1, 1, 0, ${quote(DIGEST_A)}, 5, 6, 1, 1, 'x'`),
    );
    expect(accepted).toBeNull();
  });

  it('refuses a SECOND cohort, which is the complementary-release control', async () => {
    const refusal = await attemptAsOwner(
      rawInsert(`${quote(METRIC)}, 'banani', 'month', '2026-09-01', '2026-09-30',
         1, 0, 1, 1, 0, ${quote(DIGEST_A)}, 5, 6, 1, 1, 'x'`),
    );
    // "all shops, September" minus "Banani, September" is "non-Banani,
    // September", which need not clear any floor though both publications did.
    // There is no second cohort to difference against, by CHECK.
    expect(refusal?.code).toBe('23514');
    expect(refusal?.message).toContain('cohort_key');
  });

  it('refuses a metric family that is not the declared one', async () => {
    const refusal = await attemptAsOwner(
      rawInsert(`'subscription_revenue_and_renewals', ${quote(COHORT)}, 'month',
         '2026-09-01', '2026-09-30', 1, 0, 1, 1, 0, ${quote(DIGEST_A)}, 5, 6, 1, 1, 'x'`),
    );
    // Muthoy's own billing is published without a pharmacy floor by founder
    // decision 4 and has no revision channel into protected data, so it has no
    // business in this table.
    expect(refusal?.code).toBe('23514');
    expect(refusal?.message).toContain('metric_family');
  });

  it('refuses a value that is not gross minus refunds', async () => {
    const refusal = await attemptAsOwner(
      rawInsert(`${quote(METRIC)}, ${quote(COHORT)}, 'month', '2026-06-01', '2026-06-30',
         500, 100, 450, 1, 0, ${quote(DIGEST_A)}, 5, 6, 1, 1, 'x'`),
    );
    // W4-04's subtraction, asserted rather than trusted (CLAUDE.md rule 4).
    expect(refusal?.code).toBe('23514');
    expect(refusal?.message).toContain('_net');
  });

  it('refuses a malformed source digest', async () => {
    const refusal = await attempt(
      'service_role',
      publishCall({ start: '2026-05-01', end: '2026-05-31', digest: 'not-a-digest' }),
    );
    expect(refusal?.code).toBe('23514');
    expect(refusal?.message).toContain('source_digest');
  });

  it('refuses a negative gross total', async () => {
    const refusal = await attemptAsOwner(
      rawInsert(`${quote(METRIC)}, ${quote(COHORT)}, 'month', '2026-04-01', '2026-04-30',
         -1, 0, -1, 1, 0, ${quote(DIGEST_A)}, 5, 6, 1, 1, 'x'`),
    );
    expect(refusal?.code).toBe('23514');
  });
});

// ─────────────────────────────────────────────────────────────── class B, proven

describe('E4-B rollback and reapplication', () => {
  let h: Harness;

  // A HARNESS OF ITS OWN. This describe drops the migration's objects, and
  // sharing the one above would make every test's result depend on the order
  // vitest happened to run them in.
  beforeAll(async () => {
    h = await createHarness();
  }, 180_000);
  afterAll(async () => {
    await h?.close();
  });

  it('reverses by dropping the function and the table, which is what class B means', async () => {
    // ROLLBACK.md classifies migration 36 as B and states this exact pair, in
    // this order. A documented reversal nobody has executed is a claim; this
    // executes it.
    await h.exec(`drop function public.publish_financial_snapshot(
      text,text,date,date,bigint,bigint,bigint,integer,integer,text,integer,integer,integer,integer,text)`);
    await h.exec('drop table public.financial_publications');
    const row = await h.one<{ tables: string; functions: string }>(`
      select (select count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
               where n.nspname = 'public' and c.relname = 'financial_publications') as tables,
             (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname = 'publish_financial_snapshot') as functions`);
    expect(row.tables).toBe('0');
    expect(row.functions).toBe('0');
  });

  it('keeps admin_audit_log, so the record of what was published survives the rollback', async () => {
    // THE REASON THIS MIGRATION IS CLASS B AND NOT C. The publication EVIDENCE
    // lives in admin_audit_log, which migration 35 ships and classifies as C.
    // Dropping this table loses the serving copy, not the record — so there is
    // one class-C store whose only recovery is a restore, not two.
    const row = await h.one<{ n: string }>(`
      select count(*)::text as n from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = 'admin_audit_log'`);
    expect(row.n).toBe('1');
  });

  it('re-applies cleanly afterwards, so the migration is idempotent forward', async () => {
    await h.exec(migrationSql('20261030000000_e4b_publication_snapshots.sql'));
    // And AGAIN, because `if not exists` / `create or replace` /
    // `drop trigger if exists` are only idempotent if all three are.
    await h.exec(migrationSql('20261030000000_e4b_publication_snapshots.sql'));
    const row = await h.one<{ triggers: string }>(`
      select count(*)::text as triggers from pg_trigger t
        join pg_class c on c.oid = t.tgrelid
       where c.relname = 'financial_publications' and not t.tgisinternal`);
    // Two triggers, not four: a second apply must not stack them.
    expect(row.triggers).toBe('2');
  });
});
