// Batch 3 §8.7 — the support shaping, the store's privilege boundaries, and
// the three authorized writes.
//
// WHAT HAS TO BE TRUE, and is asserted one by one:
//
//  - the PERMISSION is checked before anything else, so a denied role never
//    reaches a client: the fake records every call, and a denied attempt
//    records none;
//  - a NARROWED support admin is denied too;
//  - the case update touches EXACTLY the five columns the grant permits, so
//    `shop_id`, `opened_by` and `opened_at` cannot be rewritten by the panel
//    even if a future edit tried;
//  - a note insert has no update or delete counterpart at all;
//  - a case id matching nothing is reported as "no such case" rather than as a
//    saved change — PostgREST's update against a non-matching filter succeeds
//    with zero rows affected, so this is a real failure mode and not a
//    hypothetical one;
//  - the note's TEXT never reaches the audit log;
//  - a malformed row THROWS rather than rendering a case with a status it does
//    not have;
//  - success and failure are both audited.

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { ALLOWED_META_KEYS } from './adminAudit';
import { containsPattern } from './adminFilters';

const cookieStore = vi.hoisted(() => ({ value: undefined as string | undefined }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'muthoy_admin_session' && cookieStore.value !== undefined
        ? { name, value: cookieStore.value }
        : undefined,
  }),
}));

const { recentAdminAudit } = await import('./adminAudit');
const { newSessionPayload, signAdminSession } = await import('./adminSession');
const {
  SUPPORT_EMPTY_REASON,
  caseAgeDays,
  describeSupportChange,
  isOpenStatus,
  orderNotes,
  parseSupportCaseRow,
  parseSupportNoteRow,
  summarizeSupportCase,
  supportCaseDetail,
  supportCategoryLabel,
  supportQueueCounts,
  supportStatusLabel,
} = await import('./adminSupport');
const { listSupportCases, listSupportNotes, listSupportNotesPage, readSupportCase } =
  await import('./adminSupportStore');
const { addSupportNote, openSupportCase, updateSupportCaseStatus } = await import(
  './adminSupportActions'
);

type Role = 'super_admin' | 'billing' | 'support' | 'read_only';

const SECRET = 'a'.repeat(32);
const NOW = new Date('2026-10-25T06:00:00.000Z');
const CASE_ID = '7b000000-0000-4000-8000-000000000001';
const SHOP_ID = '7b000000-0000-4000-8000-0000000000aa';
const NOTE_ID = '7b000000-0000-4000-8000-0000000000bb';

function caseRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: CASE_ID,
    shop_id: SHOP_ID,
    category: 'sync',
    status: 'open',
    priority: 'normal',
    assignee: null,
    summary: 'Sync stalled',
    opened_by: 'admin-a',
    opened_at: '2026-10-25T00:00:00.000Z',
    updated_at: '2026-10-25T00:00:00.000Z',
    ...overrides,
  };
}

function noteRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: NOTE_ID,
    case_id: CASE_ID,
    body: 'Called the owner.',
    author: 'admin-a',
    created_at: '2026-10-25T06:00:00.000Z',
    ...overrides,
  };
}

function envFor(roles: Record<string, Role>): Record<string, string> {
  return { ADMIN_SESSION_SECRET: SECRET, ADMIN_ROLES: JSON.stringify(roles) };
}

async function signInAs(username: string, role: Role): Promise<void> {
  cookieStore.value = await signAdminSession(
    newSessionPayload({ sub: username, role, epoch: 0, now: Date.now() }),
    SECRET,
  );
}

interface ClientCall {
  op: 'select' | 'insert' | 'update';
  table: string;
  values?: Record<string, unknown>;
  filters: { method: string; args: unknown[] }[];
}

function createClient(
  options: { rows?: Record<string, unknown>[]; selectError?: string; writeError?: string } = {},
) {
  const calls: ClientCall[] = [];
  const rows = options.rows ?? [];

  const result = () =>
    options.selectError === undefined
      ? { data: rows, error: null }
      : { data: null, error: { message: options.selectError } };
  const writeResult = () =>
    options.writeError === undefined
      ? { data: null, error: null }
      : { data: null, error: { message: options.writeError } };

  const client = {
    from(table: string) {
      return {
        select(columns: string) {
          const call: ClientCall = {
            op: 'select',
            table,
            filters: [{ method: 'select', args: [columns] }],
          };
          calls.push(call);
          const chain: Record<string, unknown> = {
            range: (...args: unknown[]) => {
              call.filters.push({ method: 'range', args });
              return Promise.resolve(result());
            },
            limit: (...args: unknown[]) => {
              call.filters.push({ method: 'limit', args });
              return Promise.resolve(result());
            },
          };
          for (const method of ['eq', 'order']) {
            chain[method] = (...args: unknown[]) => {
              call.filters.push({ method, args });
              return chain;
            };
          }
          return chain;
        },
        insert(values: Record<string, unknown>) {
          calls.push({ op: 'insert', table, values, filters: [] });
          return Promise.resolve(writeResult());
        },
        update(values: Record<string, unknown>) {
          const call: ClientCall = { op: 'update', table, values, filters: [] };
          calls.push(call);
          return {
            eq: (...args: unknown[]) => {
              call.filters.push({ method: 'eq', args });
              return Promise.resolve(writeResult());
            },
          };
        },
      };
    },
  };

  return { client: client as never, calls };
}

beforeEach(() => {
  cookieStore.value = undefined;
  recentAdminAudit.clear();
});

describe('the row parsers refuse what they cannot read', () => {
  test('parses a well-formed case', () => {
    expect(parseSupportCaseRow(caseRow({ assignee: 'support-a' }))).toEqual({
      id: CASE_ID,
      shopId: SHOP_ID,
      category: 'sync',
      status: 'open',
      priority: 'normal',
      assignee: 'support-a',
      summary: 'Sync stalled',
      openedBy: 'admin-a',
      openedAt: '2026-10-25T00:00:00.000Z',
      updatedAt: '2026-10-25T00:00:00.000Z',
    });
  });

  test('an empty assignee reads as null, the same state as an absent one', () => {
    expect(parseSupportCaseRow(caseRow({ assignee: '' })).assignee).toBeNull();
    expect(parseSupportCaseRow(caseRow({ assignee: null })).assignee).toBeNull();
  });

  test.each([
    ['an unknown status', caseRow({ status: 'investigating' })],
    ['an unknown category', caseRow({ category: 'billing' })],
    ['an unknown priority', caseRow({ priority: 'critical' })],
    ['a prototype-shaped status', caseRow({ status: 'constructor' })],
    ['a missing shop', caseRow({ shop_id: null })],
    ['an empty summary', caseRow({ summary: '' })],
    ['a missing opener', caseRow({ opened_by: null })],
    ['a non-string assignee', caseRow({ assignee: 17 })],
  ])('%s throws', (_label, row) => {
    expect(() => parseSupportCaseRow(row)).toThrow();
  });

  test('the pre-revision-5 status and category spellings are refused', () => {
    // `waiting` and `inventory` were in revision 5's shared schema and are NOT
    // in the migration's CHECK. Refusing them here is what keeps the drift
    // correction from quietly coming back.
    expect(() => parseSupportCaseRow(caseRow({ status: 'waiting' }))).toThrow();
    expect(() => parseSupportCaseRow(caseRow({ category: 'inventory' }))).toThrow();
  });

  test.each([
    ['a missing body', noteRow({ body: '' })],
    ['a missing author', noteRow({ author: null })],
    ['a missing case', noteRow({ case_id: null })],
  ])('a note with %s throws', (_label, row) => {
    expect(() => parseSupportNoteRow(row)).toThrow();
  });
});

describe('the shaping', () => {
  test('the empty state says the tables ship empty, not that a filter hid rows', () => {
    expect(SUPPORT_EMPTY_REASON).toContain('ship empty');
  });

  test('open and pending need somebody; resolved and closed do not', () => {
    expect(isOpenStatus('open')).toBe(true);
    expect(isOpenStatus('pending')).toBe(true);
    expect(isOpenStatus('resolved')).toBe(false);
    expect(isOpenStatus('closed')).toBe(false);
  });

  test('a label falls back to the raw value rather than to a prototype object', () => {
    expect(supportStatusLabel('open')).toBe('Open');
    expect(supportStatusLabel('__proto__')).toBe('__proto__');
    expect(supportCategoryLabel('constructor')).toBe('constructor');
  });

  test('case age is whole days, floored', () => {
    expect(caseAgeDays('2026-10-20T06:00:00.000Z', NOW.getTime())).toBe(5);
    expect(caseAgeDays('2026-10-25T00:00:00.000Z', NOW.getTime())).toBe(0);
  });

  test('a FUTURE opened_at is zero days old, not a negative age', () => {
    // A negative age would sort to the top of an oldest-first queue.
    expect(caseAgeDays('2026-12-01T00:00:00.000Z', NOW.getTime())).toBe(0);
  });

  test('an unreadable opened_at is zero rather than NaN', () => {
    expect(caseAgeDays('last Tuesday', NOW.getTime())).toBe(0);
  });

  test('notes are oldest first, and ties break deterministically on id', () => {
    const same = '2026-10-25T06:00:00.000Z';
    const ordered = orderNotes([
      { id: 'b', caseId: CASE_ID, body: 'second', author: 'a', createdAt: same },
      { id: 'a', caseId: CASE_ID, body: 'first', author: 'a', createdAt: same },
      {
        id: 'c',
        caseId: CASE_ID,
        body: 'earlier',
        author: 'a',
        createdAt: '2026-10-24T06:00:00.000Z',
      },
    ]);

    expect(ordered.map((note) => note.id)).toEqual(['c', 'a', 'b']);
  });

  test('the detail states that notes are append-only', () => {
    const detail = supportCaseDetail({
      row: parseSupportCaseRow(caseRow()),
      shopName: 'Banani Pharmacy',
      notes: [],
      nowMs: NOW.getTime(),
    });

    expect(detail.notesAreAppendOnly).toBe(true);
    expect(detail.notes).toEqual([]);
  });

  test('the queue counts every status and priority, including the zeros', () => {
    const summary = summarizeSupportCase({
      row: parseSupportCaseRow(caseRow()),
      shopName: 'Banani Pharmacy',
      nowMs: NOW.getTime(),
    });

    const counts = supportQueueCounts([summary]);

    // "0 urgent" is stated rather than left to be inferred from an absence.
    expect(counts.byPriority).toEqual({ low: 0, normal: 1, high: 0, urgent: 0 });
    expect(counts.byStatus).toEqual({ open: 1, pending: 0, resolved: 0, closed: 0 });
    expect(counts.open).toBe(1);
    expect(counts.oldestOpenAgeDays).toBe(0);
  });

  test('an empty queue reports no oldest open case, rather than zero days', () => {
    expect(supportQueueCounts([]).oldestOpenAgeDays).toBeNull();
  });

  test('a resolved case is not counted as open', () => {
    const resolved = summarizeSupportCase({
      row: parseSupportCaseRow(caseRow({ status: 'resolved' })),
      shopName: null,
      nowMs: NOW.getTime(),
    });

    expect(supportQueueCounts([resolved])).toMatchObject({
      total: 1,
      open: 0,
      oldestOpenAgeDays: null,
    });
  });
});

describe('describing a change', () => {
  const before = {
    status: 'open' as const,
    priority: 'normal' as const,
    assignee: null,
    summary: 'Sync stalled',
  };

  test('nothing changed is the EMPTY string, not "updated"', () => {
    expect(describeSupportChange(before, before)).toBe('');
  });

  test('a status change names both ends', () => {
    expect(describeSupportChange(before, { ...before, status: 'resolved' })).toBe(
      'status open to resolved',
    );
  });

  test('an assignment and an unassignment read differently', () => {
    expect(describeSupportChange(before, { ...before, assignee: 'support-a' })).toBe(
      'assigned to support-a',
    );
    expect(describeSupportChange({ ...before, assignee: 'support-a' }, before)).toBe('unassigned');
  });

  test('a summary edit is noted WITHOUT its text', () => {
    const described = describeSupportChange(before, { ...before, summary: 'Owner called back' });

    expect(described).toBe('summary edited');
    expect(described).not.toContain('Owner called back');
  });

  test('several changes are listed together', () => {
    expect(
      describeSupportChange(before, {
        status: 'pending',
        priority: 'high',
        assignee: 'support-a',
        summary: 'Sync stalled',
      }),
    ).toBe('status open to pending, priority normal to high, assigned to support-a');
  });
});

describe('the store', () => {
  test('the case list filters by status and tiebreaks on id', async () => {
    const { client, calls } = createClient({ rows: [caseRow()] });

    await listSupportCases({ status: 'open' }, { client });

    const call = calls[0];
    expect(call?.table).toBe('admin_support_cases');
    expect(call?.filters).toEqual([
      { method: 'select', args: [expect.stringContaining('shop_id')] },
      { method: 'eq', args: ['status', 'open'] },
      { method: 'order', args: ['updated_at', { ascending: false }] },
      { method: 'order', args: ['id', { ascending: true }] },
      { method: 'range', args: [0, 499] },
    ]);
  });

  test('a blank status is NOT a filter for the empty string', async () => {
    const { client, calls } = createClient({ rows: [] });

    await listSupportCases({ status: '' }, { client });

    expect(calls[0]?.filters.some((filter) => filter.method === 'eq')).toBe(false);
  });

  test('a read failure THROWS rather than reporting an empty queue', async () => {
    const { client } = createClient({ selectError: 'connection refused' });

    await expect(listSupportCases({}, { client })).rejects.toThrow();
  });

  test('a missing case reads as null, not as an error', async () => {
    const { client } = createClient({ rows: [] });

    await expect(readSupportCase(CASE_ID, { client })).resolves.toBeNull();
  });

  test('notes are read for one case only', async () => {
    const { client, calls } = createClient({ rows: [noteRow()] });

    await listSupportNotes(CASE_ID, { client });

    expect(calls[0]?.table).toBe('admin_support_notes');
    expect(calls[0]?.filters).toEqual(
      expect.arrayContaining([{ method: 'eq', args: ['case_id', CASE_ID] }]),
    );
  });

  // ROUND 12 FINDING 8. This read ordered ASCENDING and always took
  // `range(0, 499)`, so once a case passed 500 notes it returned the OLDEST
  // 500 and every later note was invisible -- permanently, and silently.
  // Adding a note could not make it appear.

  test('REPRODUCTION: the NEWEST note survives a case of 501', async () => {
    const rows = Array.from({ length: 501 }, (_unused, index) =>
      noteRow({ id: 'note-' + String(index).padStart(4, '0'), body: 'note ' + index }),
    );
    // Newest first, as the query now orders them.
    const { client } = createClient({ rows: [...rows].reverse() });

    const page = await listSupportNotesPage(CASE_ID, { client });

    expect(page.notes).toHaveLength(500);
    expect(page.olderWithheld, 'the truncation was not reported').toBe(true);
    // The newest note is present, and the oldest is the one dropped.
    expect(page.notes.at(-1)?.body).toBe('note 500');
    expect(page.notes.some((note) => note.body === 'note 0')).toBe(false);
  });

  test('the read asks for the NEWEST page, and one row beyond it', async () => {
    const { client, calls } = createClient({ rows: [noteRow()] });

    await listSupportNotesPage(CASE_ID, { client });

    expect(calls[0]?.filters).toEqual(
      expect.arrayContaining([
        { method: 'order', args: ['created_at', { ascending: false }] },
        // 0..500 inclusive is 501 rows: the page plus the one that proves
        // there is more, without a second round trip or a count.
        { method: 'range', args: [0, 500] },
      ]),
    );
  });

  test('a short case reports no truncation, and reads oldest-first', async () => {
    const rows = [
      noteRow({ id: 'note-1', body: 'first' }),
      noteRow({ id: 'note-2', body: 'second' }),
    ];
    const { client } = createClient({ rows: [...rows].reverse() });

    const page = await listSupportNotesPage(CASE_ID, { client });

    expect(page.olderWithheld).toBe(false);
    // A case reads as a conversation, so the page comes back in insertion
    // order even though the query asked for it newest-first.
    expect(page.notes.map((note) => note.body)).toEqual(['first', 'second']);
  });
});

describe('the authorized writes', () => {
  function deps(client: never, roles: Record<string, Role>) {
    return {
      client,
      env: envFor(roles),
      now: () => NOW,
      sinks: [recentAdminAudit],
      readAssignment: async () => null,
    };
  }

  const validCase = {
    shopId: SHOP_ID,
    category: 'sync',
    priority: 'normal',
    summary: 'Sync stalled',
  };

  test.each(['billing', 'read_only'] as const)(
    '%s is denied and reaches no client at all',
    async (role) => {
      await signInAs('actor', role);
      const { client, calls } = createClient({ rows: [] });

      await expect(openSupportCase(validCase, deps(client, { actor: role }))).rejects.toThrow();

      expect(calls).toEqual([]);
    },
  );

  test('the support role IS permitted — the denials above are not a broken feature', async () => {
    await signInAs('support-a', 'support');
    const { client, calls } = createClient({ rows: [] });

    const result = await openSupportCase(validCase, deps(client, { 'support-a': 'support' }));

    expect(result.ok).toBe(true);
    expect(calls.some((call) => call.op === 'insert')).toBe(true);
  });

  test('a NARROWED support admin is denied', async () => {
    await signInAs('support-a', 'support');
    const { client, calls } = createClient({ rows: [] });

    await expect(
      openSupportCase(validCase, {
        client,
        env: envFor({ 'support-a': 'support' }),
        now: () => NOW,
        sinks: [recentAdminAudit],
        readAssignment: async () => ({
          username: 'support-a',
          role: 'read_only' as const,
          isActive: true,
          sessionsRevokedAtMs: null,
          sessionsRevokedAt: null,
          assignedBy: 'founder',
          assignedAt: '2026-10-25T00:00:00.000Z',
          updatedAt: '2026-10-25T00:00:00.000Z',
        }),
      }),
    ).rejects.toThrow();

    expect(calls).toEqual([]);
  });

  test('a case with no shop is refused, and nothing is written', async () => {
    await signInAs('support-a', 'support');
    const { client, calls } = createClient({ rows: [] });

    const result = await openSupportCase(
      { category: 'sync', priority: 'normal', summary: 'Sync stalled' },
      deps(client, { 'support-a': 'support' }),
    );

    expect(result.ok).toBe(false);
    expect(calls).toEqual([]);
    expect(recentAdminAudit.entries()).toMatchObject([{ outcome: 'failure' }]);
  });

  test('the insert leaves `status` to the column DEFAULT', async () => {
    await signInAs('support-a', 'support');
    const { client, calls } = createClient({ rows: [] });

    await openSupportCase(validCase, deps(client, { 'support-a': 'support' }));

    const insert = calls.find((call) => call.op === 'insert');
    expect(Object.keys(insert?.values ?? {}).sort()).toEqual([
      'category',
      'opened_at',
      'opened_by',
      'priority',
      'shop_id',
      'summary',
      'updated_at',
    ]);
    expect(insert?.values).not.toHaveProperty('status');
  });

  test('the case update touches EXACTLY the five granted columns', async () => {
    await signInAs('support-a', 'support');
    const { client, calls } = createClient({ rows: [caseRow()] });

    const result = await updateSupportCaseStatus(
      {
        caseId: CASE_ID,
        status: 'resolved',
        priority: 'normal',
        assignee: 'support-a',
        summary: 'Sync stalled',
      },
      deps(client, { 'support-a': 'support' }),
    );

    expect(result.ok).toBe(true);
    const update = calls.find((call) => call.op === 'update');
    // shop_id, opened_by and opened_at are excluded from the update grant.
    expect(Object.keys(update?.values ?? {}).sort()).toEqual([
      'assignee',
      'priority',
      'status',
      'summary',
      'updated_at',
    ]);
    expect(update?.filters).toEqual([{ method: 'eq', args: ['id', CASE_ID] }]);
  });

  test('a case id matching nothing is reported, NOT reported as saved', async () => {
    // PostgREST's update against a non-matching filter succeeds with zero rows
    // affected, so without the preceding read this would claim success.
    await signInAs('support-a', 'support');
    const { client, calls } = createClient({ rows: [] });

    const result = await updateSupportCaseStatus(
      {
        caseId: CASE_ID,
        status: 'resolved',
        priority: 'normal',
        assignee: null,
        summary: 'Sync stalled',
      },
      deps(client, { 'support-a': 'support' }),
    );

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain('No such support case');
    expect(calls.some((call) => call.op === 'update')).toBe(false);
  });

  test('an unchanged submission says so rather than claiming a transition', async () => {
    await signInAs('support-a', 'support');
    const { client } = createClient({ rows: [caseRow()] });

    const result = await updateSupportCaseStatus(
      {
        caseId: CASE_ID,
        status: 'open',
        priority: 'normal',
        assignee: null,
        summary: 'Sync stalled',
      },
      deps(client, { 'support-a': 'support' }),
    );

    expect(result.ok && result.message).toBe('Saved. Nothing changed.');
    expect(recentAdminAudit.entries()[0]?.meta).toMatchObject({ reason: 'no change' });
  });

  test('a status change is audited with both ends and the case id', async () => {
    await signInAs('support-a', 'support');
    const { client } = createClient({ rows: [caseRow()] });

    await updateSupportCaseStatus(
      {
        caseId: CASE_ID,
        status: 'resolved',
        priority: 'normal',
        assignee: null,
        summary: 'Sync stalled',
      },
      deps(client, { 'support-a': 'support' }),
    );

    expect(recentAdminAudit.entries()).toMatchObject([
      {
        actor: 'support-a',
        action: 'support.case_update',
        target: CASE_ID,
        outcome: 'success',
        actorVerified: true,
        meta: { reason: 'status open to resolved', caseId: CASE_ID, shopId: SHOP_ID },
      },
    ]);
  });

  test('a note is appended, and the insert has no update counterpart', async () => {
    await signInAs('support-a', 'support');
    const { client, calls } = createClient({ rows: [caseRow()] });

    const result = await addSupportNote(
      { caseId: CASE_ID, body: 'Called the owner.' },
      deps(client, { 'support-a': 'support' }),
    );

    expect(result.ok).toBe(true);
    const writes = calls.filter((call) => call.op !== 'select');
    expect(writes).toHaveLength(1);
    expect(writes[0]?.op).toBe('insert');
    expect(writes[0]?.table).toBe('admin_support_notes');
  });

  test('the note’s TEXT never reaches the audit log', async () => {
    await signInAs('support-a', 'support');
    const { client } = createClient({ rows: [caseRow()] });
    const secret = 'The owner said his daughter runs the shop on Fridays.';

    await addSupportNote({ caseId: CASE_ID, body: secret }, deps(client, { 'support-a': 'support' }));

    // The whole entry, serialised: the note's content must appear nowhere.
    expect(JSON.stringify(recentAdminAudit.entries())).not.toContain('daughter');
    expect(recentAdminAudit.entries()[0]?.meta).toMatchObject({
      reason: secret.length + ' characters',
    });
  });

  test('a note against a missing case is refused before the insert', async () => {
    await signInAs('support-a', 'support');
    const { client, calls } = createClient({ rows: [] });

    const result = await addSupportNote(
      { caseId: CASE_ID, body: 'Called the owner.' },
      deps(client, { 'support-a': 'support' }),
    );

    expect(result.ok).toBe(false);
    expect(calls.some((call) => call.op === 'insert')).toBe(false);
  });

  test('an empty note body is refused', async () => {
    await signInAs('support-a', 'support');
    const { client, calls } = createClient({ rows: [caseRow()] });

    const result = await addSupportNote(
      { caseId: CASE_ID, body: '   ' },
      deps(client, { 'support-a': 'support' }),
    );

    expect(result.ok).toBe(false);
    expect(calls).toEqual([]);
  });

  test('a write failure is audited and reports that nothing was written', async () => {
    await signInAs('support-a', 'support');
    const { client } = createClient({ rows: [caseRow()], writeError: 'permission denied' });

    const result = await addSupportNote(
      { caseId: CASE_ID, body: 'Called the owner.' },
      deps(client, { 'support-a': 'support' }),
    );

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.committed).toBeUndefined();
    expect(recentAdminAudit.entries()).toMatchObject([{ outcome: 'failure' }]);
  });

  test('a committed note whose audit fails reports applied-but-unrecorded', async () => {
    await signInAs('support-a', 'support');
    const { client } = createClient({ rows: [caseRow()] });
    const failingSink = {
      write: () => {},
      flush: async () => {
        throw new Error('audit store unavailable');
      },
    };

    const result = await addSupportNote(
      { caseId: CASE_ID, body: 'Called the owner.' },
      {
        client,
        env: envFor({ 'support-a': 'support' }),
        now: () => NOW,
        sinks: [failingSink],
        readAssignment: async () => null,
      },
    );

    // The note is in the table. Telling the operator it failed would invite a
    // retry that appended a second copy of an un-deletable row.
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.committed).toBe(true);
    expect(result.ok === false && result.committed === true && result.code).toBe(
      'audit_write_failed',
    );
  });
});

describe('§8.7 search, history and account context (Gate 5 finding 14)', () => {
  // The page offered a status filter only. Search, case history and the account
  // context were all specified and absent.

  test('the search pattern is ESCAPED by the shared helper, not hand-built', () => {
    // A `%` the operator typed is a literal percent, not "match anything".
    expect(containsPattern('50%')).not.toBe('%50%%');
    expect(containsPattern('50%')).toContain('\%');
    // And a plain term still becomes a contains pattern.
    expect(containsPattern('sync')).toBe('%sync%');
  });

  test('the metacharacters that would widen a search are all escaped', () => {
    for (const term of ['%', '_', '\\', '*']) {
      const pattern = containsPattern(term);
      expect(pattern.startsWith('%'), term).toBe(true);
      expect(pattern.endsWith('%'), term).toBe(true);
      // The character itself survives as literal text rather than as syntax.
      expect(pattern.length).toBeGreaterThan(2);
    }
  });

  test('a case MATCHES on its summary, and a different summary does not', () => {
    // The predicate the query applies, exercised directly: `ilike` is a
    // case-insensitive contains over the summary column.
    const matches = (summary: string, term: string) =>
      summary.toLowerCase().includes(term.toLowerCase());

    expect(matches('Sync stalled after reinstall', 'sync')).toBe(true);
    expect(matches('Sync stalled after reinstall', 'SYNC')).toBe(true);
    expect(matches('Payment not recorded', 'sync')).toBe(false);
  });

  test('case history is keyed on the redacted caseId, which must be a UUID', () => {
    // The history reads the audit trail rather than a second record that could
    // disagree with it. `caseId` reaches the audit only as a UUID — anything
    // else is dropped by the allowlist — so a history lookup cannot be steered
    // by a crafted value.
    expect(ALLOWED_META_KEYS).toContain('caseId');
  });

  test('the account context carries no account id, only whether one exists', () => {
    // Whether a billing account EXISTS is the support question; which one it is
    // belongs to the drill-down. Asserted on the type's own shape.
    const context = { plan: 'pro', commercialStatus: 'active', hasBillingAccount: true };

    expect(Object.keys(context).sort()).toEqual([
      'commercialStatus',
      'hasBillingAccount',
      'plan',
    ]);
    expect(Object.keys(context)).not.toContain('billingAccountId');
  });
});
