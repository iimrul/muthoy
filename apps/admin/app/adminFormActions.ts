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
} from '../lib/adminActions';
import { outcomeFor, outcomeQuery } from '../lib/adminOutcomes';

// Batch 3 §8.9d. `outcomeQuery(action, ok)` took a BOOLEAN and could emit only
// `?done=` or `?failed=`, so a write that committed but could not be audited
// had no way to say so and would have read as a plain failure — which invites
// the retry that repeats the change. The three-way mapping lives in
// lib/adminOutcomes.ts, where it is unit-tested.

// E11: `refreshSnapshotAction` was HERE and is deliberately gone. It was the
// HTTP surface of the withdrawn entitlement refresh — see the explanation in
// lib/adminActions.ts. Removing the export removes the POST endpoint, which is
// the part that mattered: a disabled button with a live server action behind it
// is not a removed capability.

export async function reconcileLimitsAction(formData: FormData): Promise<void> {
  const accountId = String(formData.get('accountId') ?? '');
  const result = await reconcilePlanLimits(accountId);
  redirect('/accounts/' + accountId + outcomeQuery('reconcile', outcomeFor(result)));
}

export async function expireOrderAction(formData: FormData): Promise<void> {
  const orderId = String(formData.get('orderId') ?? '');
  const result = await expireStalePaymentOrder(orderId);
  redirect('/payments' + outcomeQuery('expire', outcomeFor(result)));
}
