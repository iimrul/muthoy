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
import { assignAdminRole, revokeAdminSessions } from '../lib/adminIdentityActions';
import { outcomeFor, outcomeQuery } from '../lib/adminOutcomes';
import { setPlatformFeatureFlag } from '../lib/adminSettingsActions';
import {
  addSupportNote,
  openSupportCase,
  updateSupportCaseStatus,
} from '../lib/adminSupportActions';

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

// ───────────────────────────────────────────────────────────────── Batch 3
//
// The same split as above: these are HTTP surfaces, and every decision — the
// permission, the shared-schema parse, the audit, the write — lives in
// lib/adminSettingsActions.ts, lib/adminSupportActions.ts and
// lib/adminIdentityActions.ts, where Vitest executes it.
//
// EVERY ONE OF THEM GOES THROUGH `outcomeFor`, which is what carries §8.9d's
// third outcome. A write that COMMITTED but could not be audited redirects to
// `?applied_unrecorded=`, never to `?failed=`. The distinction is the whole
// point: a support note cannot be deleted, so telling an operator that an
// appended note failed invites the retry that appends a second copy of it.

export async function setFeatureFlagAction(formData: FormData): Promise<void> {
  const result = await setPlatformFeatureFlag({
    key: String(formData.get('key') ?? ''),
    // A checkbox submits its value only when ticked, so a hidden companion
    // field is what makes "off" a submitted value rather than an absent one.
    value: String(formData.get('value') ?? '') === 'true',
  });
  redirect('/settings' + outcomeQuery('setting', outcomeFor(result)));
}

export async function openSupportCaseAction(formData: FormData): Promise<void> {
  const result = await openSupportCase({
    shopId: String(formData.get('shopId') ?? ''),
    category: String(formData.get('category') ?? ''),
    priority: String(formData.get('priority') ?? ''),
    summary: String(formData.get('summary') ?? ''),
  });
  redirect('/support' + outcomeQuery('case_open', outcomeFor(result)));
}

export async function updateSupportCaseAction(formData: FormData): Promise<void> {
  const caseId = String(formData.get('caseId') ?? '');
  const result = await updateSupportCaseStatus({
    caseId,
    status: String(formData.get('status') ?? ''),
    priority: String(formData.get('priority') ?? ''),
    assignee: String(formData.get('assignee') ?? ''),
    summary: String(formData.get('summary') ?? ''),
  });
  redirect('/support/' + caseId + outcomeQuery('case_update', outcomeFor(result)));
}

export async function addSupportNoteAction(formData: FormData): Promise<void> {
  const caseId = String(formData.get('caseId') ?? '');
  const result = await addSupportNote({ caseId, body: String(formData.get('body') ?? '') });
  redirect('/support/' + caseId + outcomeQuery('note_add', outcomeFor(result)));
}

export async function assignAdminRoleAction(formData: FormData): Promise<void> {
  const result = await assignAdminRole({
    username: String(formData.get('username') ?? ''),
    role: String(formData.get('role') ?? ''),
    isActive: String(formData.get('isActive') ?? '') === 'true',
  });
  redirect('/admins' + outcomeQuery('assign_role', outcomeFor(result)));
}

export async function revokeAdminSessionsAction(formData: FormData): Promise<void> {
  const result = await revokeAdminSessions({ username: String(formData.get('username') ?? '') });
  redirect('/admins' + outcomeQuery('revoke_sessions', outcomeFor(result)));
}
