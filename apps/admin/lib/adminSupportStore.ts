import 'server-only';

// Batch 3 §8.7 / §8.12 — the ONLY module that reads or writes
// `admin_support_cases` and `admin_support_notes`.
//
// It holds no authorization of its own. lib/adminSupportActions.ts is the
// authorized surface: it checks `support.write`, parses the shared schema,
// audits, and calls down to here.
//
// WHAT THE TABLES CANNOT DO, by privilege rather than by convention
// (20261023000000:202-231):
//
//   admin_support_cases   select, insert, and a COLUMN-LEVEL update on
//                         (status, priority, assignee, summary, updated_at).
//                         `id`, `shop_id`, `opened_by` and `opened_at` are the
//                         attribution — a case cannot be silently reassigned to
//                         a different shop or a different opener.
//
//   admin_support_notes   select and insert, and NOTHING else. No update, no
//                         delete, no column-level update. That is what
//                         append-only means here: not a UI that offers no edit
//                         button, but a privilege that would refuse one.
//
// SO THIS MODULE ISSUES NO UPSERT, for the reason lib/adminIdentityStore.ts
// gives: PostgREST's upsert is `insert ... on conflict do update` over the SAME
// column list, and on the conflict path that list includes columns the update
// grant excludes.
//
// A NOTE IS NOT A SHOP WRITE. §8.7's point about support staff is structural:
// the only tables named here are the two admin ones. A support admin writing a
// note touches `admin_support_notes` and nothing a pharmacy owns.

import { containsPattern } from './adminFilters';
import { AdminDataError } from './errors';
import { getSupabaseAdmin } from './supabaseAdmin';
import {
  SUPPORT_CASE_COLUMNS,
  SUPPORT_NOTE_COLUMNS,
  parseSupportCaseRow,
  parseSupportNoteRow,
  type SupportCaseRow,
  type SupportCategory,
  type SupportNoteRow,
  type SupportPriority,
  type SupportStatus,
} from './adminSupport';

/** The service-role surface this module needs. Injected whole in tests. */
export type AdminSupportClient = Pick<ReturnType<typeof getSupabaseAdmin>, 'from'>;

export interface AdminSupportStoreDeps {
  client?: AdminSupportClient;
  now?: () => Date;
}

function clientFor(deps: AdminSupportStoreDeps | undefined): AdminSupportClient {
  return deps?.client ?? getSupabaseAdmin();
}

function nowFor(deps: AdminSupportStoreDeps | undefined): Date {
  return deps?.now?.() ?? new Date();
}

/** A bound on any one page of cases. The table is operator-created, so small. */
const MAX_CASES = 500;
const MAX_NOTES_PER_CASE = 500;

export interface SupportCaseQuery {
  status?: string;
  /** An exact shop id, for the drill-down's support block. */
  shopId?: string;
  /**
   * §8.7's free-text search over the case SUMMARY.
   *
   * GATE 5 FINDING 14: specified and absent — the page offered a status filter
   * only. The pattern is built by `containsPattern` from lib/adminFilters.ts,
   * which owns the LIKE escaping, so `%`, `_`, `\` and PostgREST's `*` alias
   * are literal text rather than wildcards the operator did not type.
   */
  search?: string;
}

/**
 * The case list, newest activity first.
 *
 * `status` and `shopId` are EQUALITY filters on values the caller has already
 * parsed, so no pattern metacharacter is in play. The free-text search over a
 * case SUMMARY is applied by the page through lib/adminFilters.ts, which owns
 * the escaping — this module does not hand-build a pattern.
 */
export async function listSupportCases(
  query: SupportCaseQuery = {},
  deps?: AdminSupportStoreDeps,
): Promise<SupportCaseRow[]> {
  let request = clientFor(deps).from('admin_support_cases').select(SUPPORT_CASE_COLUMNS);

  if (query.status !== undefined && query.status.length > 0) {
    request = request.eq('status', query.status);
  }
  if (query.shopId !== undefined && query.shopId.length > 0) {
    request = request.eq('shop_id', query.shopId);
  }
  if (query.search !== undefined && query.search.trim().length > 0) {
    // `ilike` on ONE column, with the pattern escaped by the shared helper. A
    // single column means no `.or()` is built here, so the filter-grammar
    // injection surface lib/adminFilters.ts guards does not arise at all.
    request = request.ilike('summary', containsPattern(query.search.trim()));
  }

  const { data, error } = await request
    .order('updated_at', { ascending: false })
    // A deterministic tiebreak, so two cases updated in the same millisecond
    // cannot swap places between renders.
    .order('id', { ascending: true })
    .range(0, MAX_CASES - 1);

  if (error) {
    console.error('[admin] admin_support_cases list failed:', error.message);
    throw new AdminDataError('support case list failed');
  }
  return (data ?? []).map((row) => parseSupportCaseRow(row as Record<string, unknown>));
}

/** One case, or null when no such case exists. */
export async function readSupportCase(
  caseId: string,
  deps?: AdminSupportStoreDeps,
): Promise<SupportCaseRow | null> {
  if (caseId.length === 0) {
    throw new AdminDataError('a support case lookup needs a case id');
  }

  const { data, error } = await clientFor(deps)
    .from('admin_support_cases')
    .select(SUPPORT_CASE_COLUMNS)
    .eq('id', caseId)
    .limit(1);

  if (error) {
    console.error('[admin] admin_support_cases read failed:', error.message);
    throw new AdminDataError('support case read failed');
  }

  const rows = data ?? [];
  if (rows.length === 0) return null;
  return parseSupportCaseRow(rows[0] as Record<string, unknown>);
}

/**
 * One case's notes, in insertion order, with the NEWEST ones kept.
 *
 * ROUND 12 FINDING 8. This ordered ASCENDING and always read `range(0, 499)`,
 * so once a case had more than `MAX_NOTES_PER_CASE` notes it returned the
 * OLDEST 500 and every note added after that was invisible — permanently, and
 * silently. An operator reading a long case saw a frozen history and had no
 * way to tell: adding a note could not make it appear.
 *
 * So the read takes the newest page and the caller is told when there is more.
 * The rows come back oldest-first within that page, because a case reads as a
 * conversation.
 */
export async function listSupportNotesPage(
  caseId: string,
  deps?: AdminSupportStoreDeps,
): Promise<{ notes: SupportNoteRow[]; olderWithheld: boolean }> {
  if (caseId.length === 0) {
    throw new AdminDataError('a support note lookup needs a case id');
  }

  // ROUND 15 FINDING 7: the COUNT decides, not an extra row.
  //
  // Asking for `range(0, MAX)` and treating MAX+1 rows as "there is more"
  // assumed the server would return that many. With a response cap equal to
  // the page size, 501 stored notes came back as 500 with
  // `olderWithheld: false` -- the omission this flag exists to disclose,
  // undisclosed. An exact count cannot be capped away.
  const counted = await clientFor(deps)
    .from('admin_support_notes')
    .select('id', { count: 'exact', head: true })
    .eq('case_id', caseId);
  if (counted.error) {
    console.error('[admin] admin_support_notes count failed:', counted.error.message);
    throw new AdminDataError('support note list failed');
  }

  const { data, error } = await clientFor(deps)
    .from('admin_support_notes')
    .select(SUPPORT_NOTE_COLUMNS)
    .eq('case_id', caseId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(0, MAX_NOTES_PER_CASE - 1);

  if (error) {
    console.error('[admin] admin_support_notes list failed:', error.message);
    throw new AdminDataError('support note list failed');
  }

  const rows = data ?? [];
  const page = rows
    .slice(0, MAX_NOTES_PER_CASE)
    .map((row) => parseSupportNoteRow(row as Record<string, unknown>));
  // Compared against what the READER WILL SEE, not against the raw response.
  // `rows.length` was the wrong side of the comparison: a transport that
  // returned all 501 rows made `501 > 501` false while the page showed 500,
  // so the one case that needed the notice did not get it.
  const olderWithheld = (counted.count ?? 0) > page.length;
  // Back into insertion order for reading.
  return { notes: page.reverse(), olderWithheld };
}

/** One case's notes, in insertion order. The newest page of them. */
export async function listSupportNotes(
  caseId: string,
  deps?: AdminSupportStoreDeps,
): Promise<SupportNoteRow[]> {
  return (await listSupportNotesPage(caseId, deps)).notes;
}

// ─────────────────────────────────────────────────────────────────── writing

export interface SupportCaseInsert {
  shopId: string;
  category: SupportCategory;
  priority: SupportPriority;
  summary: string;
  /** The acting admin, recorded once at insert and immutable thereafter. */
  openedBy: string;
}

/**
 * Opens a case.
 *
 * `status` is left to the column DEFAULT rather than sent: `open` is the
 * database's statement about what a new case is, and sending it from here would
 * create a second place that decides.
 */
export async function insertSupportCase(
  input: SupportCaseInsert,
  deps?: AdminSupportStoreDeps,
): Promise<string> {
  const nowIso = nowFor(deps).toISOString();
  // ROUND 14 FINDING 9: INSERT ... RETURNING id.
  //
  // This returned void, so the opening audit entry had no case id to record --
  // it filed `target: shopId` and no `meta.caseId`, and the case-history
  // reader matches on the case id in both. Every successful opening event
  // therefore failed to appear in the history of the case it opened, which is
  // the one event a case's history most obviously needs.
  const { data, error } = await clientFor(deps)
    .from('admin_support_cases')
    .insert({
      shop_id: input.shopId,
      category: input.category,
      priority: input.priority,
      summary: input.summary,
      opened_by: input.openedBy,
      opened_at: nowIso,
      updated_at: nowIso,
    })
    .select('id')
    .single();

  if (error) {
    console.error('[admin] admin_support_cases insert failed:', error.message);
    throw new AdminDataError('support case write failed');
  }
  const caseId = (data as { id?: unknown } | null)?.id;
  if (typeof caseId !== 'string' || caseId.length === 0) {
    // The row committed but its id did not come back, so the audit entry could
    // not name it. Raising is right: a case nobody can find in the history is
    // worse than a refused open the operator can retry.
    throw new AdminDataError('support case write returned no id');
  }
  return caseId;
}

export interface SupportCaseUpdate {
  caseId: string;
  status: SupportStatus;
  priority: SupportPriority;
  assignee: string | null;
  summary: string;
}

/**
 * Updates exactly the four mutable columns, plus `updated_at`.
 *
 * The column list is the GRANT's list. A future edit adding `shop_id` here
 * would be refused by the database rather than silently reassigning a case —
 * but it would be refused at RUNTIME, so the list is written out once and kept
 * narrow here too.
 */
export async function updateSupportCase(
  input: SupportCaseUpdate,
  deps?: AdminSupportStoreDeps,
): Promise<void> {
  if (input.caseId.length === 0) {
    throw new AdminDataError('a support case update needs a case id');
  }

  const { error } = await clientFor(deps)
    .from('admin_support_cases')
    .update({
      status: input.status,
      priority: input.priority,
      assignee: input.assignee,
      summary: input.summary,
      updated_at: nowFor(deps).toISOString(),
    })
    .eq('id', input.caseId);

  if (error) {
    console.error('[admin] admin_support_cases update failed:', error.message);
    throw new AdminDataError('support case write failed');
  }
}

export interface SupportNoteInsert {
  caseId: string;
  body: string;
  author: string;
}

/**
 * Appends a note. INSERT only — there is no update or delete counterpart here,
 * and the grant would refuse one.
 *
 * The case's `updated_at` is NOT touched. A note records what somebody said;
 * bumping the case would make the queue's "newest activity" ordering move for a
 * reason the case itself did not change. The update grant does cover
 * `updated_at`, so such a write would succeed — which is precisely why not
 * making it has to be a deliberate decision rather than an omission.
 */
export async function insertSupportNote(
  input: SupportNoteInsert,
  deps?: AdminSupportStoreDeps,
): Promise<void> {
  const { error } = await clientFor(deps).from('admin_support_notes').insert({
    case_id: input.caseId,
    body: input.body,
    author: input.author,
    created_at: nowFor(deps).toISOString(),
  });

  if (error) {
    console.error('[admin] admin_support_notes insert failed:', error.message);
    throw new AdminDataError('support note write failed');
  }
}
