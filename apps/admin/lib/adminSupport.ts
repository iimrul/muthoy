// Batch 3 §8.7 — case and note shaping. PURE.
//
// No Supabase client and no Next import. lib/adminSupportStore.ts reads and
// writes the two tables; lib/adminSupportActions.ts is the authorized surface.
// This file turns rows into what a page renders, and decides nothing about
// authority.
//
// NO SUPPORT HISTORY IS FABRICATED. Both tables ship EMPTY — they are created
// by migration 35 and nothing has ever written to them — so the page's first
// honest state is an empty one that says so. `SUPPORT_EMPTY_REASON` is that
// sentence, kept here rather than in the page so the claim is testable.
//
// A MALFORMED ROW THROWS. Returning a partial case would put a case in front of
// a support admin with a status or a shop it does not really have, and support
// decisions get made on exactly those two fields. The CHECK constraints make
// every rejection below unreachable through the database, which is the reason
// reaching one means the row did not come from that table.
//
// THERE IS NO TRANSITION GRAPH, deliberately. A case legitimately reopens — a
// pharmacy whose sync was "resolved" last week is a pharmacy that can come
// back — and a graph invented here without the founder's actual support
// workflow would refuse real work while proving nothing. What IS enforced is
// that the four statuses are the only four, and that the audit entry
// distinguishes a status change from a priority or assignee edit, so the log
// reads as what happened.

import {
  ADMIN_SUPPORT_CATEGORY_VALUES,
  ADMIN_SUPPORT_PRIORITY_VALUES,
  ADMIN_SUPPORT_STATUS_VALUES,
} from '@muthoy/validation';
import { AdminDataError } from './errors';
import { formatDhakaDate, formatDhakaDateTime } from './adminViews';

export type SupportStatus = (typeof ADMIN_SUPPORT_STATUS_VALUES)[number];
export type SupportPriority = (typeof ADMIN_SUPPORT_PRIORITY_VALUES)[number];
export type SupportCategory = (typeof ADMIN_SUPPORT_CATEGORY_VALUES)[number];

/** What the page says when the tables are empty, which today they always are. */
export const SUPPORT_EMPTY_REASON =
  'No support cases exist. These tables ship empty — no case or note has ever '
  + 'been written — so this is the real state of the product and not a filter '
  + 'hiding rows.';

/** The statuses that mean a case still needs somebody. */
const OPEN_STATUSES: readonly SupportStatus[] = ['open', 'pending'];

export function isOpenStatus(status: string): boolean {
  return (OPEN_STATUSES as readonly string[]).includes(status);
}

export function isSupportStatus(value: unknown): value is SupportStatus {
  return (
    typeof value === 'string'
    && (ADMIN_SUPPORT_STATUS_VALUES as readonly string[]).includes(value)
  );
}

export function isSupportPriority(value: unknown): value is SupportPriority {
  return (
    typeof value === 'string'
    && (ADMIN_SUPPORT_PRIORITY_VALUES as readonly string[]).includes(value)
  );
}

export function isSupportCategory(value: unknown): value is SupportCategory {
  return (
    typeof value === 'string'
    && (ADMIN_SUPPORT_CATEGORY_VALUES as readonly string[]).includes(value)
  );
}

// Maps rather than object literals, for the reason lib/adminGeo.ts uses one: a
// status read off a row is untrusted text, and `({})['__proto__']` is an object
// rather than undefined, so a `?? fallback` over a literal returns a "label"
// that is not a string at all.
const STATUS_LABELS: ReadonlyMap<string, string> = new Map([
  ['open', 'Open'],
  ['pending', 'Pending'],
  ['resolved', 'Resolved'],
  ['closed', 'Closed'],
]);

const PRIORITY_LABELS: ReadonlyMap<string, string> = new Map([
  ['low', 'Low'],
  ['normal', 'Normal'],
  ['high', 'High'],
  ['urgent', 'Urgent'],
]);

const CATEGORY_LABELS: ReadonlyMap<string, string> = new Map([
  ['onboarding', 'Onboarding'],
  ['sync', 'Sync'],
  ['payment', 'Payment'],
  ['data', 'Data'],
  ['device', 'Device'],
  ['account', 'Account'],
  ['other', 'Other'],
]);

export function supportStatusLabel(status: string): string {
  return STATUS_LABELS.get(status) ?? status;
}

export function supportPriorityLabel(priority: string): string {
  return PRIORITY_LABELS.get(priority) ?? priority;
}

export function supportCategoryLabel(category: string): string {
  return CATEGORY_LABELS.get(category) ?? category;
}

// ───────────────────────────────────────────────────────────────────── rows

export interface SupportCaseRow {
  id: string;
  shopId: string;
  category: SupportCategory;
  status: SupportStatus;
  priority: SupportPriority;
  assignee: string | null;
  summary: string;
  openedBy: string;
  openedAt: string;
  updatedAt: string;
}

export interface SupportNoteRow {
  id: string;
  caseId: string;
  body: string;
  author: string;
  createdAt: string;
}

export const SUPPORT_CASE_COLUMNS =
  'id,shop_id,category,status,priority,assignee,summary,opened_by,opened_at,updated_at';

export const SUPPORT_NOTE_COLUMNS = 'id,case_id,body,author,created_at';

function requiredText(row: Record<string, unknown>, table: string, column: string): string {
  const value = row[column];
  if (typeof value !== 'string' || value.length === 0) {
    throw new AdminDataError(table + '.' + column + ' is not readable');
  }
  return value;
}

function optionalText(row: Record<string, unknown>, table: string, column: string): string | null {
  const value = row[column];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw new AdminDataError(table + '.' + column + ' is not readable');
  }
  // An empty assignee column and an absent one are the same state, and the
  // shared schema already turns '' into null on the way in.
  return value.length === 0 ? null : value;
}

export function parseSupportCaseRow(row: Record<string, unknown>): SupportCaseRow {
  const table = 'admin_support_cases';
  const { category, status, priority } = row;

  if (!isSupportCategory(category)) {
    throw new AdminDataError(table + '.category is not a known category');
  }
  if (!isSupportStatus(status)) {
    throw new AdminDataError(table + '.status is not a known status');
  }
  if (!isSupportPriority(priority)) {
    throw new AdminDataError(table + '.priority is not a known priority');
  }

  return {
    id: requiredText(row, table, 'id'),
    // NOT NULL in the table. A case with no shop would render with a blank
    // drill-down link, which reads as a bug rather than as missing data.
    shopId: requiredText(row, table, 'shop_id'),
    category,
    status,
    priority,
    assignee: optionalText(row, table, 'assignee'),
    summary: requiredText(row, table, 'summary'),
    openedBy: requiredText(row, table, 'opened_by'),
    openedAt: requiredText(row, table, 'opened_at'),
    updatedAt: requiredText(row, table, 'updated_at'),
  };
}

export function parseSupportNoteRow(row: Record<string, unknown>): SupportNoteRow {
  const table = 'admin_support_notes';
  return {
    id: requiredText(row, table, 'id'),
    caseId: requiredText(row, table, 'case_id'),
    body: requiredText(row, table, 'body'),
    author: requiredText(row, table, 'author'),
    createdAt: requiredText(row, table, 'created_at'),
  };
}

// ──────────────────────────────────────────────────────────────────── views

export interface SupportCaseSummary extends SupportCaseRow {
  /** The shop's name, or null when the shop could not be read. */
  shopName: string | null;
  statusLabel: string;
  priorityLabel: string;
  categoryLabel: string;
  openedOn: string;
  lastUpdated: string;
  isOpen: boolean;
  /** Whole days since the case was opened, for the "oldest open case" figure. */
  ageDays: number;
}

/**
 * Whole days, floored, and never negative.
 *
 * An `openedAt` in the future is clock skew, not a case from tomorrow, so it
 * reads as zero days old rather than as a negative age that would sort to the
 * top of an "oldest first" list.
 */
export function caseAgeDays(openedAt: string, nowMs: number): number {
  const opened = Date.parse(openedAt);
  if (!Number.isFinite(opened)) return 0;
  return Math.max(0, Math.floor((nowMs - opened) / 86_400_000));
}

export function summarizeSupportCase(input: {
  row: SupportCaseRow;
  shopName: string | null;
  nowMs: number;
}): SupportCaseSummary {
  return {
    ...input.row,
    shopName: input.shopName,
    statusLabel: supportStatusLabel(input.row.status),
    priorityLabel: supportPriorityLabel(input.row.priority),
    categoryLabel: supportCategoryLabel(input.row.category),
    openedOn: formatDhakaDate(input.row.openedAt),
    lastUpdated: formatDhakaDateTime(input.row.updatedAt),
    isOpen: isOpenStatus(input.row.status),
    ageDays: caseAgeDays(input.row.openedAt, input.nowMs),
  };
}

export interface SupportNoteView extends SupportNoteRow {
  writtenAt: string;
}

/**
 * Notes oldest first, which is the order the conversation happened in.
 *
 * Ties break on id so the order is deterministic: two notes written in the same
 * millisecond must not swap places between renders, because a reader would take
 * the swap for an edit.
 */
export function orderNotes(notes: readonly SupportNoteRow[]): readonly SupportNoteView[] {
  return [...notes]
    .sort((left, right) => {
      const byTime = Date.parse(left.createdAt) - Date.parse(right.createdAt);
      if (Number.isFinite(byTime) && byTime !== 0) return byTime;
      return left.id.localeCompare(right.id);
    })
    .map((note) => ({ ...note, writtenAt: formatDhakaDateTime(note.createdAt) }));
}

export interface SupportCaseDetail {
  case: SupportCaseSummary;
  notes: readonly SupportNoteView[];
  /** Append-only by PRIVILEGE: the table grants insert and nothing else. */
  notesAreAppendOnly: true;
  /**
   * TRUE when older notes exist beyond the page that was read.
   *
   * ROUND 13 FINDING 6. The store reported this and the loader dropped it, so
   * a 501-note case rendered "Notes (500) · append-only" with the oldest note
   * silently absent. An operator reading a case history has to be able to tell
   * a complete one from a partial one.
   */
  olderNotesWithheld: boolean;
}

export function supportCaseDetail(input: {
  row: SupportCaseRow;
  shopName: string | null;
  notes: readonly SupportNoteRow[];
  /** Defaults to false, so an existing caller cannot silently claim complete. */
  olderNotesWithheld?: boolean;
  nowMs: number;
}): SupportCaseDetail {
  return {
    case: summarizeSupportCase({ row: input.row, shopName: input.shopName, nowMs: input.nowMs }),
    notes: orderNotes(input.notes),
    notesAreAppendOnly: true,
    olderNotesWithheld: input.olderNotesWithheld ?? false,
  };
}

export interface SupportQueueCounts {
  total: number;
  open: number;
  byStatus: Readonly<Record<string, number>>;
  byPriority: Readonly<Record<string, number>>;
  /** The age of the oldest OPEN case, or null when none is open. */
  oldestOpenAgeDays: number | null;
}

/**
 * The queue's shape, for the page header.
 *
 * Every status and every priority appears with a zero rather than only the ones
 * present, so the header does not change shape as cases arrive — and so "0
 * urgent" is stated rather than left to be inferred from an absence.
 */
export function supportQueueCounts(cases: readonly SupportCaseSummary[]): SupportQueueCounts {
  const byStatus: Record<string, number> = {};
  for (const status of ADMIN_SUPPORT_STATUS_VALUES) byStatus[status] = 0;
  const byPriority: Record<string, number> = {};
  for (const priority of ADMIN_SUPPORT_PRIORITY_VALUES) byPriority[priority] = 0;

  let open = 0;
  let oldestOpenAgeDays: number | null = null;

  for (const entry of cases) {
    byStatus[entry.status] = (byStatus[entry.status] ?? 0) + 1;
    byPriority[entry.priority] = (byPriority[entry.priority] ?? 0) + 1;
    if (!entry.isOpen) continue;
    open += 1;
    if (oldestOpenAgeDays === null || entry.ageDays > oldestOpenAgeDays) {
      oldestOpenAgeDays = entry.ageDays;
    }
  }

  return { total: cases.length, open, byStatus, byPriority, oldestOpenAgeDays };
}

/**
 * What changed, for the audit entry's reason.
 *
 * A status change and a priority edit are different events, and an entry
 * reading "updated" for both makes the log unreadable at exactly the moment
 * somebody is asking who closed a case. Returns the empty string when nothing
 * changed, so the caller can say so rather than claim a transition.
 */
export function describeSupportChange(
  before: Pick<SupportCaseRow, 'status' | 'priority' | 'assignee' | 'summary'>,
  after: Pick<SupportCaseRow, 'status' | 'priority' | 'assignee' | 'summary'>,
): string {
  const parts: string[] = [];
  if (before.status !== after.status) {
    parts.push('status ' + before.status + ' to ' + after.status);
  }
  if (before.priority !== after.priority) {
    parts.push('priority ' + before.priority + ' to ' + after.priority);
  }
  if (before.assignee !== after.assignee) {
    parts.push(after.assignee === null ? 'unassigned' : 'assigned to ' + after.assignee);
  }
  // The summary's TEXT is not recorded: §8.9's redaction allowlist has no key
  // for free text, and a support summary can carry a pharmacy's details.
  if (before.summary !== after.summary) parts.push('summary edited');
  return parts.join(', ');
}
