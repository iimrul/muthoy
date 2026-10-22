'use server';

// W4-08 — the HTTP surface of the three write actions, and nothing more.
//
// Thin on purpose: these are Next server actions, so each export becomes a
// POST endpoint. The decisions — permission, id validation, the guarded
// update, the audit entry — all live in lib/adminActions.ts where Vitest can
// execute them. Same split as the login route.
//
// What protects these endpoints: the session cookie is SameSite=Strict, so a
// cross-site POST carries no cookie and requireAdminPermission refuses; and
// the permission check runs before anything else regardless of who calls.
// A form in a Server Component needs a 'use server' function, which is why
// this module exists rather than the pages importing lib/adminActions.ts
// directly.

import { redirect } from 'next/navigation';
import {
  expireStalePaymentOrder,
  reconcilePlanLimits,
  refreshEntitlementSnapshot,
} from '../lib/adminActions';

/** 'done' or 'failed' plus the action name, so the page can say what happened. */
function outcomeQuery(action: string, ok: boolean): string {
  return '?' + (ok ? 'done=' : 'failed=') + action;
}

export async function refreshSnapshotAction(formData: FormData): Promise<void> {
  const accountId = String(formData.get('accountId') ?? '');
  const result = await refreshEntitlementSnapshot(accountId);
  redirect('/accounts/' + accountId + outcomeQuery('refresh', result.ok));
}

export async function reconcileLimitsAction(formData: FormData): Promise<void> {
  const accountId = String(formData.get('accountId') ?? '');
  const result = await reconcilePlanLimits(accountId);
  redirect('/accounts/' + accountId + outcomeQuery('reconcile', result.ok));
}

export async function expireOrderAction(formData: FormData): Promise<void> {
  const orderId = String(formData.get('orderId') ?? '');
  const result = await expireStalePaymentOrder(orderId);
  redirect('/payments' + outcomeQuery('expire', result.ok));
}
