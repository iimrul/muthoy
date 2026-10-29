// Batch 3 §8.9 — the durable audit sink and the three write outcomes, executed.
//
// The properties that matter, and why each one is here:
//
//  - the insert is AWAITED. `recordAdminActionDurably` does not resolve until
//    the row has committed or failed, and the ordering test proves it rather
//    than assuming it: dropping the await makes that test fail and nothing
//    else;
//  - stderr runs FIRST. A database outage must not lose the line, so the order
//    of the sinks is asserted, not described;
//  - the row carries actor_verified, and the column maps to the entry field;
//  - INSERT ONLY. The sink has no update, delete or upsert path at all;
//  - a failed audit after a committed write is its own outcome. It must not
//    read as a plain failure, because a plain failure invites the retry that
//    repeats a non-idempotent write.

import { beforeEach, describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ALLOWED_META_KEYS,
  recentAdminAudit,
  type AdminAuditEntry,
  type AdminAuditSink,
} from './adminAudit';
import {
  AdminAuditExportTooLargeError,
  AdminAuditReadError,
  auditHistory,
  AUDIT_EXPORT_MAX,
  AUDIT_READ_LIMIT,
  createPostgresAuditSink,
  fromAuditRow,
  readAdminAuditLog,
  readAdminAuditLogForExport,
  recordAdminActionDurably,
  toAuditRow,
} from './adminAuditStore';
import { resultForDurability, AUDIT_WRITE_FAILED_MESSAGE } from './adminAssignments';
import { outcomeFor, outcomeNote, outcomeQuery, OUTCOME_SENTENCES } from './adminOutcomes';

const NOW = Date.parse('2026-10-25T06:00:00.000Z');

interface InsertCall {
  table: string;
  values: Record<string, unknown>;
}

function createClient(options: { error?: string; failAfter?: number } = {}) {
  const inserts: InsertCall[] = [];
  const methods: string[] = [];

  const client = {
    from(table: string) {
      return {
        insert(values: Record<string, unknown>) {
          methods.push('insert');
          inserts.push({ table, values });
          const shouldFail = options.error !== undefined
            && (options.failAfter === undefined || inserts.length > options.failAfter);
          return Promise.resolve(
            shouldFail
              ? { data: null, error: { message: options.error } }
              : { data: null, error: null },
          );
        },
        update() {
          methods.push('update');
          return { eq: () => Promise.resolve({ data: null, error: null }) };
        },
        delete() {
          methods.push('delete');
          return { eq: () => Promise.resolve({ data: null, error: null }) };
        },
      };
    },
  };

  return { client: client as never, inserts, methods };
}

function entry(overrides: Partial<AdminAuditEntry> = {}): AdminAuditEntry {
  return {
    at: '2026-10-25T06:00:00.000Z',
    actor: 'founder',
    actorVerified: true,
    role: 'super_admin',
    action: 'admins.assign_role',
    target: 'ops',
    outcome: 'success',
    meta: { targetUsername: 'ops' },
    ...overrides,
  };
}

beforeEach(() => {
  recentAdminAudit.clear();
});

describe('toAuditRow', () => {
  test('maps every entry field to its column, actor_verified included', () => {
    expect(toAuditRow(entry())).toEqual({
      at: '2026-10-25T06:00:00.000Z',
      actor: 'founder',
      actor_verified: true,
      role: 'super_admin',
      action: 'admins.assign_role',
      target: 'ops',
      outcome: 'success',
      meta: { targetUsername: 'ops' },
    });
  });

  test('a null role and a null target survive as null, not as empty strings', () => {
    const row = toAuditRow(entry({ role: null, target: null }));
    expect(row.role).toBeNull();
    expect(row.target).toBeNull();
  });

  test('an unverified actor maps to false', () => {
    expect(toAuditRow(entry({ actorVerified: false })).actor_verified).toBe(false);
  });
});

describe('the Postgres sink', () => {
  test('inserts one row per entry, into admin_audit_log', async () => {
    const { client, inserts } = createClient();
    const sink = createPostgresAuditSink({ client });

    sink.write(entry());
    sink.write(entry({ action: 'admins.revoke_sessions' }));
    await sink.flush();

    expect(inserts.map((call) => call.table)).toEqual(['admin_audit_log', 'admin_audit_log']);
    expect(inserts[0]?.values.action).toBe('admins.assign_role');
    expect(inserts[1]?.values.action).toBe('admins.revoke_sessions');
  });

  test('performs no update, no delete and no upsert', async () => {
    const { client, methods } = createClient();
    const sink = createPostgresAuditSink({ client });

    sink.write(entry());
    await sink.flush();

    expect(methods).toEqual(['insert']);
  });

  test('flush REJECTS when the insert failed', async () => {
    const { client } = createClient({ error: 'permission denied for table admin_audit_log' });
    const sink = createPostgresAuditSink({ client });

    sink.write(entry());

    await expect(sink.flush()).rejects.toThrow('admin audit insert failed');
  });

  test('the driver message never reaches the thrown error', async () => {
    const { client } = createClient({ error: 'FATAL: password authentication failed' });
    const sink = createPostgresAuditSink({ client });

    sink.write(entry());

    await expect(sink.flush()).rejects.not.toThrow('password');
  });

  test('one failing insert does not leave the others unawaited', async () => {
    // allSettled, not Promise.all: an unawaited rejected promise is an
    // unhandled rejection, and in Node that can take the process down.
    const { client, inserts } = createClient({ error: 'nope', failAfter: 1 });
    const sink = createPostgresAuditSink({ client });

    sink.write(entry());
    sink.write(entry());
    sink.write(entry());

    await expect(sink.flush()).rejects.toThrow();
    expect(inserts).toHaveLength(3);
  });

  test('flush DRAINS, so a second flush does not re-report a settled write', async () => {
    const { client } = createClient({ error: 'nope' });
    const sink = createPostgresAuditSink({ client });

    sink.write(entry());
    await expect(sink.flush()).rejects.toThrow();

    // Nothing is pending now, so the next flush is clean. A sink that kept its
    // history would report the same failure on every later request.
    await expect(sink.flush()).resolves.toBeUndefined();
  });

  test('flush on an empty sink resolves', async () => {
    const { client } = createClient();
    await expect(createPostgresAuditSink({ client }).flush()).resolves.toBeUndefined();
  });
});

describe('recordAdminActionDurably', () => {
  function orderedSinks() {
    const order: string[] = [];
    const first: AdminAuditSink = { write: () => order.push('stderr') };
    const durable: AdminAuditSink = {
      write: () => order.push('durable-write'),
      flush: async () => {
        await Promise.resolve();
        order.push('durable-flush');
      },
    };
    return { order, sinks: [first, durable] };
  }

  test('writes every sink in order, stderr FIRST', async () => {
    const { order, sinks } = orderedSinks();

    await recordAdminActionDurably(
      { actor: 'founder', action: 'a', outcome: 'success', now: NOW },
      sinks,
    );

    expect(order).toEqual(['stderr', 'durable-write', 'durable-flush']);
  });

  test('does not resolve until the durable sink has flushed', async () => {
    const order: string[] = [];
    const durable: AdminAuditSink = {
      write: () => undefined,
      flush: async () => {
        await new Promise((resolve) => { setTimeout(resolve, 5); });
        order.push('flushed');
      },
    };

    await recordAdminActionDurably(
      { actor: 'founder', action: 'a', outcome: 'success', now: NOW },
      [durable],
    );
    order.push('resolved');

    expect(order).toEqual(['flushed', 'resolved']);
  });

  test('reports durable when the sink committed', async () => {
    const { client } = createClient();
    const result = await recordAdminActionDurably(
      { actor: 'founder', action: 'a', outcome: 'success', now: NOW },
      [createPostgresAuditSink({ client })],
    );

    expect(result.durability).toBe('durable');
  });

  test('reports failed when the sink could not commit', async () => {
    const { client } = createClient({ error: 'permission denied' });
    const result = await recordAdminActionDurably(
      { actor: 'founder', action: 'a', outcome: 'success', now: NOW },
      [createPostgresAuditSink({ client })],
    );

    expect(result.durability).toBe('failed');
  });

  test('reports stderr_only when no sink is durable', async () => {
    // Three values and not a boolean: "nothing durable is configured" is not a
    // failure, and collapsing the two would make every such path raise an
    // alarm that is always on.
    const result = await recordAdminActionDurably(
      { actor: 'founder', action: 'a', outcome: 'success', now: NOW },
      [recentAdminAudit],
    );

    expect(result.durability).toBe('stderr_only');
  });

  test('NEVER throws, even when the durable sink fails', async () => {
    // A throw here would unwind a mutation that had already committed, which is
    // the one outcome worth avoiding.
    const { client } = createClient({ error: 'permission denied' });
    await expect(recordAdminActionDurably(
      { actor: 'founder', action: 'a', outcome: 'success', now: NOW },
      [createPostgresAuditSink({ client })],
    )).resolves.toMatchObject({ durability: 'failed' });
  });

  test('a failing durable sink still leaves the stderr-side entry recorded', async () => {
    const { client } = createClient({ error: 'permission denied' });
    await recordAdminActionDurably(
      { actor: 'founder', action: 'login', outcome: 'failure', now: NOW },
      [recentAdminAudit, createPostgresAuditSink({ client })],
    );

    expect(recentAdminAudit.entries()).toMatchObject([{ actor: 'founder', action: 'login' }]);
  });

  test('the returned entry is the redacted one, not the raw input', async () => {
    const result = await recordAdminActionDurably(
      {
        actor: 'founder',
        action: 'a',
        outcome: 'success',
        now: NOW,
        meta: { reason: 'called 01712345678', serviceRoleKey: 'secret' },
      },
      [recentAdminAudit],
    );

    expect(result.entry.meta).toEqual({ reason: 'called [redacted]' });
  });
});

describe('committed-but-unaudited is its own outcome (§8.9d)', () => {
  test('a failed audit after a committed write is NOT a plain failure', () => {
    const result = resultForDurability('failed', 'Saved.');

    expect(result).toEqual({
      ok: false,
      committed: true,
      code: 'audit_write_failed',
      message: AUDIT_WRITE_FAILED_MESSAGE,
    });
    expect(outcomeFor(result)).toBe('applied_unrecorded');
  });

  test('a durable audit is an ordinary success', () => {
    const result = resultForDurability('durable', 'Saved.');

    expect(result).toEqual({ ok: true, message: 'Saved.' });
    expect(outcomeFor(result)).toBe('done');
  });

  test('stderr_only is also a success — it is the documented shipped state', () => {
    expect(resultForDurability('stderr_only', 'Saved.')).toEqual({ ok: true, message: 'Saved.' });
  });

  test('an ordinary failure stays an ordinary failure', () => {
    expect(outcomeFor({ ok: false, message: 'nope' })).toBe('failed');
  });

  test('the message tells the reader NOT to retry', () => {
    expect(AUDIT_WRITE_FAILED_MESSAGE.toLowerCase()).toContain('do not retry');
    expect(AUDIT_WRITE_FAILED_MESSAGE.toLowerCase()).toContain('was applied');
  });
});

describe('the three query values map to three distinct notices', () => {
  test('each outcome has its own key', () => {
    expect(outcomeQuery('reconcile', 'done')).toBe('?done=reconcile');
    expect(outcomeQuery('reconcile', 'failed')).toBe('?failed=reconcile');
    expect(outcomeQuery('reconcile', 'applied_unrecorded')).toBe('?applied_unrecorded=reconcile');
  });

  test('the action name is encoded, so it cannot inject another parameter', () => {
    expect(outcomeQuery('a&b=c', 'done')).toBe('?done=a%26b%3Dc');
  });

  test('all three notices are non-empty and distinct', () => {
    const notices = [
      outcomeNote({ done: 'reconcile' }, { reconcile: 'Plan limits reconciled.' }),
      outcomeNote({ failed: 'reconcile' }),
      outcomeNote({ applied_unrecorded: 'reconcile' }),
    ];

    for (const notice of notices) {
      expect(notice).toBeTruthy();
      expect((notice ?? '').length).toBeGreaterThan(10);
    }
    expect(new Set(notices).size).toBe(3);
  });

  test('the third NEVER reads as a plain failure', () => {
    const notice = outcomeNote({ applied_unrecorded: 'reconcile' }) ?? '';

    expect(notice).not.toBe(OUTCOME_SENTENCES.failed);
    expect(notice.toLowerCase()).not.toContain('nothing was changed');
    expect(notice.toLowerCase()).toContain('do not retry');
  });

  test('the failure notice says nothing was changed, because nothing was', () => {
    expect((outcomeNote({ failed: 'reconcile' }) ?? '').toLowerCase())
      .toContain('nothing was changed');
  });

  test('no outcome in the URL is no notice', () => {
    expect(outcomeNote({})).toBeNull();
    expect(outcomeNote({ other: 'x' })).toBeNull();
  });

  test('an unknown success action produces no notice rather than an empty box', () => {
    expect(outcomeNote({ done: 'something_else' }, { reconcile: 'ok' })).toBeNull();
  });

  test('a prototype name cannot become a notice', () => {
    expect(outcomeNote({ done: 'constructor' }, { reconcile: 'ok' })).toBeNull();
    expect(outcomeNote({ done: '__proto__' }, { reconcile: 'ok' })).toBeNull();
  });

  test('applied_unrecorded wins when a malformed redirect carries two keys', () => {
    // Of the three, the one that must never be missed is the one telling the
    // reader not to retry.
    expect(outcomeNote({ done: 'reconcile', applied_unrecorded: 'reconcile' }, { reconcile: 'ok' }))
      .toBe(OUTCOME_SENTENCES.applied_unrecorded);
    expect(outcomeNote({ failed: 'reconcile', applied_unrecorded: 'reconcile' }))
      .toBe(OUTCOME_SENTENCES.applied_unrecorded);
  });

  test('a repeated query key reads as the first value, not as no outcome', () => {
    expect(outcomeNote({ failed: ['reconcile', 'expire'] })).toBe(OUTCOME_SENTENCES.failed);
  });
});

describe('an audit failure cannot crash the thing it is auditing (Gate 5 finding 2)', () => {
  /** A client whose insert always fails, as an unavailable audit table would. */
  function failingClient() {
    return {
      from: () => ({
        insert: async () => ({ error: { message: 'relation does not exist' } }),
      }),
    } as unknown as NonNullable<Parameters<typeof createPostgresAuditSink>[0]>['client'];
  }

  test('write() WITHOUT a flush produces no unhandled rejection', async () => {
    // THE DEFECT. `write` is a void method and its callers are not required to
    // flush — lib/adminLogin.ts audits a failed login and returns. The queued
    // promise could reject with nobody observing it, and Node's default
    // --unhandled-rejections=throw turns that into a process crash: an audit
    // failure taking down the login path.
    const seen: unknown[] = [];
    const onUnhandled = (reason: unknown) => seen.push(reason);
    process.on('unhandledRejection', onUnhandled);

    try {
      const sink = createPostgresAuditSink({ client: failingClient() });
      sink.write({
        at: '2026-10-26T06:00:00.000Z',
        actor: 'ops',
        actorVerified: false,
        role: 'read_only',
        action: 'login',
        target: null,
        outcome: 'failure',
        meta: {},
      });

      // Let the insert settle and let Node get a turn to notice an unobserved
      // rejection, which it reports at the end of the microtask queue.
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));

      expect(seen, 'a queued audit write must never reject unobserved').toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  test('and the failure is still REPORTED to an awaited flush', async () => {
    // The fix must not swallow the failure: `recordAdminActionDurably`'s
    // awaited callers depend on flush throwing, which is what produces §8.9d's
    // committed-but-unaudited outcome.
    const sink = createPostgresAuditSink({ client: failingClient() });
    sink.write({
      at: '2026-10-26T06:00:00.000Z',
      actor: 'founder',
      actorVerified: true,
      role: 'super_admin',
      action: 'settings.updated',
      target: 'flag.analytics_enabled',
      outcome: 'success',
      meta: {},
    });

    await expect(sink.flush?.()).rejects.toThrow('admin audit insert failed');
  });

  test('a drained batch is not re-reported by the next flush', async () => {
    const sink = createPostgresAuditSink({ client: failingClient() });
    sink.write({
      at: '2026-10-26T06:00:00.000Z',
      actor: 'founder',
      actorVerified: true,
      role: 'super_admin',
      action: 'login',
      target: null,
      outcome: 'success',
      meta: {},
    });

    await expect(sink.flush?.()).rejects.toThrow('admin audit insert failed');
    // Nothing queued since, so the second flush reports nothing — a sink reused
    // across requests must not re-report a write it already failed on.
    await expect(sink.flush?.()).resolves.toBeUndefined();
  });
});

// ───────────────────────────────── ROUND 11 FINDINGS 5 and 6: the READ side

/**
 * A fake `admin_audit_log` READER.
 *
 * Mirrors exactly the call chain `readAdminAuditLog` builds —
 * `select().order().limit()` and optionally `.like()` — so a change to that
 * chain fails here rather than passing against a permissive stub.
 */
function createReader(options: { rows?: Record<string, unknown>[]; error?: string } = {}) {
  const calls: { columns: string; like: string | null; limit: number | null }[] = [];

  const client = {
    from(table: string) {
      if (table !== 'admin_audit_log') throw new Error('unexpected table: ' + table);
      return {
        select(columns: string) {
          const call = { columns, like: null as string | null, limit: null as number | null };
          calls.push(call);
          const result = options.error === undefined
            ? { data: options.rows ?? [], error: null }
            : { data: null, error: { message: options.error } };
          const chain = {
            order() {
              return chain;
            },
            limit(count: number) {
              call.limit = count;
              return chain;
            },
            like(_column: string, pattern: string) {
              call.like = pattern;
              return Promise.resolve(result);
            },
            then(resolve: (value: typeof result) => unknown) {
              return Promise.resolve(result).then(resolve);
            },
          };
          return chain;
        },
      };
    },
  };

  return { client: client as never, calls };
}

const STORED_ROW = {
  at: '2026-10-25T06:00:00.000Z',
  actor: 'super',
  actor_verified: true,
  role: 'super_admin',
  action: 'admins.role_assigned',
  target: 'billing-1',
  outcome: 'success',
  meta: { username: 'billing-1' },
};

describe('ROUND 11 FINDING 5: the durable audit log is READ, not only written', () => {
  // The defect: §8.9's durable sink was written and never read. /audit,
  // /admins, /support and /subscriptions all rendered the in-process ring, so
  // the history shown was whatever THIS process had done since it started --
  // different on another instance, empty after a restart. A durable write
  // nobody reads is not an audit trail, and applying migration 35 could never
  // have supplied the missing reader.

  test('a stored row comes back as an entry, with its fields intact', async () => {
    const { client, calls } = createReader({ rows: [STORED_ROW] });

    const entries = await readAdminAuditLog({}, { client });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({
      at: '2026-10-25T06:00:00.000Z',
      actor: 'super',
      actorVerified: true,
      role: 'super_admin',
      action: 'admins.role_assigned',
      target: 'billing-1',
      outcome: 'success',
      meta: { username: 'billing-1' },
    });
    // Exactly the columns §3.4 grants select on, as one literal.
    expect(calls[0]?.columns).toBe(
      'at, actor, actor_verified, role, action, target, outcome, meta',
    );
  });

  test('the read is BOUNDED, so a page cannot ask for the whole table', async () => {
    const { client, calls } = createReader({ rows: [] });

    await readAdminAuditLog({}, { client });
    expect(calls[0]?.limit).toBe(AUDIT_READ_LIMIT);

    await readAdminAuditLog({ limit: 10_000 }, { client });
    expect(calls[1]?.limit, 'a caller raised the bound').toBe(AUDIT_READ_LIMIT);
  });

  test('a FAILED read throws rather than answering "nothing happened"', async () => {
    const { client } = createReader({ error: 'relation "admin_audit_log" does not exist' });

    await expect(readAdminAuditLog({}, { client })).rejects.toThrow(AdminAuditReadError);
  });

  test('the driver message never reaches the caller', async () => {
    const { client } = createReader({
      error: 'connection to postgresql://admin:hunter2@db failed',
    });

    await expect(readAdminAuditLog({}, { client })).rejects.toThrow('admin audit read failed');
    await readAdminAuditLog({}, { client }).catch((error: unknown) => {
      expect((error as Error).message).not.toContain('hunter2');
    });
  });

  test('action prefixes filter SERVER-SIDE, one query each', async () => {
    // One query per prefix rather than a dotted `or` filter: embedding dotted
    // patterns in PostgREST's or syntax is how Gate 5 finding 6 made the
    // Action filter unusable.
    const { client, calls } = createReader({ rows: [] });

    await readAdminAuditLog({ actionPrefixes: ['admins.', 'session.'] }, { client });

    expect(calls.map((call) => call.like)).toEqual(['admins.%', 'session.%']);
  });

  test('overlapping prefixes are REFUSED, so no row is counted twice', async () => {
    const { client } = createReader({ rows: [] });

    await expect(
      readAdminAuditLog({ actionPrefixes: ['session.', 'session.revoked'] }, { client }),
    ).rejects.toThrow(/disjoint/);
  });

  test('merged results come back newest first', async () => {
    const older = { ...STORED_ROW, at: '2026-10-20T06:00:00.000Z', action: 'session.revoked' };
    const { client } = createReader({ rows: [STORED_ROW, older] });

    const entries = await readAdminAuditLog({}, { client });

    expect(entries.map((entry) => entry.at)).toEqual([
      '2026-10-25T06:00:00.000Z',
      '2026-10-20T06:00:00.000Z',
    ]);
  });

  test('an unknown outcome reads as FAILURE, never as success', () => {
    expect(fromAuditRow({ ...STORED_ROW, outcome: 'ok' }).outcome).toBe('failure');
  });

  test('a null actor_verified reads as UNVERIFIED', () => {
    // The column is the difference between an actor the server verified and a
    // name a request claimed. Anything other than an explicit true is claimed.
    expect(fromAuditRow({ ...STORED_ROW, actor_verified: null }).actorVerified).toBe(false);
    expect(fromAuditRow({ ...STORED_ROW, actor_verified: 'true' }).actorVerified).toBe(false);
  });

  test('a non-scalar meta value is dropped, not stringified', () => {
    const entry = fromAuditRow({
      ...STORED_ROW,
      meta: { username: 'billing-1', nested: { a: 1 }, list: [1, 2] },
    });

    expect(entry.meta).toEqual({ username: 'billing-1' });
  });

  test('auditHistory reports DURABLE when the table answers', async () => {
    const { client } = createReader({ rows: [STORED_ROW] });

    const history = await auditHistory({}, { client });

    expect(history.durable).toBe(true);
    expect(history.unavailable).toBeNull();
    expect(history.entries).toHaveLength(1);
  });

  test('auditHistory SAYS SO when the table cannot be read', async () => {
    // The fallback is the in-process ring, and it is never silent: a page that
    // rendered these entries without the message would be presenting one
    // process's actions as the platform's history, which is the defect.
    const { client } = createReader({ error: 'relation does not exist' });

    const history = await auditHistory({}, { client });

    expect(history.durable).toBe(false);
    expect(history.unavailable).toContain('could not be read');
    expect(history.unavailable).toContain('E4-H');
  });
});

describe('ROUND 12 FINDINGS 6 and 10: the export reads completely, or refuses', () => {
  /**
   * A reader that PAGES, and records the filters each page carried.
   *
   * `rows` is the whole stored set; this serves it in pages the way PostgREST
   * does, so "the predicate ran before pagination" is measurable rather than
   * asserted.
   */
  function createPagingReader(rows: Record<string, unknown>[]) {
    const seen: {
      like: string | null;
      eq: [string, string][];
      range: [number, number] | null;
      limit: number | null;
    }[] = [];

    const client = {
      from() {
        return {
          select() {
            const call = {
              like: null as string | null,
              eq: [] as [string, string][],
              range: null as [number, number] | null,
              limit: null as number | null,
            };
            seen.push(call);
            const chain: Record<string, unknown> = {};
            const settle = () => {
              let matched = rows;
              for (const [column, value] of call.eq) {
                matched = matched.filter((row) => row[column] === value);
              }
              if (call.like !== null) {
                const prefix = call.like.slice(0, -1);
                matched = matched.filter((row) => String(row.action ?? '').startsWith(prefix));
              }
              // `readAdminAuditLog` bounds with `limit`; the export pages
              // with `range`. A fake that honoured only one of them would
              // measure the wrong thing -- an uncalled `range` must mean
              // "everything", not "one row".
              if (call.limit !== null) matched = matched.slice(0, call.limit);
              if (call.range === null) return { data: matched, error: null };
              const [from, to] = call.range;
              return { data: matched.slice(from, to + 1), error: null };
            };
            chain.order = () => chain;
            chain.limit = (count: number) => {
              call.limit = count;
              return chain;
            };
            chain.like = (_column: string, pattern: string) => {
              call.like = pattern;
              return chain;
            };
            chain.eq = (column: string, value: string) => {
              call.eq.push([column, value]);
              return chain;
            };
            chain.gte = () => chain;
            chain.lte = () => chain;
            chain.range = (from: number, to: number) => {
              call.range = [from, to];
              return chain;
            };
            chain.then = (resolve: (value: unknown) => unknown) =>
              Promise.resolve(settle()).then(resolve);
            return chain;
          },
        };
      },
    };

    return { client: client as never, seen };
  }

  /** The reviewer's fixture: one older denial, then 500 logins. */
  function fiveHundredAndOne(): Record<string, unknown>[] {
    const denial = {
      at: '2026-10-01T06:00:00.000Z',
      actor: 'super',
      actor_verified: true,
      role: 'super_admin',
      action: 'admins.disabled',
      target: 'billing-1',
      outcome: 'denied',
      meta: {},
    };
    const logins = Array.from({ length: 500 }, (_unused, index) => ({
      at: '2026-10-2' + String(index % 10) + 'T06:00:00.000Z',
      actor: 'ops',
      actor_verified: true,
      role: 'support',
      action: 'login',
      target: 'login-' + index,
      outcome: 'success',
      meta: {},
    }));
    // Newest first, as the query orders them: the denial is the OLDEST row.
    return [...logins, denial];
  }

  test('REPRODUCTION: the 501st event is no longer lost', async () => {
    // The page-bounded read returned 500 and dropped the denial entirely.
    const { client } = createPagingReader(fiveHundredAndOne());

    const all = await readAdminAuditLogForExport({}, { client });

    expect(all).toHaveLength(501);
    expect(all.some((entry) => entry.action === 'admins.disabled')).toBe(true);
  });

  test('REPRODUCTION: a filtered export finds an event older than the bound', async () => {
    // `?action=admins.` returned 200 with headers only, because the filter ran
    // over a 500-row sample that did not include the denial.
    const { client, seen } = createPagingReader(fiveHundredAndOne());

    const matched = await readAdminAuditLogForExport({ action: 'admins.' }, { client });

    expect(matched).toHaveLength(1);
    expect(matched[0]?.action).toBe('admins.disabled');
    // And the predicate went into the QUERY, before any pagination.
    expect(seen[0]?.like).toBe('admins.%');
  });

  test('the other dimensions are server-side too', async () => {
    const { client, seen } = createPagingReader(fiveHundredAndOne());

    await readAdminAuditLogForExport({ actor: 'ops', outcome: 'success' }, { client });

    expect(seen[0]?.eq).toEqual([
      ['actor', 'ops'],
      ['outcome', 'success'],
    ]);
  });

  test('beyond the ceiling it REFUSES rather than truncating', async () => {
    const many = Array.from({ length: AUDIT_EXPORT_MAX + 10 }, (_unused, index) => ({
      at: '2026-10-25T06:00:00.000Z',
      actor: 'ops',
      actor_verified: true,
      role: 'support',
      action: 'login',
      target: String(index),
      outcome: 'success',
      meta: {},
    }));
    const { client } = createPagingReader(many);

    await expect(readAdminAuditLogForExport({}, { client })).rejects.toThrow(
      AdminAuditExportTooLargeError,
    );
  });

  test('FINDING 10: identical prefixes do not duplicate history', async () => {
    // `['login', 'login']` passed the overlap check -- a string is not inside
    // itself under startsWith -- and the merge returned 500 rows holding 250
    // distinct events.
    const rows = Array.from({ length: 4 }, (_unused, index) => ({
      at: '2026-10-2' + index + 'T06:00:00.000Z',
      actor: 'ops',
      actor_verified: true,
      role: 'support',
      action: 'login',
      target: String(index),
      outcome: 'success',
      meta: {},
    }));
    const { client } = createPagingReader(rows);

    const entries = await readAdminAuditLog({ actionPrefixes: ['login', 'login'] }, { client });

    expect(entries).toHaveLength(4);
    expect(new Set(entries.map((entry) => entry.target)).size).toBe(4);
  });

  test('FINDING 6: a page read narrows on the server as well', async () => {
    const { client, seen } = createPagingReader(fiveHundredAndOne());

    await readAdminAuditLog(
      { filter: { actor: 'super', action: 'admins.', outcome: 'denied' } },
      { client },
    );

    expect(seen[0]?.eq).toEqual([
      ['actor', 'super'],
      ['outcome', 'denied'],
    ]);
    expect(seen[0]?.like).toBe('admins.%');
  });
});

describe('ROUND 12 FINDING 7: the export records a meta key the redactor keeps', () => {
  test('rowCount is allowed; rows and scanned are not', () => {
    // Executed exports stored `meta: {}` in both the Postgres insert and the
    // stderr record, because `rows` and `scanned` are not in the allowlist.
    // The one action whose audit entry needs to say how much history left the
    // building said nothing at all.
    expect(ALLOWED_META_KEYS).toContain('rowCount');
    expect(ALLOWED_META_KEYS).not.toContain('rows');
    expect(ALLOWED_META_KEYS).not.toContain('scanned');
  });

  test('the route records rowCount, and the row survives redaction', () => {
    const route = readFileSync(
      join(import.meta.dirname, '..', 'app/api/audit/export/route.ts'),
      'utf8',
    );
    expect(route).toContain('rowCount: matched.length');
    expect(route).not.toContain('scanned: entries.length');

    // And the redactor keeps it, rather than this being a claim about a list.
    const row = toAuditRow({
      at: '2026-10-25T06:00:00.000Z',
      actor: 'super',
      actorVerified: true,
      role: 'super_admin',
      action: 'audit.export',
      target: null,
      outcome: 'success',
      meta: { rowCount: 42 },
    });
    expect(row.meta).toEqual({ rowCount: 42 });
  });
});
