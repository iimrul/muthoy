import * as bcrypt from 'npm:bcryptjs@3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Caller } from './_shared/auth.ts';

// Migration 43 — the owner changes their PIN once, for every shop they run.
// Real bcrypt (the npm:bcryptjs@3 alias), a table double for PostgREST.

const OWNER_PIN = '4821';
const NEW_PIN = '7390';
const STAFF_PIN = '1357';

const db = vi.hoisted(() => ({
  users: [] as Record<string, unknown>[],
  memberships: [] as Record<string, unknown>[],
  rpc: vi.fn(),
  reads: [] as string[],
  allowed: true,
  record: null as Record<string, unknown> | null,
}));

function table(name: string) {
  db.reads.push(name);
  const filters: Array<(row: Record<string, unknown>) => boolean> = [];
  const rows = () => (name === 'users' ? db.users : db.memberships).filter((row) => filters.every((f) => f(row)));
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: (column: string, value: unknown) => { filters.push((row) => row[column] === value); return builder; },
    not: (column: string, _op: string, _value: unknown) => { filters.push((row) => row[column] !== null); return builder; },
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    then: (resolve: (value: unknown) => unknown) => resolve({ data: rows(), error: null }),
  };
  return builder;
}

vi.mock('./_shared/supabaseAdmin.ts', () => ({
  supabaseAdmin: { from: (name: string) => table(name), rpc: db.rpc },
}));
vi.mock('./_shared/auth.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./_shared/auth.ts')>()),
  assertCallerCurrent: async () => db.record,
}));

const { ownerPinChange } = await import('./ownerPin.ts');

const caller = {
  authUserId: 'auth-1', appUserId: 'owner-a', principalUserId: 'owner-a', shopId: 'shop-a',
  role: 'owner', permissionVersion: 1, raw: { app_metadata: {} },
} as unknown as Caller;

function rpcCalls(name: string) {
  return db.rpc.mock.calls.filter(([called]) => called === name).map(([, args]) => args as Record<string, unknown>);
}

beforeEach(() => {
  vi.clearAllMocks();
  db.reads = [];
  db.allowed = true;
  db.record = { appUserId: 'owner-a', shopId: 'shop-a', isOwner: true };
  const ownerHash = bcrypt.hashSync(OWNER_PIN, 4);
  db.users = [
    { id: 'owner-a', shop_id: 'shop-a', is_active: true, is_deleted: false, pin_hash: ownerHash, pin_set_at: 't0' },
    { id: 'owner-b', shop_id: 'shop-b', is_active: true, is_deleted: false, pin_hash: ownerHash, pin_set_at: 't0' },
    { id: 'staff-b', shop_id: 'shop-b', is_active: true, is_deleted: false, pin_hash: bcrypt.hashSync(STAFF_PIN, 4), pin_set_at: 't0' },
  ];
  db.memberships = [
    { principal_user_id: 'owner-a', shop_id: 'shop-a', actor_user_id: 'owner-a', role: 'owner', is_active: true },
    { principal_user_id: 'owner-a', shop_id: 'shop-b', actor_user_id: 'owner-b', role: 'owner', is_active: true },
  ];
  db.rpc.mockImplementation(async (name: string) => {
    if (name === 'a23_reserve_attempts') return { data: { allowed: db.allowed }, error: null };
    if (name === 'owner_set_pin_all_shops') {
      return { data: { pinSetAt: '2026-11-23T12:00:00Z', actorUserIds: ['owner-a', 'owner-b'] }, error: null };
    }
    return { data: null, error: null };
  });
});

describe('owner-pin-change (migration 43)', () => {
  it('writes the new PIN to every owner actor through the RPC, as a bcrypt hash only', async () => {
    const result = await ownerPinChange(caller, { currentPin: OWNER_PIN, newPin: NEW_PIN }, '203.0.113.9');
    expect(result).toEqual({ pinSetAt: '2026-11-23T12:00:00Z', actorUserIds: ['owner-a', 'owner-b'] });
    const [write] = rpcCalls('owner_set_pin_all_shops');
    expect(write?.p_principal_user_id).toBe('owner-a');
    const hash = String(write?.p_pin_hash);
    expect(hash).toMatch(/^\$2[aby]\$10\$/);
    expect(bcrypt.compareSync(NEW_PIN, hash)).toBe(true);
    // The proven owner's budget is refunded; the per-IP abuse budget is not.
    expect(rpcCalls('clear_login_failures')).toEqual([{ p_key: 'owner-pin:owner-a' }]);
  });

  it('refuses a wrong current PIN and writes nothing', async () => {
    await expect(ownerPinChange(caller, { currentPin: '0000', newPin: NEW_PIN }))
      .rejects.toMatchObject({ status: 401, code: 'owner_pin_refused' });
    expect(rpcCalls('owner_set_pin_all_shops')).toHaveLength(0);
    expect(rpcCalls('clear_login_failures')).toHaveLength(0);
  });

  it('refuses a PIN a staff member already holds in ANOTHER of the owner\'s shops', async () => {
    await expect(ownerPinChange(caller, { currentPin: OWNER_PIN, newPin: STAFF_PIN }))
      .rejects.toMatchObject({ status: 409, code: 'pin_in_use' });
    expect(rpcCalls('owner_set_pin_all_shops')).toHaveLength(0);
  });

  it('does not count the owner\'s own actors as a collision', async () => {
    // Re-setting the current PIN collides with nobody but the owner's own rows.
    await expect(ownerPinChange(caller, { currentPin: OWNER_PIN, newPin: OWNER_PIN })).resolves.toBeTruthy();
  });

  it('stops before reading any PIN hash once the attempt budget is spent', async () => {
    db.allowed = false;
    await expect(ownerPinChange(caller, { currentPin: OWNER_PIN, newPin: NEW_PIN }))
      .rejects.toMatchObject({ status: 429, code: 'owner_pin_rate_limited' });
    // No hash read means no bcrypt compare: the limiter fronts the oracle.
    expect(db.reads).toEqual([]);
    expect(rpcCalls('owner_set_pin_all_shops')).toHaveLength(0);
  });

  it('is owner-only and rejects a malformed request before reading anything', async () => {
    db.record = { appUserId: 'staff-b', shopId: 'shop-b', isOwner: false };
    await expect(ownerPinChange(caller, { currentPin: OWNER_PIN, newPin: NEW_PIN }))
      .rejects.toMatchObject({ status: 403 });
    for (const body of [{}, { currentPin: '12', newPin: NEW_PIN }, { currentPin: OWNER_PIN, newPin: 'abcd' }]) {
      await expect(ownerPinChange(caller, body)).rejects.toMatchObject({ status: 400 });
    }
    expect(rpcCalls('a23_reserve_attempts')).toHaveLength(0);
  });
});
