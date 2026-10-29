import 'server-only';

// Batch 3 §8.7 — the authorized support writes: open a case, update a case,
// append a note.
//
// The shape is lib/adminIdentityActions.ts's: check `support.write` FIRST,
// parse the shared schema, write through the store module, audit on every path,
// and report a committed-but-unrecorded write as its own outcome rather than as
// a failure that invites a retry.
//
// NO DIRECT TABLE WRITE HAPPENS IN THIS FILE. §8.12's manifest names
// lib/adminSupportStore.ts as the only module permitted to write the two
// support tables, and this one calls down to it.
//
// WHAT A SUPPORT ADMIN STILL CANNOT DO, which is most of the point. The role
// holds `support.read` and `support.write` and nothing else — no
// `subscriptions.write`, no shop access beyond reading. Every write reachable
// from here lands in an admin table. A note is a row in `admin_support_notes`;
// it is not, and cannot become, a write to a pharmacy's data.
//
// THE NOTE'S TEXT IS NEVER AUDITED. §8.9's redaction allowlist has no key for
// free text, and a support note legitimately carries a pharmacy's details — an
// owner's name, what they said on the phone. The audit entry records THAT a
// note was appended, by whom, to which case. The note itself is the record of
// its own content, in an append-only table.

import {
  adminSupportCaseCreateSchema,
  adminSupportCaseUpdateSchema,
  adminSupportNoteCreateSchema,
} from '@muthoy/validation';
import { type AdminAuditSink } from './adminAudit';
import { recordAdminActionDurably, type AdminAuditDurability } from './adminAuditStore';
import { resultForDurability, type AdminWriteResult } from './adminAssignments';
import { requireAdminPermission, type AdminAuthzDeps, type AdminEnvironment } from './adminAuthz';
import { describeSupportChange } from './adminSupport';
import {
  insertSupportCase,
  insertSupportNote,
  readSupportCase,
  updateSupportCase,
  type AdminSupportStoreDeps,
} from './adminSupportStore';

export interface AdminSupportActionDeps extends AdminSupportStoreDeps, AdminAuthzDeps {
  env?: AdminEnvironment;
  sinks?: readonly AdminAuditSink[];
}

type SupportAction = 'support.case_open' | 'support.case_update' | 'support.note_add';

/**
 * §8.9. ASYNC and AWAITED on every return path, success and failure.
 *
 * `actorVerified` is TRUE for every call here: `requireAdminPermission` ran
 * first, so the actor came from a verified session cookie. `caseId` and
 * `shopId` are §8.9 allowlist keys and each is dropped unless it is a real
 * UUID, so a malformed one is absent rather than half-recorded.
 */
async function audit(
  input: {
    actor: string;
    role: string | null;
    action: SupportAction;
    target: string;
    outcome: 'success' | 'failure' | 'denied';
    reason?: string;
    caseId?: string;
    shopId?: string;
  },
  sinks: readonly AdminAuditSink[] | undefined,
): Promise<AdminAuditDurability> {
  const entry = {
    actor: input.actor,
    actorVerified: true,
    role: input.role,
    action: input.action,
    target: input.target,
    outcome: input.outcome,
    meta: {
      ...(input.reason === undefined ? {} : { reason: input.reason }),
      ...(input.caseId === undefined ? {} : { caseId: input.caseId }),
      ...(input.shopId === undefined ? {} : { shopId: input.shopId }),
    },
  };
  const result = sinks
    ? await recordAdminActionDurably(entry, sinks)
    : await recordAdminActionDurably(entry);
  return result.durability;
}

function storeDeps(deps: AdminSupportActionDeps | undefined): AdminSupportStoreDeps {
  return { client: deps?.client, now: deps?.now };
}

/** Opens a case against one shop. */
export async function openSupportCase(
  payload: unknown,
  deps?: AdminSupportActionDeps,
): Promise<AdminWriteResult> {
  const env = deps?.env ?? process.env;
  const session = await requireAdminPermission('support.write', env, {
    readAssignment: deps?.readAssignment,
  });

  const parsed = adminSupportCaseCreateSchema.safeParse(payload);
  if (!parsed.success) {
    await audit(
      {
        actor: session.username,
        role: session.role,
        action: 'support.case_open',
        target: 'invalid',
        outcome: 'failure',
        reason: 'invalid payload',
      },
      deps?.sinks,
    );
    return { ok: false, message: 'That case is not a valid request. Every case needs a shop.' };
  }
  const { shopId, category, priority, summary } = parsed.data;

  try {
    const caseId = await insertSupportCase(
      { shopId, category, priority, summary, openedBy: session.username },
      storeDeps(deps),
    );
    const durability = await audit(
      {
        actor: session.username,
        role: session.role,
        action: 'support.case_open',
        // ROUND 14 FINDING 9: the CASE id, which is what the history reader
        // matches on. `target: shopId` meant the opening event never appeared
        // in the history of the case it opened.
        target: caseId,
        outcome: 'success',
        reason: category + ' ' + priority,
        caseId,
        shopId,
      },
      deps?.sinks,
    );
    return resultForDurability(durability, 'The case is open.');
  } catch (error: unknown) {
    console.error('[admin] support case open failed:', error);
    await audit(
      {
        actor: session.username,
        role: session.role,
        action: 'support.case_open',
        target: shopId,
        outcome: 'failure',
        reason: 'write failed',
        shopId,
      },
      deps?.sinks,
    );
    // A shop_id matching no shop is refused by the foreign key, and that is the
    // common real failure here — so the sentence names it.
    return {
      ok: false,
      message: 'That case could not be opened. Check that the shop still exists.',
    };
  }
}

/**
 * Updates a case's status, priority, assignee and summary.
 *
 * The case is READ first, so the audit entry can say what changed rather than
 * only that something did — and so a case id matching nothing is reported as
 * "no such case" instead of as a silent no-op. PostgREST's update against a
 * non-matching filter SUCCEEDS and affects zero rows, so without this read the
 * caller would be told the change was saved.
 */
export async function updateSupportCaseStatus(
  payload: unknown,
  deps?: AdminSupportActionDeps,
): Promise<AdminWriteResult> {
  const env = deps?.env ?? process.env;
  const session = await requireAdminPermission('support.write', env, {
    readAssignment: deps?.readAssignment,
  });

  const parsed = adminSupportCaseUpdateSchema.safeParse(payload);
  if (!parsed.success) {
    await audit(
      {
        actor: session.username,
        role: session.role,
        action: 'support.case_update',
        target: 'invalid',
        outcome: 'failure',
        reason: 'invalid payload',
      },
      deps?.sinks,
    );
    return { ok: false, message: 'That case update is not a valid request.' };
  }
  const { caseId, status, priority, assignee, summary } = parsed.data;

  try {
    const before = await readSupportCase(caseId, storeDeps(deps));
    if (before === null) {
      await audit(
        {
          actor: session.username,
          role: session.role,
          action: 'support.case_update',
          target: caseId,
          outcome: 'failure',
          reason: 'no such case',
          caseId,
        },
        deps?.sinks,
      );
      return { ok: false, message: 'No such support case exists.' };
    }

    const change = describeSupportChange(before, { status, priority, assignee, summary });
    await updateSupportCase({ caseId, status, priority, assignee, summary }, storeDeps(deps));

    const durability = await audit(
      {
        actor: session.username,
        role: session.role,
        action: 'support.case_update',
        target: caseId,
        outcome: 'success',
        // An empty description means the form was submitted unchanged. Saying
        // so is more useful than an entry claiming a transition that did not
        // happen.
        reason: change.length === 0 ? 'no change' : change,
        caseId,
        shopId: before.shopId,
      },
      deps?.sinks,
    );
    return resultForDurability(
      durability,
      change.length === 0 ? 'Saved. Nothing changed.' : 'Saved. ' + change + '.',
    );
  } catch (error: unknown) {
    console.error('[admin] support case update failed:', error);
    await audit(
      {
        actor: session.username,
        role: session.role,
        action: 'support.case_update',
        target: caseId,
        outcome: 'failure',
        reason: 'write failed',
        caseId,
      },
      deps?.sinks,
    );
    return { ok: false, message: 'That case could not be updated. Nothing was changed.' };
  }
}

/**
 * Appends a note to a case.
 *
 * The case is read first for the same reason as above: `admin_support_notes`
 * has a RESTRICT foreign key, so a note against a missing case would be refused
 * by the database — but with a constraint error rather than a sentence an
 * operator can act on.
 */
export async function addSupportNote(
  payload: unknown,
  deps?: AdminSupportActionDeps,
): Promise<AdminWriteResult> {
  const env = deps?.env ?? process.env;
  const session = await requireAdminPermission('support.write', env, {
    readAssignment: deps?.readAssignment,
  });

  const parsed = adminSupportNoteCreateSchema.safeParse(payload);
  if (!parsed.success) {
    await audit(
      {
        actor: session.username,
        role: session.role,
        action: 'support.note_add',
        target: 'invalid',
        outcome: 'failure',
        reason: 'invalid payload',
      },
      deps?.sinks,
    );
    return { ok: false, message: 'That note is not a valid request.' };
  }
  const { caseId, body } = parsed.data;

  try {
    const existing = await readSupportCase(caseId, storeDeps(deps));
    if (existing === null) {
      await audit(
        {
          actor: session.username,
          role: session.role,
          action: 'support.note_add',
          target: caseId,
          outcome: 'failure',
          reason: 'no such case',
          caseId,
        },
        deps?.sinks,
      );
      return { ok: false, message: 'No such support case exists.' };
    }

    await insertSupportNote({ caseId, body, author: session.username }, storeDeps(deps));
    const durability = await audit(
      {
        actor: session.username,
        role: session.role,
        action: 'support.note_add',
        target: caseId,
        outcome: 'success',
        // The LENGTH, never the text. A note's content belongs in the note.
        reason: body.length + ' characters',
        caseId,
        shopId: existing.shopId,
      },
      deps?.sinks,
    );
    return resultForDurability(durability, 'The note is saved and cannot be edited or deleted.');
  } catch (error: unknown) {
    console.error('[admin] support note append failed:', error);
    await audit(
      {
        actor: session.username,
        role: session.role,
        action: 'support.note_add',
        target: caseId,
        outcome: 'failure',
        reason: 'write failed',
        caseId,
      },
      deps?.sinks,
    );
    return { ok: false, message: 'That note could not be saved. Nothing was written.' };
  }
}
