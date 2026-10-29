import { beforeEach, describe, expect, test, vi } from 'vitest';

const cookieStore = vi.hoisted(() => ({ value: undefined as string | undefined }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => cookieStore.value ? { value: cookieStore.value } : undefined }),
}));

const { newSessionPayload, signAdminSession } = await import('./adminSession');
const { addSupportNote, openSupportCase } = await import('./adminSupportActions');
const { outcomeFor } = await import('./adminOutcomes');

const SECRET = 'a'.repeat(32);
const CASE = '7b000000-0000-4000-8000-000000000001';
const OTHER_CASE = '7b000000-0000-4000-8000-000000000002';
const SHOP = '7b000000-0000-4000-8000-000000000003';
const OTHER_SHOP = '7b000000-0000-4000-8000-000000000004';
const NOTE = '7b000000-0000-4000-8000-000000000005';
const OTHER_NOTE = '7b000000-0000-4000-8000-000000000006';
const NOW = new Date('2026-10-29T06:00:00.000Z');

type Row = Record<string, unknown>;

function caseRow(id = CASE): Row {
  return {
    id, shop_id: SHOP, category: 'sync', priority: 'normal', status: 'open',
    assignee: null, summary: 'Sync stalled', opened_by: 'support-a',
    opened_at: NOW.toISOString(), updated_at: NOW.toISOString(),
  };
}

function store() {
  const tables = new Map<string, Map<string, Row>>([
    ['admin_support_cases', new Map([[CASE, caseRow()], [OTHER_CASE, caseRow(OTHER_CASE)]])],
    ['admin_support_notes', new Map()],
  ]);
  const calls: { table: string; op: string; row?: Row }[] = [];
  const client = {
    from(table: string) {
      const rows = tables.get(table);
      if (!rows) throw new Error('unexpected table: ' + table);
      return {
        insert(row: Row) {
          calls.push({ table, op: 'insert', row });
          const id = String(row.id);
          if (rows.has(id)) return Promise.resolve({ data: null, error: { code: '23505' } });
          rows.set(id, { status: 'open', assignee: null, ...row });
          return Promise.resolve({ data: null, error: null });
        },
        select() {
          calls.push({ table, op: 'select' });
          let id: string | undefined;
          const builder = {
            eq(column: string, value: string) {
              if (column !== 'id') throw new Error('unexpected lookup');
              id = value;
              return builder;
            },
            limit() {
              return Promise.resolve({ data: id && rows.has(id) ? [rows.get(id)] : [], error: null });
            },
          };
          return builder;
        },
      };
    },
  };
  return { client: client as never, tables, calls };
}

async function signIn(username = 'support-a') {
  cookieStore.value = await signAdminSession(
    newSessionPayload({ sub: username, role: 'support', epoch: 0, now: Date.now() }), SECRET,
  );
}

function deps(client: never, auditFails = false) {
  return {
    client,
    env: { ADMIN_SESSION_SECRET: SECRET, ADMIN_ROLES: JSON.stringify({ 'support-a': 'support', 'support-b': 'support' }) },
    now: () => NOW,
    readAssignment: async () => null,
    sinks: [{ write() {}, async flush() { if (auditFails) throw new Error('audit unavailable'); } }],
  };
}

beforeEach(async () => { await signIn(); });

describe('support write replay protection', () => {
  const note = { requestId: NOTE, caseId: CASE, body: 'Called owner.' };
  const newCase = { requestId: NOTE, shopId: SHOP, category: 'sync', priority: 'normal', summary: 'Sync stalled' };

  test('concurrent first submissions insert only one note and one case', async () => {
    const { client, tables } = store();
    const results = await Promise.all([
      addSupportNote(note, deps(client)), addSupportNote(note, deps(client)),
      openSupportCase(newCase, deps(client)), openSupportCase(newCase, deps(client)),
    ]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(tables.get('admin_support_notes')?.size).toBe(1);
    expect(tables.get('admin_support_cases')?.size).toBe(3);
  });

  test('replaying an applied-but-unrecorded note appends once, including concurrent retries', async () => {
    const { client, tables } = store();
    const first = await addSupportNote(note, deps(client, true));
    expect(outcomeFor(first)).toBe('applied_unrecorded');
    const retries = await Promise.all([
      addSupportNote(note, deps(client, true)),
      addSupportNote(note, deps(client, true)),
    ]);
    expect(retries.every((result) => outcomeFor(result) === 'applied_unrecorded')).toBe(true);
    expect(tables.get('admin_support_notes')?.size).toBe(1);
    expect(await addSupportNote(note, deps(client))).toMatchObject({ ok: true });
    expect(tables.get('admin_support_notes')?.size).toBe(1);
  });

  test('the same protection covers case creation and its audit recovery', async () => {
    const { client, tables } = store();
    expect(outcomeFor(await openSupportCase(newCase, deps(client, true)))).toBe('applied_unrecorded');
    const retry = await openSupportCase(newCase, deps(client));
    expect(retry).toMatchObject({ ok: true });
    expect(tables.get('admin_support_cases')?.size).toBe(3);
    expect(tables.get('admin_support_cases')?.get(NOTE)).toMatchObject({ shop_id: SHOP, opened_by: 'support-a' });
  });

  test.each([
    { body: 'Different note.' },
    { caseId: OTHER_CASE },
  ])('a note request id cannot be reused with changed payload: %j', async (changed) => {
    const { client, tables } = store();
    await addSupportNote(note, deps(client));
    expect(await addSupportNote({ ...note, ...changed }, deps(client))).toMatchObject({ ok: false });
    expect(tables.get('admin_support_notes')?.size).toBe(1);
    expect(tables.get('admin_support_notes')?.get(NOTE)?.body).toBe(note.body);
  });

  test('a different admin cannot claim another admin\'s note replay', async () => {
    const { client } = store();
    await addSupportNote(note, deps(client));
    await signIn('support-b');
    expect(await addSupportNote(note, deps(client))).toMatchObject({ ok: false });
  });

  test.each([
    { shopId: OTHER_SHOP }, { category: 'payment' }, { priority: 'high' }, { summary: 'Changed summary' },
  ])('a case request id cannot be reused with changed payload: %j', async (changed) => {
    const { client, tables } = store();
    await openSupportCase(newCase, deps(client));
    expect(await openSupportCase({ ...newCase, ...changed }, deps(client))).toMatchObject({ ok: false });
    expect(tables.get('admin_support_cases')?.size).toBe(3);
  });

  test('a different admin cannot claim another admin\'s case replay', async () => {
    const { client } = store();
    await openSupportCase(newCase, deps(client));
    await signIn('support-b');
    expect(await openSupportCase(newCase, deps(client))).toMatchObject({ ok: false });
  });

  test('a fresh request id permits intentionally repeating the same note text', async () => {
    const { client, tables } = store();
    await addSupportNote(note, deps(client));
    await addSupportNote({ ...note, requestId: OTHER_NOTE }, deps(client));
    expect(tables.get('admin_support_notes')?.size).toBe(2);
  });

  test.each([undefined, '', 'not-a-uuid'])('missing or malformed request id %j reaches no table', async (requestId) => {
    const { client, calls } = store();
    expect(await addSupportNote({ ...note, requestId }, deps(client))).toMatchObject({ ok: false });
    expect(await openSupportCase({ ...newCase, requestId }, deps(client))).toMatchObject({ ok: false });
    expect(calls).toEqual([]);
  });
});
