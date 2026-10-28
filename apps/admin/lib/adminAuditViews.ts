// Batch 3 §8.9a — filtering, searching and paging the admin audit, pure.
//
// THE ENTRIES ARRIVE AS AN ARRAY, not as a query, and that is a property of the
// source rather than a shortcut: §8.9's durable sink is the Postgres table
// migration 35 adds, which is NOT YET APPLIED to any hosted project, so the
// view this page can honestly offer today is over the in-memory ring buffer and
// the stderr record. Filtering an array is therefore the correct shape, and
// when the table is applied these same predicates become the thing a query
// test compares against.
//
// EVERY FILTER IS AN EXACT, PREFIX OR CONTAINS MATCH ON ALREADY-REDACTED TEXT.
// The entries have passed lib/adminAudit.ts's allowlist and scrubbers before
// they reach the ring, so nothing here can widen what a meta value exposes —
// this module only chooses which recorded lines to show.

import type { AdminAuditEntry } from './adminAudit';

/** The three outcomes lib/adminAudit.ts records. */
export const AUDIT_OUTCOMES = Object.freeze(['success', 'failure', 'denied'] as const);

export interface AuditFilter {
  actor?: string;
  action?: string;
  outcome?: string;
  /** Inclusive Dhaka day bounds, `YYYY-MM-DD`. */
  from?: string;
  to?: string;
  /** Free text over the actor, role, action, target and the meta pairs. */
  search?: string;
}

const DHAKA_OFFSET_MS = 6 * 60 * 60_000;

function padTwo(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * The Dhaka day an entry belongs to.
 *
 * The same fixed-offset arithmetic the rest of the platform uses. A date
 * filter compared against the raw UTC timestamp would put six hours of every
 * Dhaka day on the wrong side of the bound — so "everything on the 25th" would
 * quietly omit the evening.
 */
export function auditDhakaDay(entry: Pick<AdminAuditEntry, 'at'>): string | null {
  const parsed = Date.parse(entry.at);
  if (!Number.isFinite(parsed)) return null;
  const shifted = new Date(parsed + DHAKA_OFFSET_MS);
  return (
    shifted.getUTCFullYear()
    + '-'
    + padTwo(shifted.getUTCMonth() + 1)
    + '-'
    + padTwo(shifted.getUTCDate())
  );
}

/** The haystack a free-text search runs over, lowercased once per entry. */
function searchableText(entry: AdminAuditEntry): string {
  const metaParts: string[] = [];
  for (const [key, value] of Object.entries(entry.meta)) {
    metaParts.push(key, String(value));
  }
  return [entry.actor, entry.role ?? '', entry.action, entry.target ?? '', ...metaParts]
    .join(' ')
    .toLowerCase();
}

/**
 * Entries whose action falls in ANY of several dotted families.
 *
 * GATE 5 DELTA FINDING 7. The Admins page used to call `filterAuditEntries`
 * once per prefix and concatenate the results, which can return the same
 * entry more than once if two prefixes ever overlap — so it then
 * de-duplicated on `at + actor + action`. That key is not an identity: two
 * revocations of DIFFERENT targets by the same actor in the same millisecond
 * collapsed into one row, and a DENIED attempt collapsed into the successful
 * one beside it. A security history that silently drops failures is worse
 * than no history.
 *
 * One pass over the entries cannot produce a duplicate, so there is nothing
 * to de-duplicate and no event can be lost. Order is the entries' own.
 */
export function filterAuditEntriesByActionFamilies(
  entries: readonly AdminAuditEntry[],
  prefixes: readonly string[],
): readonly AdminAuditEntry[] {
  // The same PREFIX semantics as `filterAuditEntries`' `action`, stated once.
  return entries.filter((entry) => prefixes.some((prefix) => entry.action.startsWith(prefix)));
}

/**
 * The §8.9a filters: actor, action, outcome, date range and free text.
 *
 * `actor` and `outcome` are EXACT matches, because both come from a select
 * whose options are built from the entries themselves — a contains match there
 * would make "ops" also select "ops2". `action` is a PREFIX match, because the
 * action names are dotted namespaces (`authz.denied`, `settings.updated`) and
 * an operator filtering on `settings.` means the whole family.
 *
 * A blank value is NOT a filter. Without that, a form that submits every one of
 * its fields would filter on the empty string and show nothing.
 */
export function filterAuditEntries(
  entries: readonly AdminAuditEntry[],
  filter: AuditFilter,
): readonly AdminAuditEntry[] {
  const actor = filter.actor?.trim() ?? '';
  const action = filter.action?.trim() ?? '';
  const outcome = filter.outcome?.trim() ?? '';
  const search = filter.search?.trim().toLowerCase() ?? '';
  const from = filter.from?.trim() ?? '';
  const to = filter.to?.trim() ?? '';

  return entries.filter((entry) => {
    if (actor.length > 0 && entry.actor !== actor) return false;
    if (outcome.length > 0 && entry.outcome !== outcome) return false;
    if (action.length > 0 && !entry.action.startsWith(action)) return false;

    if (from.length > 0 || to.length > 0) {
      const day = auditDhakaDay(entry);
      // An entry whose timestamp will not parse is EXCLUDED by a date filter
      // rather than included: "show me the 25th" must not return a line that
      // has no date at all. With no date filter it is still listed, so it is
      // never invisible.
      if (day === null) return false;
      if (from.length > 0 && day < from) return false;
      if (to.length > 0 && day > to) return false;
    }

    if (search.length > 0 && !searchableText(entry).includes(search)) return false;
    return true;
  });
}

/** The distinct actors present, for the filter's options. */
export function auditActors(entries: readonly AdminAuditEntry[]): readonly string[] {
  return [...new Set(entries.map((entry) => entry.actor))].sort();
}

/**
 * The distinct action NAMESPACES present — the part up to the first dot.
 *
 * A namespace rather than every action name: the list is what an operator picks
 * from, and twenty near-identical `settings.*` entries in a select is a worse
 * control than one `settings.` option that selects the family.
 */
export function auditActionNamespaces(entries: readonly AdminAuditEntry[]): readonly string[] {
  const namespaces = new Set<string>();
  for (const entry of entries) {
    const dot = entry.action.indexOf('.');
    namespaces.add(dot > 0 ? entry.action.slice(0, dot + 1) : entry.action);
  }
  return [...namespaces].sort();
}

export interface AuditSlice {
  entries: readonly AdminAuditEntry[];
  total: number;
}

/**
 * One page of entries, with the exact total of the FILTERED set.
 *
 * The total is taken from the filtered array and not from the ring's length,
 * for the §8.2 reason: a pager reporting a total the list does not match is a
 * figure an operator reads as a fact and is wrong.
 */
export function sliceAuditEntries(
  entries: readonly AdminAuditEntry[],
  from: number,
  to: number,
): AuditSlice {
  return { entries: entries.slice(from, to + 1), total: entries.length };
}

/** How the detail column renders an entry's redacted meta. */
export function formatAuditMeta(entry: AdminAuditEntry): string {
  const pairs = Object.entries(entry.meta);
  if (pairs.length === 0) return '—';
  return pairs.map(([key, value]) => key + '=' + String(value)).join(' ');
}
