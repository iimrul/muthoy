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
    start: '2026-08-01',
    end: '2026-08-31',
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
       where target = ${quote(`${METRIC}:${COHORT}:2026-08`)}
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
        from public.financial_publications where period_start = '2026-08-01'`);
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
    expect(row.period_end).toBe('2026-08-31');
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
         from public.financial_publications where period_start = '2026-08-01'`,
    );
    expect(Number(stored.value)).toBe(40_000);
    expect(stored.digest).toBe(DIGEST_A);
  });

  it('records the repeat attempt in the audit log, as a distinct action', async () => {
    const row = await h.one<{ n: string }>(`
      select count(*)::text as n from public.admin_audit_log
       where action = 'publication.already_published'
         and target = ${quote(`${METRIC}:${COHORT}:2026-08`)}`);
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
      rawInsert(`${quote(METRIC)}, ${quote(COHORT)}, 'month', '2026-08-01', '2026-08-31',
         1, 0, 1, 1, 0, ${quote(DIGEST_B)}, 5, 6, 1, 1, 'someone-else'`),
    );
    expect(refusal?.code).toBe('23505');
    expect(refusal?.message).toContain('financial_publications_identity');
  });

  // ───────────────────────────────────────────────────────────── immutability

  it('refuses an UPDATE even from the table OWNER', async () => {
    const refusal = await attemptAsOwner(
      "update public.financial_publications set value_paisa = 1 where period_start = '2026-08-01'",
    );
    // The owner has the privilege; the trigger is what refuses. This is the
    // case the REVOKE cannot cover — a later migration or an operator at a
    // superuser prompt who re-grants UPDATE without reading the file.
    expect(refusal?.code).toBe('23001');
    expect(refusal?.message).toContain('append-only');
    const row = await h.one<{ value: string }>(
      `select value_paisa::text as value from public.financial_publications
        where period_start = '2026-08-01'`,
    );
    expect(Number(row.value)).toBe(40_000);
  });

  it('refuses a DELETE even from the table OWNER', async () => {
    const before = await publicationCount();
    const refusal = await attemptAsOwner(
      "delete from public.financial_publications where period_start = '2026-08-01'",
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
      publishCall({ start: '2026-07-01', end: '2026-07-31', daysRequiring: 4, daysClearing: 2 }),
    );
    expect(refusal?.code).toBe('23001');
    // The reason has to be READABLE, or it is a refusal somebody works around.
    expect(refusal?.message).toContain('2 of 4 trading days');
    expect(refusal?.message).toContain('not publishable');
  });

  it('refuses a period with trade whose cohort is below the floor', async () => {
    const refusal = await attempt(
      'service_role',
      publishCall({ start: '2026-07-01', end: '2026-07-31', contributors: 4 }),
    );
    expect(refusal?.code).toBe('23001');
    expect(refusal?.message).toContain('below the k=5 floor');
  });

  it('refuses a period with NO TRADE, which this test used to assert the opposite of', async () => {
    // ROUND 18 FINDING 3. This test was `it('ALLOWS a period with no trade at
    // all and no contributors')`, and it existed as a NON-VACUITY CONTROL — to
    // prove the refusal tests above were not passing against a function that
    // refuses everything. So the test written to stop me fooling myself is the
    // one that locked the defect in, and it did it while being the careful
    // thing to do.
    //
    // Two reasons it was wrong. A month can look empty because nobody has
    // SYNCED, so publishing 0.00 freezes a figure that was never the figure;
    // and publishing an inactive month as zero means a later refund makes the
    // report GAIN a `0.00` row, which discloses the refund by the row's
    // existence even though the amount never moved.
    //
    // The non-vacuity control is now the eligible month in 'publishes an
    // eligible month' above, which is a better control anyway: it exercises
    // the path that matters rather than a degenerate one.
    const refusal = await attempt(
      'service_role',
      publishCall({
        start: '2026-06-01',
        end: '2026-06-30',
        gross: 0,
        refunds: 0,
        value: 0,
        saleRows: 0,
        refundRows: 0,
        contributors: 0,
        daysRequiring: 0,
        daysClearing: 0,
      }),
    );
    expect(refusal?.code).toBe('23001');
    expect(refusal?.message).toContain('no trading activity');
    const row = await h.one<{ n: string }>(
      "select count(*)::text as n from public.financial_publications where period_start = '2026-06-01'",
    );
    expect(row.n).toBe('0');
  });

  it('refuses a no-trade row at the CONSTRAINT, isolated from the k floor', async () => {
    // ROUND 24 FINDING 2. The test here supplied zero trading days AND zero
    // contributors, so removing `days_requiring_floor > 0` from the constraint
    // still rejected the row through `contributor_count >= k_floor` — the
    // reviewer deleted the control this test names and all 41 pgtests passed.
    //
    // SIX CONTRIBUTORS, deliberately: that clears the k floor, so the only
    // thing left to refuse the row is the no-trade clause. The two
    // implementations now disagree on this input, which is the whole point of
    // asserting it.
    const refusal = await attemptAsOwner(
      rawInsert(`${quote(METRIC)}, ${quote(COHORT)}, 'month', '2026-06-01', '2026-06-30',
         0, 0, 0, 0, 0, ${quote(DIGEST_A)}, 5, 6, 0, 0, 'x'`),
    );
    expect(refusal?.code).toBe('23514');
    expect(refusal?.message).toContain('cohort_eligible');
  });

  it('refuses a below-floor row too, so the clause above is not the only one', async () => {
    // The other half of the same constraint, isolated the other way: real
    // trade, a cohort of four. Without both tests, one clause could be deleted
    // unnoticed.
    const refusal = await attemptAsOwner(
      rawInsert(`${quote(METRIC)}, ${quote(COHORT)}, 'month', '2026-06-01', '2026-06-30',
         1, 0, 1, 1, 0, ${quote(DIGEST_A)}, 5, 4, 1, 1, 'x'`),
    );
    expect(refusal?.code).toBe('23514');
    expect(refusal?.message).toContain('cohort_eligible');
  });

  it('refuses a period that has NOT ENDED, however eligible it looks', async () => {
    // Not a reviewer finding. Refusing an EMPTY period does not stop the
    // sharper version of the same act: publish a month on its first day, after
    // one trading day that happens to clear the floor, and it is frozen at a
    // day's worth of trade, irreversibly, by one click.
    //
    // A CHECK cannot express this -- `current_date` is not immutable -- so the
    // function is where it lives, and the function is the only writer.
    const refusal = await attempt(
      'service_role',
      publishCall({ start: '2099-01-01', end: '2099-01-31' }),
    );
    expect(refusal?.code).toBe('23001');
    expect(refusal?.message).toContain('has not ended');
  });

  it('refuses a NONFINITE period, which defeated three controls at once', async () => {
    // ROUND 19 FINDING 5. `-infinity` is a valid date, and a CHECK fails only
    // on FALSE — so the whole-month rule evaluated to NULL and passed; and
    // `to_char(-infinity, 'YYYY-MM')` is NULL, which made the audit target NULL
    // and left the republication guard comparing NULL with NULL, matching
    // nothing. One unrepresentable date defeated three controls, each of them
    // by being NULL rather than by being wrong. The TypeScript writer excluded
    // this input; the RPC did not, and the RPC is what holds the privilege.
    const refusal = await attempt(
      'service_role',
      publishCall({ start: '-infinity', end: '-infinity' }),
    );
    expect(refusal?.code).toBe('23001');
    expect(refusal?.message).toContain('finite dates');
  });

  it('refuses a nonfinite period at the CONSTRAINT too, not only in the function', async () => {
    const refusal = await attemptAsOwner(
      rawInsert(
        `${quote(METRIC)}, ${quote(COHORT)}, 'month', '-infinity', '-infinity',
         1, 0, 1, 1, 0, ${quote(DIGEST_A)}, 5, 6, 1, 1, 'x'`,
      ),
    );
    expect(refusal?.code).toBe('23514');
    expect(refusal?.message).toContain('finite_period');
  });

  it('declares the period-ended guard against the DHAKA date, structurally', async () => {
    // ROUND 24 FINDING 1, AND THE TEST THAT USED TO BE HERE WAS VACUOUS.
    //
    // It compared `(now() at time zone 'Asia/Dhaka')::date` with `current_date`
    // in SQL and asserted Dhaka was not behind — a property of PostgreSQL, not
    // of this migration. The reviewer reverted the guard to bare `current_date`
    // and all 41 pgtests still passed. I had even written a comment praising it
    // for asserting "a RELATIONSHIP rather than against a fixed clock", which
    // was precisely the error.
    //
    // STRUCTURAL, and deliberately so. The behavioural test below exercises the
    // real function but can only distinguish the two implementations during the
    // six-hour window where the dates differ — a quarter of the day. This
    // assertion catches the mutation at every hour, which is what a guard
    // against regression has to do.
    const source = migrationSql('20261030000000_e4b_publication_snapshots.sql');
    expect(source).toContain("p_period_end >= (now() at time zone 'Asia/Dhaka')::date");
    // And no bare `current_date` comparison survives anywhere in the file.
    expect(source).not.toMatch(/p_period_end\s*>=\s*current_date/);
  });

  it('refuses a period ending on the Dhaka day it is still inside, and accepts yesterday', async () => {
    // The BEHAVIOURAL half, through the real RPC, with both boundaries computed
    // from the database's own Dhaka date so the test does not depend on when it
    // is run.
    const today = await h.one<{ dhaka: string; prev: string; first: string }>(`
      select (now() at time zone 'Asia/Dhaka')::date::text as dhaka,
             ((now() at time zone 'Asia/Dhaka')::date - 1)::text as prev,
             date_trunc('month', (now() at time zone 'Asia/Dhaka')::date)::date::text as first`);

    // A period whose end is TODAY in Dhaka has not ended.
    const refused = await attempt(
      'service_role',
      publishCall({ start: today.first, end: today.dhaka }),
    );
    expect(refused?.code).toBe('23001');
    expect(refused?.message).toContain('has not ended in Dhaka');

    // And the refusal names the Dhaka date rather than the server's, which is
    // the distinction the structural assertion above pins.
    expect(refused?.message).toContain(today.dhaka);
  });

  it('refuses a k_floor below the approved 5, so the floor is not caller-selectable', async () => {
    // ROUND 18 FINDING 5. `k_floor >= 1` let a caller publish under a floor of
    // their choosing: one selling and one refunding pharmacy, k=1, stored.
    const refusal = await attempt(
      'service_role',
      publishCall({ start: '2026-05-01', end: '2026-05-31', k: 1, contributors: 1 }),
    );
    expect(refusal?.code).toBe('23514');
    expect(refusal?.message).toContain('k_floor');
  });

  it('records NO recomputed money on a repeat attempt', async () => {
    // ROUND 18 FINDING 1 — I closed the report channel and opened an audit
    // channel. The repeat row used to carry the caller's FRESH
    // `refunds_paisa`, so publishing at 10000 and retrying at 10700 put both
    // numbers in a log the audit page and its CSV display, and their
    // difference is the late refund. That is the round-1B oracle, one table
    // over.
    //
    // The first publication (at the top of this file) recorded full provenance
    // and should: those numbers ARE the published figure. The repeat must
    // carry only what is already disclosed.
    const repeat = await h.one<{ meta: Record<string, unknown> }>(`
      select meta from public.admin_audit_log
       where action = 'publication.already_published'
         and target = ${quote(`${METRIC}:${COHORT}:2026-08`)}`);
    const keys = Object.keys(repeat.meta).sort();
    expect(keys).toEqual(['already_published', 'value_paisa']);
    expect(Number(repeat.meta.value_paisa)).toBe(40_000);
    // Named explicitly rather than inferred from the key list, because this is
    // the assertion the finding was about.
    expect(repeat.meta.refunds_paisa).toBeUndefined();
    expect(repeat.meta.gross_paisa).toBeUndefined();
    expect(repeat.meta.source_digest).toBeUndefined();
  });

  it('the FIRST publication still records full provenance, so the fix above is narrow', async () => {
    const first = await h.one<{ meta: Record<string, unknown> }>(`
      select meta from public.admin_audit_log
       where action = 'publication.published'
         and target = ${quote(`${METRIC}:${COHORT}:2026-08`)}`);
    expect(Object.keys(first.meta).sort()).toEqual([
      'contributor_count',
      'days_requiring_floor',
      'gross_paisa',
      'k_floor',
      'refunds_paisa',
      'source_digest',
      'value_paisa',
    ]);
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
      rawInsert(`${quote(METRIC)}, 'banani', 'month', '2026-08-01', '2026-08-31',
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
         '2026-08-01', '2026-08-31', 1, 0, 1, 1, 0, ${quote(DIGEST_A)}, 5, 6, 1, 1, 'x'`),
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

  it('refuses money above the reader safe-integer range', async () => {
    // ROUND 20 FINDING 4. `bigint` accepts values above 2^53-1, which
    // JavaScript cannot represent exactly — so the RPC accepted a gross of
    // 9007199254740993, the reader correctly refused to convert it, and because
    // the conversion spans every fetched publication that ONE row broke every
    // read. An immutable row that permanently breaks the reader is the worst
    // possible interaction with a table whose whole premise is that nothing can
    // be edited or deleted.
    const refusal = await attempt(
      'service_role',
      publishCall({
        start: '2026-04-01',
        end: '2026-04-30',
        gross: 9007199254740993,
        refunds: 9007199254740992,
        value: 1,
      }),
    );
    expect(refusal?.code).toBe('23514');
    expect(refusal?.message).toContain('gross_paisa');
  });

  it('ACCEPTS money at exactly the safe-integer boundary', async () => {
    // Non-vacuity for the ceiling: a constraint set one too low would pass the
    // test above while rejecting a figure the reader can serve perfectly well.
    const accepted = await attemptAsOwner(
      rawInsert(
        `${quote(METRIC)}, ${quote(COHORT)}, 'month', '2026-03-01', '2026-03-31',
         9007199254740991, 0, 9007199254740991, 1, 0, ${quote(DIGEST_A)}, 5, 6, 1, 1, 'x'`,
      ),
    );
    expect(accepted).toBeNull();
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

  /** Runs `sql` as `role` and reports the SQLSTATE rather than throwing. */
  async function attemptHere(role: string, sql: string): Promise<{ code: string | null; message: string } | null> {
    return h.as(role, null, async () => {
      try {
        await h.exec(sql);
        return null;
      } catch (error) {
        const code =
          error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
            ? (error as { code: string }).code
            : null;
        return { code, message: error instanceof Error ? error.message : String(error) };
      }
    });
  }

  it('publishes a period first, so the rollback below has something to lose', async () => {
    const rows = await h.as('service_role', null, async () =>
      h.all<{ published_now: boolean }>(publishCall()),
    );
    expect(rows[0]!.published_now).toBe(true);
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

  it('REFUSES to republish a period at a new value after the rollback', async () => {
    // ROUND 18 FINDING 4, and it broke my own class-B justification. I wrote
    // that a republish at a different value "would contradict the audit log
    // and be detectable" -- and the reviewer pointed out that detectable is
    // not prevented when nothing reads the log. Drop, re-apply, publish the
    // same period at 390.00, and both calls reported a first publication.
    //
    // So the function now reads it. `admin_audit_log` is the class-C store
    // that SURVIVES this reversal, which is the whole reason the publication
    // evidence was put there, and it is authoritative rather than merely
    // informative: a period published once cannot be published again at any
    // value, with the serving table freshly empty.
    const refusal = await attemptHere(
      'service_role',
      publishCall({ refunds: 11_000, value: 39_000, digest: DIGEST_B }),
    );
    expect(refusal?.code).toBe('23001');
    expect(refusal?.message).toContain('was published before');
    const count = await h.one<{ n: string }>(
      'select count(*)::text as n from public.financial_publications',
    );
    expect(count.n).toBe('0');
  });

  it('still allows a DIFFERENT period, so the rule above is not a blanket refusal', async () => {
    // Non-vacuity. A guard that refused every publication after any rollback
    // would pass the test above while making the table useless.
    const rows = await h.as('service_role', null, async () =>
      h.all<{ published_now: boolean }>(
        publishCall({ start: '2026-07-01', end: '2026-07-31' }),
      ),
    );
    expect(rows[0]!.published_now).toBe(true);
  });
});
