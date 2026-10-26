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
