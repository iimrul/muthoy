import 'server-only';

// W4-08 — the admin panel's ONLY write actions. Three, deliberately.
//
// | Action | Permission | Mechanism |
// | refresh an entitlement snapshot | subscriptions.write | b4_refresh_entitlement_snapshot(uuid), an existing SECURITY DEFINER RPC |
// | reconcile plan limits           | subscriptions.write | b4_reconcile_plan_limits(uuid, timestamptz), the same |
// | expire a stale payment order    | support.write       | the exact guarded update billingStatus already performs |
//
// NO money edit, no entitlement grant, no plan change, no refund, no shop
// write. The master plan's rule — admin writes must not bypass the money/stock
// invariants, prefer existing SECURITY DEFINER RPCs — is satisfied by calling
// only RPCs that already exist and already carry their invariants, plus one
// status transition the server already performs on its own schedule.
//
// A shop write would additionally need an `update` grant on shops, which does
// not exist and would be a migration, which is sealed. That is why
// location/map management is reported BLOCKED rather than built (plan §5.4),
// and lib/adminGrants.test.ts asserts the grant's absence.
//
// Every action: permission FIRST, a validated uuid, then one call, then an
// audit entry — on success AND on failure. Each is idempotent by construction,
// because each either re-derives a snapshot from its source rows or performs a
// guarded transition that matches nothing the second time.

import { revalidatePath } from 'next/cache';
import { recordAdminAction, type AdminAuditSink } from './adminAudit';
import { requireAdminPermission, type AdminEnvironment } from './adminAuthz';
import { isUuid } from './adminViews';
import { AdminDataError } from './errors';
import { getSupabaseAdmin } from './supabaseAdmin';

export type AdminActionResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

export interface AdminActionDeps {
  env?: AdminEnvironment;
  now?: () => Date;
  sinks?: readonly AdminAuditSink[];
  /** Injected in tests; production always uses the real service-role client. */
  client?: Pick<ReturnType<typeof getSupabaseAdmin>, 'rpc' | 'from'>;
  /** Skipped in tests, which have no Next request scope. */
  revalidate?: (path: string) => void;
}

function audit(
  input: {
    actor: string;
    role: string;
    action: string;
    target: string;
    outcome: 'success' | 'failure';
    reason?: string;
  },
  sinks: readonly AdminAuditSink[] | undefined,
): void {
  const entry = {
    actor: input.actor,
    role: input.role,
    action: input.action,
    target: input.target,
    outcome: input.outcome,
    meta: input.reason === undefined ? undefined : { reason: input.reason },
  };
  if (sinks) {
    recordAdminAction(entry, sinks);
    return;
  }
  recordAdminAction(entry);
}

/** Refreshes one account's entitlement snapshot from its own subscription rows. */
export async function refreshEntitlementSnapshot(
  accountId: string,
  deps: AdminActionDeps = {},
): Promise<AdminActionResult> {
  // Permission FIRST: a denial is audited by requirePermission and nothing
  // below it runs, so no client is constructed and no RPC is reached.
  const session = await requireAdminPermission('subscriptions.write', deps.env);

  if (!isUuid(accountId)) {
    audit({ actor: session.username, role: session.role, action: 'subscription.refresh_snapshot', target: 'invalid', outcome: 'failure', reason: 'invalid_id' }, deps.sinks);
    throw new AdminDataError('account is not a valid id');
  }

  const client = deps.client ?? getSupabaseAdmin();
  const { error } = await client.rpc('b4_refresh_entitlement_snapshot', {
    p_billing_account_id: accountId,
  });

  if (error) {
    console.error('[admin] refresh snapshot failed:', error.message);
    audit({ actor: session.username, role: session.role, action: 'subscription.refresh_snapshot', target: accountId, outcome: 'failure', reason: 'rpc_failed' }, deps.sinks);
    return { ok: false, message: 'Could not refresh the entitlement snapshot. The server log has the details.' };
  }

  audit({ actor: session.username, role: session.role, action: 'subscription.refresh_snapshot', target: accountId, outcome: 'success' }, deps.sinks);
  (deps.revalidate ?? revalidatePath)('/accounts/' + accountId);
  return { ok: true, message: 'Entitlement snapshot refreshed.' };
}

/** Re-applies the account's plan limits to its shops and staff. */
export async function reconcilePlanLimits(
  accountId: string,
  deps: AdminActionDeps = {},
): Promise<AdminActionResult> {
  const session = await requireAdminPermission('subscriptions.write', deps.env);

  if (!isUuid(accountId)) {
    audit({ actor: session.username, role: session.role, action: 'subscription.reconcile_limits', target: 'invalid', outcome: 'failure', reason: 'invalid_id' }, deps.sinks);
    throw new AdminDataError('account is not a valid id');
  }

  const client = deps.client ?? getSupabaseAdmin();
  const { error } = await client.rpc('b4_reconcile_plan_limits', {
    p_billing_account_id: accountId,
    p_now: (deps.now ?? (() => new Date()))().toISOString(),
  });

  if (error) {
    console.error('[admin] reconcile plan limits failed:', error.message);
    audit({ actor: session.username, role: session.role, action: 'subscription.reconcile_limits', target: accountId, outcome: 'failure', reason: 'rpc_failed' }, deps.sinks);
    return { ok: false, message: 'Could not reconcile plan limits. The server log has the details.' };
  }

  audit({ actor: session.username, role: session.role, action: 'subscription.reconcile_limits', target: accountId, outcome: 'success' }, deps.sinks);
  (deps.revalidate ?? revalidatePath)('/accounts/' + accountId);
  return { ok: true, message: 'Plan limits reconciled.' };
}

/**
 * Marks ONE already-stale payment order expired.
 *
 * This is the only direct table write in the whole panel, and it is the exact
 * update billingStatus already performs: the same guard
 * (status in created/pending AND expires_at <= now), the same two columns. The
 * guard is what makes it safe and idempotent — a verified, failed, canceled or
 * still-live order matches nothing, so the action cannot cancel a payment that
 * is in flight or re-open one that settled. Money state is never touched:
 * entitlements are granted only by the verified webhook.
 */
export async function expireStalePaymentOrder(
  orderId: string,
  deps: AdminActionDeps = {},
): Promise<AdminActionResult> {
  const session = await requireAdminPermission('support.write', deps.env);

  if (!isUuid(orderId)) {
    audit({ actor: session.username, role: session.role, action: 'payment.expire_stale_order', target: 'invalid', outcome: 'failure', reason: 'invalid_id' }, deps.sinks);
    throw new AdminDataError('payment order is not a valid id');
  }

  const now = (deps.now ?? (() => new Date()))().toISOString();
  const client = deps.client ?? getSupabaseAdmin();

  const { data, error } = await client
    .from('payment_orders')
    .update({ status: 'expired', failure_code: 'checkout_expired', updated_at: now })
    .eq('id', orderId)
    .in('status', ['created', 'pending'])
    .lte('expires_at', now)
    .select('id,status');

  if (error) {
    console.error('[admin] expire payment order failed:', error.message);
    audit({ actor: session.username, role: session.role, action: 'payment.expire_stale_order', target: orderId, outcome: 'failure', reason: 'update_failed' }, deps.sinks);
    return { ok: false, message: 'Could not expire that payment order. The server log has the details.' };
  }

  const changed = Array.isArray(data) ? data.length : 0;
  if (changed === 0) {
    // Not an error: the guard did its job. A second click, or an order that is
    // still live or already terminal, lands here.
    audit({ actor: session.username, role: session.role, action: 'payment.expire_stale_order', target: orderId, outcome: 'failure', reason: 'not_stale' }, deps.sinks);
    return {
      ok: false,
      message: 'That order is not a stale open order, so nothing was changed.',
    };
  }

  audit({ actor: session.username, role: session.role, action: 'payment.expire_stale_order', target: orderId, outcome: 'success' }, deps.sinks);
  (deps.revalidate ?? revalidatePath)('/payments');
  return { ok: true, message: 'Payment order marked expired.' };
}
