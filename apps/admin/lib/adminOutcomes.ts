// Batch 3 §8.9d — the three outcomes a write can have, and the sentence each
// one gets.
//
// FRAMEWORK-FREE: it takes a plain searchParams bag, so every sentence is a
// unit test. It was two divergent inline blocks before — app/payments and
// app/accounts/[id] each read `done` and `failed` their own way — and a third
// outcome spread across two private copies is how one page ends up telling the
// truth and the other one not.
//
// WHY THERE IS A THIRD OUTCOME. An admin write and its audit row are two
// operations. If the write committed and the audit insert then failed,
// reporting an ordinary failure would be false AND dangerous: it invites a
// retry, and a retry duplicates a non-idempotent write such as a support note.
// So that case says what happened — applied, not recorded, do not retry — and
// the stderr line plus the server log carry the record.
//
// Where a write is a single statement that can carry its own audit row, the two
// are issued in one transaction and this outcome cannot arise. It exists for
// the paths where they cannot be.

import { type AdminWriteResult } from './adminAssignments';

export type AdminWriteOutcome = 'done' | 'failed' | 'applied_unrecorded';

/** The query-string key each outcome is carried on. */
export const OUTCOME_KEYS: Readonly<Record<AdminWriteOutcome, string>> = Object.freeze({
  done: 'done',
  failed: 'failed',
  applied_unrecorded: 'applied_unrecorded',
});

/**
 * `?done=reconcile`, `?failed=reconcile` or `?applied_unrecorded=reconcile`.
 *
 * It takes the OUTCOME and not a boolean. `outcomeQuery(action, ok)` could only
 * ever express two of the three, which is what made the third outcome
 * unreportable before.
 */
export function outcomeQuery(action: string, outcome: AdminWriteOutcome): string {
  return '?' + OUTCOME_KEYS[outcome] + '=' + encodeURIComponent(action);
}

/**
 * Turns an action result into its outcome. One place, so no call site has to
 * remember that `committed: true` is not an ordinary failure.
 */
export function outcomeFor(result: AdminWriteResult): AdminWriteOutcome {
  if (result.ok) return 'done';
  return result.committed === true ? 'applied_unrecorded' : 'failed';
}

/** What the page says, per action, on success. */
export interface OutcomeMessages {
  readonly [action: string]: string;
}

const GENERIC_FAILURE =
  'That action could not be confirmed. Check its current state before retrying. '
  + 'The server log has the details.';

const APPLIED_UNRECORDED =
  'The change WAS applied, but it could not be written to the audit log. '
  + 'Do not retry this submission. '
  + 'The server log holds the record.';

function firstString(value: string | string[] | undefined): string | null {
  if (typeof value === 'string') return value;
  // Next gives an array when a key repeats. Taking the first is the browser's
  // own reading, and a repeated key must not read as "no outcome at all".
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return null;
}

/**
 * The notice for this request, or null when the URL carries no outcome.
 *
 * `applied_unrecorded` is checked FIRST. A redirect carrying more than one key
 * is malformed, and of the three the one that must never be missed is the one
 * telling the reader not to retry.
 */
export function outcomeNote(
  params: Record<string, string | string[] | undefined>,
  successMessages: OutcomeMessages = {},
): string | null {
  const unrecorded = firstString(params[OUTCOME_KEYS.applied_unrecorded]);
  if (unrecorded !== null) return APPLIED_UNRECORDED;

  const failed = firstString(params[OUTCOME_KEYS.failed]);
  if (failed !== null) return GENERIC_FAILURE;

  const done = firstString(params[OUTCOME_KEYS.done]);
  if (done === null) return null;
  // Own-property lookup: plain `messages[done]` would resolve an inherited name
  // such as `constructor` to a function and render it as a notice.
  return Object.prototype.hasOwnProperty.call(successMessages, done)
    ? successMessages[done] ?? null
    : null;
}

/** Exported so a test can assert the three sentences are distinct and non-empty. */
export const OUTCOME_SENTENCES: Readonly<Record<'failed' | 'applied_unrecorded', string>> =
  Object.freeze({
    failed: GENERIC_FAILURE,
    applied_unrecorded: APPLIED_UNRECORDED,
  });
