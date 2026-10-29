import 'server-only';

// Batch 3 §8.9 / §8.12 — the durable audit sink, and the ONLY module that
// writes `admin_audit_log`.
//
// INSERT ONLY. §3.4 grants insert and select and nothing else: no update, no
// delete, no truncate, and no column-level update either, because an audit row
// the panel can edit or erase is not evidence. Retention is an operator
// decision taken outside the application, not an application privilege.
//
// THE ORDER MATTERS. stderr runs FIRST and stays the record of account, so a
// database outage cannot lose the line. The Postgres insert is attempted after
// it, and `flush()` is what the sensitive paths await.
//
// WHY `write` STAYS SYNCHRONOUS. §8.9's constraint was that no existing
// non-sensitive call site should change. So `write` enqueues the insert and
// returns, and the promise it started is collected by `flush()`. A sensitive
// path awaits `recordAdminActionDurably`; a best-effort path calls
// `recordAdminAction` with the same sinks and does not wait. Both reach
// Postgres; only one of them knows whether it arrived.
//
// DURABILITY IS NOT CLAIMED BEYOND THE CODE PATH. Migration 35 has not been
// applied to a hosted project, so in the shipped state the insert fails, and
// the answer recordAdminActionDurably gives is 'failed' — never a quiet
// 'durable'. The /audit page says the same thing.

import {
  recordAdminAction,
  recentAdminAudit,
  stderrAuditSink,
  type AdminAuditEntry,
  type AdminAuditInput,
  type AdminAuditSink,
} from './adminAudit';
import { getSupabaseAdmin } from './supabaseAdmin';

/** The service-role surface this module needs. Injected whole in tests. */
export type AdminAuditClient = Pick<ReturnType<typeof getSupabaseAdmin>, 'from'>;

/**
 * What actually happened to the durable copy.
 *
 * Three values and not a boolean, because "no durable sink is configured" and
 * "the durable sink failed" are different facts and only one of them is a
 * problem. Collapsing them would make every test and every sink-injected path
 * report an audit failure, and an alarm that is always on is an alarm nobody
 * reads.
 */
export type AdminAuditDurability = 'durable' | 'stderr_only' | 'failed';

export interface DurableAuditResult {
  entry: AdminAuditEntry;
  durability: AdminAuditDurability;
}

export interface PostgresAuditSink extends AdminAuditSink {
  flush(): Promise<void>;
}

/** Thrown when the durable audit log cannot be READ. Never swallowed. */
export class AdminAuditReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminAuditReadError';
  }
}

/**
 * The bound on one audit read.
 *
 * An audit view is a security surface, so it is paged rather than unbounded: a
 * page that tried to render the whole table would be a denial-of-service lever
 * against the panel, and an operator reading history needs the most recent
 * lines first, not all of them at once.
 */
export const AUDIT_READ_LIMIT = 500;

/** Exactly the columns §3.4 grants select on, as ONE literal. */
const AUDIT_COLUMNS = 'at, actor, actor_verified, role, action, target, outcome, meta';

const OUTCOMES = new Set(['success', 'failure', 'denied']);

/**
 * `meta`, narrowed to the scalars an entry may hold.
 *
 * `jsonb` can hold anything, and this value is rendered. A nested object or an
 * array would stringify as `[object Object]` in a security view, so a
 * non-scalar is DROPPED rather than coerced — the row still shows, with the
 * pairs that are legible.
 */
function scalarMeta(value: unknown): Readonly<Record<string, string | number | boolean>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const out: Record<string, string | number | boolean> = {};
  for (const [key, held] of Object.entries(value as Record<string, unknown>)) {
    if (typeof held === 'string' || typeof held === 'number' || typeof held === 'boolean') {
      out[key] = held;
    }
  }
  return Object.freeze(out);
}

/**
 * A stored row, back into an entry.
 *
 * The inverse of `toAuditRow`, and deliberately strict: a row whose `outcome`
 * is not one of the three recorded values is a row this code did not write,
 * and reading it as a normal entry would put unvalidated text into a security
 * view. An unknown outcome reads as `failure` rather than as success.
 */
export function fromAuditRow(row: Record<string, unknown>): AdminAuditEntry {
  const outcome = typeof row.outcome === 'string' && OUTCOMES.has(row.outcome)
    ? (row.outcome as AdminAuditEntry['outcome'])
    : 'failure';
  return {
    at: typeof row.at === 'string' ? row.at : '',
    actor: typeof row.actor === 'string' ? row.actor : '',
    // Anything other than an explicit TRUE is unverified. A null column on an
    // older row must not read as "this actor was verified".
    actorVerified: row.actor_verified === true,
    role: typeof row.role === 'string' ? row.role : null,
    action: typeof row.action === 'string' ? row.action : '',
    target: typeof row.target === 'string' ? row.target : null,
    outcome,
    meta: scalarMeta(row.meta),
  };
}

/**
 * Reads the DURABLE audit log, newest first.
 *
 * ROUND 11 FINDING 5. §8.9's durable sink was written and never read: `/audit`,
 * `/admins`, `/support` and `/subscriptions` all rendered the in-process ring
 * buffer, so the security and support history a reader saw was whatever this
 * process happened to have done since it started. Another instance showed
 * different history, and a restart showed none. A durable write nobody reads
 * is not an audit trail, and applying migration 35 could never have supplied
 * the missing reader.
 *
 * FAILURE IS RAISED, NEVER SWALLOWED. If the table is absent — which is the
 * shipped state until gate E4-H applies migration 35 — this throws, and the
 * caller says so on the page. Returning an empty list would read as "nothing
 * happened", which is the worst possible answer from an audit view.
 *
 * `actionPrefixes` filters server-side, one query per prefix, because a prefix
 * contains a dot and embedding dotted patterns in a PostgREST `or` filter is
 * how Gate 5 finding 6 made the Action filter unusable. The prefixes must be
 * disjoint, asserted below, so merging cannot double-count a row.
 */
export async function readAdminAuditLog(
  options: {
    limit?: number;
    actionPrefixes?: readonly string[];
    /**
     * Server-side narrowing, so the bound applies to the MATCHES.
     *
     * ROUND 12 FINDING 6, second half. A filtered page view used to search the
     * most recent 500 entries overall and then filter them, so an actor or an
     * action whose last activity was older than those 500 rows appeared to
     * have none at all. Support was the worst case: it loaded 500
     * platform-wide support events and then picked out one case.
     */
    filter?: AuditServerFilter;
  } = {},
  deps: { client?: AdminAuditClient } = {},
): Promise<readonly AdminAuditEntry[]> {
  const limit = Math.min(options.limit ?? AUDIT_READ_LIMIT, AUDIT_READ_LIMIT);
  // ROUND 12 FINDING 10: DEDUPED FIRST. `['login', 'login']` passed the
  // overlap check below -- a prefix is not "inside" itself under
  // `startsWith` when the strings are equal -- and the merge then returned
  // 500 rows holding 250 distinct events, displacing real history with
  // duplicates. The shipped prefix lists are distinct, so this was latent.
  const prefixes = [...new Set(options.actionPrefixes ?? [])];
  for (const prefix of prefixes) {
    for (const other of prefixes) {
      if (prefix !== other && prefix.startsWith(other)) {
        throw new AdminAuditReadError(
          'audit action prefixes must be disjoint: "' + prefix + '" is inside "' + other + '"',
        );
      }
    }
  }

  const client = deps.client ?? getSupabaseAdmin();
  const queries = prefixes.length === 0 ? [null] : prefixes;
  const collected: AdminAuditEntry[] = [];

  for (const prefix of queries) {
    const base = applyServerFilter(
      client
        .from('admin_audit_log')
        .select(AUDIT_COLUMNS)
        .order('at', { ascending: false })
        .limit(limit) as unknown as Record<string, unknown>,
      options.filter ?? {},
    ) as unknown as {
      like: (column: string, pattern: string) => unknown;
    };
    const { data, error } = (await (prefix === null
      ? (base as unknown)
      : base.like('action', prefix + '%'))) as {
      data: unknown;
      error: { message: string } | null;
    };
    if (error) {
      // The driver message goes to the server log, never to a page.
      console.error('[admin] admin_audit_log read failed:', error.message);
      throw new AdminAuditReadError('admin audit read failed');
    }
    for (const row of ((data ?? []) as unknown as Record<string, unknown>[])) {
      collected.push(fromAuditRow(row));
    }
  }

  return collected
    .sort((left, right) => right.at.localeCompare(left.at))
    .slice(0, limit);
}

/**
 * The hard ceiling on one EXPORT.
 *
 * Above this the endpoint refuses rather than truncating. A file is read away
 * from the screen that produced it, so it cannot carry "this is the most
 * recent 500" the way a page can.
 */
export const AUDIT_EXPORT_MAX = 50_000;

/** One page of the export pager. */
const AUDIT_EXPORT_PAGE = 1_000;

/** The server-side dimensions an audit read can narrow on. */
export interface AuditServerFilter {
  actor?: string;
  /** Matched as a PREFIX, so `admins.` selects the whole namespace. */
  action?: string;
  outcome?: string;
  /** Exact match. Support uses it for one case's history. */
  target?: string;
  /** Inclusive ISO-8601 instant bounds. */
  fromIso?: string;
  toIso?: string;
}

function applyServerFilter<T extends Record<string, unknown>>(
  query: T,
  filter: AuditServerFilter,
): T {
  let narrowed = query;
  const call = (method: string, ...args: unknown[]): void => {
    const fn = (narrowed as Record<string, unknown>)[method];
    if (typeof fn === 'function') {
      narrowed = (fn as (...a: unknown[]) => T).apply(narrowed, args);
    }
  };
  if (filter.actor !== undefined && filter.actor.length > 0) call('eq', 'actor', filter.actor);
  if (filter.outcome !== undefined && filter.outcome.length > 0) {
    call('eq', 'outcome', filter.outcome);
  }
  if (filter.action !== undefined && filter.action.length > 0) {
    call('like', 'action', filter.action + '%');
  }
  if (filter.target !== undefined && filter.target.length > 0) {
    call('eq', 'target', filter.target);
  }
  if (filter.fromIso !== undefined) call('gte', 'at', filter.fromIso);
  if (filter.toIso !== undefined) call('lte', 'at', filter.toIso);
  return narrowed;
}

/** Thrown when an export would have to truncate to succeed. */
export class AdminAuditExportTooLargeError extends Error {
  constructor(readonly scanned: number) {
    super('the audit export exceeds ' + AUDIT_EXPORT_MAX + ' matching entries');
    this.name = 'AdminAuditExportTooLargeError';
  }
}

/**
 * EVERY entry matching the filter, newest first — or a refusal.
 *
 * ROUND 12 FINDING 6. The export used `readAdminAuditLog`, which is bounded at
 * 500, and then filtered that bounded sample in memory. With 501 stored events
 * — one older `admins.disabled` denial followed by 500 logins — the unfiltered
 * export returned 200 with 500 events and `?action=admins.` returned 200 with
 * headers only. A successful CSV omitted the very event it was asked for, and
 * said nothing about it. My "refuses rather than truncating" claim was false.
 *
 * So the predicates run SERVER-SIDE, before pagination, and this pages all the
 * way through. Above `AUDIT_EXPORT_MAX` it throws, because a file that is
 * silently short is evidence of the wrong thing.
 */
export async function readAdminAuditLogForExport(
  filter: AuditServerFilter = {},
  deps: { client?: AdminAuditClient } = {},
): Promise<readonly AdminAuditEntry[]> {
  const client = deps.client ?? getSupabaseAdmin();
  const collected: AdminAuditEntry[] = [];

  for (let offset = 0; offset <= AUDIT_EXPORT_MAX; offset += AUDIT_EXPORT_PAGE) {
    const base = client
      .from('admin_audit_log')
      .select(AUDIT_COLUMNS)
      .order('at', { ascending: false })
      .range(offset, offset + AUDIT_EXPORT_PAGE - 1);
    const { data, error } = (await applyServerFilter(
      base as unknown as Record<string, unknown>,
      filter,
    )) as { data: unknown; error: { message: string } | null };
    if (error) {
      console.error('[admin] admin_audit_log export read failed:', error.message);
      throw new AdminAuditReadError('admin audit read failed');
    }
    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    for (const row of rows) collected.push(fromAuditRow(row));
    // The ceiling is checked BEFORE the "that was the last page" return, not
    // after it. My first version checked afterwards, so a final partial page
    // could carry the total past the ceiling and still resolve -- 50 010 rows
    // came back from a set that should have been refused.
    if (collected.length > AUDIT_EXPORT_MAX) {
      throw new AdminAuditExportTooLargeError(collected.length);
    }
    if (rows.length < AUDIT_EXPORT_PAGE) return collected;
  }

  throw new AdminAuditExportTooLargeError(collected.length);
}

/**
 * What a page got, and where it came from.
 *
 * `unavailable` is not an optional nicety: a page that renders `entries`
 * without rendering this message would be presenting one process's recent
 * actions as the platform's audit history, which is the defect round 11 found.
 * The route tests assert that every one of the four history views shows it.
 */
export interface AuditHistory {
  entries: readonly AdminAuditEntry[];
  /** True only when these rows came out of `admin_audit_log`. */
  durable: boolean;
  /** Non-null when the durable read failed. The page MUST render it. */
  unavailable: string | null;
}

const AUDIT_UNAVAILABLE =
  'The durable audit log could not be read, so this view shows only the actions this '
  + 'server process has recorded since it started — not the platform’s history. '
  + 'Another instance, or this one after a restart, will show something different. '
  + 'Gate E4-H (migration 35 applied to the hosted project) is what makes this view '
  + 'complete.';

/**
 * The audit history for a page: durable if it can be read, in-process if not,
 * and never silent about which.
 */
export async function auditHistory(
  options: {
    limit?: number;
    actionPrefixes?: readonly string[];
    filter?: AuditServerFilter;
  } = {},
  deps: { client?: AdminAuditClient } = {},
): Promise<AuditHistory> {
  try {
    const entries = await readAdminAuditLog(options, deps);
    return { entries, durable: true, unavailable: null };
  } catch (error) {
    if (!(error instanceof AdminAuditReadError)) throw error;
    // The in-process ring, clearly labelled as what it is. Returning nothing
    // would read as "no admin has done anything", which is worse than a
    // partial view that says it is partial.
    return {
      entries: recentAdminAudit.entries(),
      durable: false,
      unavailable: AUDIT_UNAVAILABLE,
    };
  }
}

/** The row shape, derived from the entry so the two cannot drift. */
export function toAuditRow(entry: AdminAuditEntry): Record<string, unknown> {
  return {
    at: entry.at,
    actor: entry.actor,
    actor_verified: entry.actorVerified,
    role: entry.role,
    action: entry.action,
    target: entry.target,
    outcome: entry.outcome,
    meta: entry.meta,
  };
}

export function createPostgresAuditSink(
  deps: { client?: AdminAuditClient } = {},
): PostgresAuditSink {
  // One promise per accepted entry. `flush` drains the list, so a sink reused
  // across requests never re-awaits a write it already reported on.
  // GATE 5 FINDING 2. These used to be `Promise<void>` that could REJECT, and
  // `write` is a `void` method whose callers are not required to flush —
  // `lib/adminLogin.ts` audits a failed login and returns without flushing. So
  // an unavailable audit table produced an **unhandled rejection** on the login
  // path, which Node's default `--unhandled-rejections=throw` turns into a
  // process crash. An audit failure must never be able to take down the thing
  // it is auditing.
  //
  // Each task is therefore HANDLED AT CREATION and settles to a boolean. The
  // failure is not swallowed: `flush` still throws for any insert in the batch
  // it drained, which is what `recordAdminActionDurably`'s awaited callers rely
  // on, and the driver message still reaches the server log either way.
  let pending: Promise<boolean>[] = [];

  return {
    write(entry) {
      const client = deps.client ?? getSupabaseAdmin();
      const task = (async () => {
        const { error } = await client.from('admin_audit_log').insert(toAuditRow(entry));
        if (error) {
          // The driver message goes to the server log and never to a caller.
          console.error('[admin] admin_audit_log insert failed:', error.message);
          throw new Error('admin audit insert failed');
        }
      })();
      // The handler is attached SYNCHRONOUSLY, in the same turn the promise is
      // created, so there is no window in which a rejection is unobserved.
      pending.push(
        task.then(
          () => true,
          (error: unknown) => {
            // A driver error is already logged above. This branch also catches
            // a throw from the client itself, which would otherwise be silent.
            if (!(error instanceof Error && error.message === 'admin audit insert failed')) {
              console.error('[admin] admin_audit_log insert threw');
            }
            return false;
          },
        ),
      );
    },
    async flush() {
      const draining = pending;
      pending = [];
      // These cannot reject any more, so `Promise.all` is safe and every write
      // in the batch is still awaited — one failure never leaves another
      // unawaited.
      const results = await Promise.all(draining);
      if (results.includes(false)) {
        throw new Error('admin audit insert failed');
      }
    },
  };
}

// Module-scoped so every call site in a request shares one pending list, and a
// flush on one path cannot leave another path's insert unawaited.
let defaultPostgresSink: PostgresAuditSink | null = null;

function postgresSink(): PostgresAuditSink {
  if (defaultPostgresSink === null) {
    defaultPostgresSink = createPostgresAuditSink();
  }
  return defaultPostgresSink;
}

/**
 * The sinks every Batch 3 admin path writes to: stderr FIRST, then the
 * in-process view, then Postgres.
 */
export function durableAuditSinks(): readonly AdminAuditSink[] {
  return [stderrAuditSink, recentAdminAudit, postgresSink()];
}

/**
 * Records, and does not return until the durable copy has committed or failed.
 *
 * It NEVER THROWS. An audit failure is a fact the caller has to act on — §8.9d
 * turns it into a distinct result shape — and a throw here would unwind a
 * mutation that had already committed, which is the one outcome worth avoiding.
 */
export async function recordAdminActionDurably(
  input: AdminAuditInput,
  sinks: readonly AdminAuditSink[] = durableAuditSinks(),
): Promise<DurableAuditResult> {
  const entry = recordAdminAction(input, sinks);

  const flushable = sinks.filter(
    (sink): sink is AdminAuditSink & { flush: () => Promise<void> } =>
      typeof sink.flush === 'function',
  );
  if (flushable.length === 0) {
    return { entry, durability: 'stderr_only' };
  }

  const settled = await Promise.allSettled(flushable.map((sink) => sink.flush()));
  const failed = settled.some((outcome) => outcome.status === 'rejected');
  return { entry, durability: failed ? 'failed' : 'durable' };
}
