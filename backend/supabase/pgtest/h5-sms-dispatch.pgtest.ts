import { createHmac, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSendSmsHandler } from '../functions/auth-send-sms/handler.ts';
import { type RpcCaller, rpcDispatchLedger } from '../functions/auth-send-sms/ledger.ts';
import type { FetchLike } from '../functions/auth-send-sms/reve.ts';
import {
  createBareHarness,
  createHarness,
  type Harness,
  HOSTED_FUNCTION_EXECUTE_MODEL,
  migrationFiles,
  migrationSql,
} from './harness';

// H-5 against a REAL Postgres: the Send SMS hook's dispatch ledger.
//
// REVE has no request id, so a second provider call for the same code is a
// second SMS and a second charge. Everything here is about the ledger being
// the one thing that refuses that call — and about it never holding a phone
// number or a code while it does.
//
// What is deliberately proven:
//
//   - an exact replay of one hook request never reaches the provider twice;
//   - a GoTrue retry (NEW webhook id, same number and code) is the same send,
//     but only inside the code's own five-minute lifetime;
//   - a rejected or unconfirmable outcome is replayed, never retried;
//   - one number gets at most ten provider calls a day, whatever they cost,
//     and a DEV cap can lower that ceiling but never raise it;
//   - rotating SMS_DISPATCH_HASH_KEY neither resets the cap nor reopens a
//     duplicate — and a rotation done early or half-way stops sends rather
//     than doubling them (review P1, 2026-10-02);
//   - an outcome is written once and never overwritten;
//   - every claim has an owner (live DEV finding, 2026-10-04): the invocation
//     that made it — and only that one — can resume it after losing its
//     reply, and only it can settle it; a claim from before the owner
//     existed can be neither;
//   - the table is reachable by no API role at all, only through the two
//     service-role functions, and has no foreign keys (CLAUDE.md rule 2).
//
// Concurrency — many backends claiming at once — cannot be shown here: PGlite
// is one backend. h5-sms-dispatch.concurrency.pgtest.ts runs that against a
// real Postgres server.

/** Two hash keys, as key ids. */
const KEY_A = 'a0'.repeat(8);
const KEY_B = 'b0'.repeat(8);

/** One number as each key sees it, and a second number under key A. */
const PHONE_UNDER_A = 'a'.repeat(64);
const PHONE_UNDER_B = 'b'.repeat(64);
const OTHER_PHONE_UNDER_A = 'c'.repeat(64);

const SEND = { decision: 'send', resumed: false };
const RESUMED = { decision: 'send', resumed: true };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const CLAIM_MIGRATION = '20261001000000_h5_auth_sms_dispatch.sql';
const OWNER_MIGRATION = '20261004000000_h5_sms_dispatch_claim_owner.sql';

let h: Harness;
let counter = 0;

/** The owner of each claimed webhook id, as the hook that claimed it holds it. */
const owners = new Map<string, string>();

/** A fresh Standard Webhooks id, as GoTrue mints one per attempt. */
function newWebhookId(): string {
  counter += 1;
  return `msg_${String(counter).padStart(6, '0')}`;
}

/** A fresh HMAC-shaped content key: a different code for the same number. */
function newContentKey(): string {
  counter += 1;
  return counter.toString(16).padStart(64, '0');
}

interface KeySet {
  keyId: string;
  phoneKey: string;
  contentKey: string;
}

interface ClaimInput {
  webhookId?: string;
  /** Every call is its own invocation with its own owner, unless told otherwise. */
  owner?: string | null;
  keyId?: string;
  phoneKey?: string;
  contentKey?: string;
  previous?: Partial<KeySet> | null;
  cap?: number | null;
}

async function claim(input: ClaimInput = {}): Promise<Record<string, unknown>> {
  const webhookId = input.webhookId ?? newWebhookId();
  const owner = input.owner === undefined ? randomUUID() : input.owner;
  const value = await h.as('service_role', null, async () => {
    const row = await h.one<{ value: Record<string, unknown> }>(
      'select h5_claim_sms_dispatch($1, $2, $3, $4, $5, $6, $7, $8, $9) as value',
      [
        webhookId,
        owner,
        input.keyId ?? KEY_A,
        input.phoneKey ?? PHONE_UNDER_A,
        input.contentKey ?? newContentKey(),
        input.previous?.keyId ?? null,
        input.previous?.phoneKey ?? null,
        input.previous?.contentKey ?? null,
        input.cap === undefined ? 10 : input.cap,
      ],
    );
    return row.value;
  });
  if (value.decision === 'send' && value.resumed === false && owner) owners.set(webhookId, owner);
  return value;
}

async function record(
  webhookId: string,
  status: string,
  details: {
    owner?: string | null;
    reason?: string | null;
    providerStatus?: string | null;
    messageId?: string | null;
  } = {},
): Promise<boolean> {
  const owner = details.owner === undefined ? owners.get(webhookId) ?? randomUUID() : details.owner;
  return h.as('service_role', null, async () => {
    const row = await h.one<{ value: boolean }>(
      'select h5_record_sms_dispatch($1, $2, $3, $4, $5, $6) as value',
      [
        webhookId,
        owner,
        status,
        details.reason ?? null,
        details.providerStatus ?? null,
        details.messageId ?? null,
      ],
    );
    return row.value;
  });
}

/** Runs `run`, expecting a refusal, and reports the SQLSTATE it raised. */
async function refused(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    const code = (error as { code?: string }).code;
    return code ?? String((error as Error).message ?? 'unknown');
  }
  throw new Error('expected a refusal, got success');
}

async function rowCount(): Promise<number> {
  const row = await h.one<{ count: number }>('select count(*)::int as count from auth_sms_dispatches');
  return row.count;
}

/** Moves every existing row back in time, as the superuser. */
async function ageRows(interval: string): Promise<void> {
  await h.exec(`update auth_sms_dispatches set created_at = created_at - interval '${interval}'`);
}

beforeAll(async () => {
  h = await createHarness();
}, 120_000);

afterAll(async () => h.close());

beforeEach(async () => {
  await h.exec('delete from auth_sms_dispatches');
  owners.clear();
});

describe('one provider call per code', () => {
  it('claims a first send, and an exact replay of that request is a duplicate', async () => {
    const webhookId = newWebhookId();
    const contentKey = newContentKey();

    expect(await claim({ webhookId, contentKey })).toEqual(SEND);
    // Still in flight: the replay must not become a second provider call.
    expect(await claim({ webhookId, contentKey })).toEqual({ decision: 'duplicate', status: 'pending' });

    expect(await record(webhookId, 'accepted', { providerStatus: '0', messageId: '444' })).toBe(true);
    expect(await claim({ webhookId, contentKey })).toEqual({ decision: 'duplicate', status: 'accepted' });
    expect(await rowCount()).toBe(1);
  });

  it('treats a GoTrue retry — new webhook id, same number and code — as the same send', async () => {
    const contentKey = newContentKey();
    const first = newWebhookId();
    expect(await claim({ webhookId: first, contentKey })).toEqual(SEND);
    await record(first, 'accepted', { providerStatus: '0', messageId: '445' });

    expect(await claim({ webhookId: newWebhookId(), contentKey }))
      .toEqual({ decision: 'duplicate', status: 'accepted' });
    expect(await rowCount()).toBe(1);
  });

  it("sends a repeated code normally once that code's five-minute lifetime has passed", async () => {
    const contentKey = newContentKey();
    const first = newWebhookId();
    await claim({ webhookId: first, contentKey });
    await record(first, 'accepted', { providerStatus: '0' });
    await ageRows('6 minutes');

    expect(await claim({ webhookId: newWebhookId(), contentKey })).toEqual(SEND);
  });

  it.each([
    ['rejected', 'ip_restricted', '5400'],
    ['ambiguous', 'provider_timeout', null],
  ])('replays a %s outcome instead of retrying the provider', async (status, reason, providerStatus) => {
    const contentKey = newContentKey();
    const first = newWebhookId();
    await claim({ webhookId: first, contentKey });
    await record(first, status, { reason, providerStatus });

    expect(await claim({ webhookId: first, contentKey })).toEqual({ decision: 'duplicate', status });
    expect(await claim({ webhookId: newWebhookId(), contentKey })).toEqual({ decision: 'duplicate', status });
    expect(await rowCount()).toBe(1);
  });
});

describe('claim ownership: only the claiming invocation resumes or settles', () => {
  it("resumes the caller's own pending claim when it asks again — one row, never a second", async () => {
    const webhookId = newWebhookId();
    const contentKey = newContentKey();
    const owner = randomUUID();

    expect(await claim({ webhookId, owner, contentKey })).toEqual(SEND);
    expect(await claim({ webhookId, owner, contentKey })).toEqual(RESUMED);
    expect(await claim({ webhookId, owner, contentKey })).toEqual(RESUMED);
    expect(await rowCount()).toBe(1);
  });

  it('never resumes for anyone else: a replay, a GoTrue retry, or the same owner on another request', async () => {
    const webhookId = newWebhookId();
    const contentKey = newContentKey();
    const owner = randomUUID();
    await claim({ webhookId, owner, contentKey });

    const pending = { decision: 'duplicate', status: 'pending' };
    expect(await claim({ webhookId, contentKey })).toEqual(pending);
    expect(await claim({ webhookId: newWebhookId(), contentKey })).toEqual(pending);
    expect(await claim({ webhookId: newWebhookId(), owner, contentKey })).toEqual(pending);
    expect(await rowCount()).toBe(1);
  });

  it.each([
    ['accepted', null],
    ['rejected', 'provider_rejected'],
    ['ambiguous', 'provider_timeout'],
  ])('never resumes a claim settled %s — not even for its owner', async (status, reason) => {
    const webhookId = newWebhookId();
    const owner = randomUUID();
    await claim({ webhookId, owner });
    expect(await record(webhookId, status, { owner, reason })).toBe(true);
    expect(await claim({ webhookId, owner })).toEqual({ decision: 'duplicate', status });
  });

  it('lets only the owner settle its claim', async () => {
    const webhookId = newWebhookId();
    const owner = randomUUID();
    await claim({ webhookId, owner });

    expect(await record(webhookId, 'accepted', { owner: randomUUID(), providerStatus: '0' })).toBe(false);
    // Untouched, and still the owner's to resume.
    expect(await claim({ webhookId, owner })).toEqual(RESUMED);
    expect(await record(webhookId, 'accepted', { owner, providerStatus: '0' })).toBe(true);
  });

  it('resumes past a full cap — the resumed claim is the one already counted', async () => {
    const webhookId = newWebhookId();
    const owner = randomUUID();
    expect(await claim({ webhookId, owner, cap: 1 })).toEqual(SEND);
    expect(await claim({ webhookId, owner, cap: 1 })).toEqual(RESUMED);
    expect(await claim({ cap: 1 })).toEqual({ decision: 'capped' });
    expect(await rowCount()).toBe(1);
  });

  it('stores the owner on the row it claims', async () => {
    const webhookId = newWebhookId();
    const owner = randomUUID();
    await claim({ webhookId, owner });
    expect(await h.one('select claim_owner from auth_sms_dispatches')).toEqual({ claim_owner: owner });
  });

  it('refuses a claim, or an outcome, that names no owner — before anything is written', async () => {
    expect(await refused(() => claim({ owner: null }))).toBe('MU080');
    expect(await rowCount()).toBe(0);

    const webhookId = newWebhookId();
    await claim({ webhookId });
    expect(await refused(() => record(webhookId, 'accepted', { owner: null }))).toBe('MU080');
  });
});

describe('the per-number daily cap', () => {
  it('allows ten provider calls a day, whatever their outcome, then caps that number only', async () => {
    const outcomes = ['accepted', 'rejected', 'ambiguous'] as const;
    for (let index = 0; index < 10; index += 1) {
      const webhookId = newWebhookId();
      expect(await claim({ webhookId })).toEqual(SEND);
      const status = outcomes[index % outcomes.length]!;
      await record(webhookId, status, { reason: status === 'accepted' ? null : 'provider_rejected' });
    }

    expect(await claim()).toEqual({ decision: 'capped' });
    // A capped request leaves no row: it never reached the provider.
    expect(await rowCount()).toBe(10);
    expect(await claim({ phoneKey: OTHER_PHONE_UNDER_A })).toEqual(SEND);
  });

  it('counts a still-pending call against the cap', async () => {
    for (let index = 0; index < 10; index += 1) await claim();
    expect(await claim()).toEqual({ decision: 'capped' });
  });

  it('counts only the last 24 hours', async () => {
    for (let index = 0; index < 10; index += 1) await claim();
    await ageRows('25 hours');
    expect(await claim()).toEqual(SEND);
  });

  it('lets a DEV project lower the ceiling', async () => {
    expect(await claim({ cap: 2 })).toEqual(SEND);
    expect(await claim({ cap: 2 })).toEqual(SEND);
    expect(await claim({ cap: 2 })).toEqual({ decision: 'capped' });
  });

  it.each([[11], [0], [-1], [null]])('never lets a cap of %j through', async (cap) => {
    expect(await refused(() => claim({ cap }))).toBe('MU080');
    expect(await rowCount()).toBe(0);
  });
});

describe('rotating the hash key', () => {
  /** The same number, and one code for it, as key A sees them. */
  function underA(contentKey = newContentKey()): KeySet {
    return { keyId: KEY_A, phoneKey: PHONE_UNDER_A, contentKey };
  }

  /** A claim from an instance on key B that still holds key A as previous. */
  function rotated(previous: KeySet, contentKey = newContentKey()): ClaimInput {
    return { keyId: KEY_B, phoneKey: PHONE_UNDER_B, contentKey, previous };
  }

  it('answers a GoTrue retry that lands on a rotated instance from the old row: no second send', async () => {
    const before = underA();
    const first = newWebhookId();
    expect(await claim({ webhookId: first, ...before })).toEqual(SEND);
    await record(first, 'accepted', { providerStatus: '0', messageId: '501' });

    // Same number, same code — but under key B its keys are entirely different.
    expect(await claim(rotated(before))).toEqual({ decision: 'duplicate', status: 'accepted' });
    expect(await rowCount()).toBe(1);
  });

  it('carries the cap across the rotation: six calls under A and four under B are ten', async () => {
    for (let index = 0; index < 6; index += 1) {
      expect(await claim(underA())).toEqual(SEND);
    }
    for (let index = 0; index < 4; index += 1) {
      expect(await claim(rotated(underA()))).toEqual(SEND);
    }
    expect(await claim(rotated(underA()))).toEqual({ decision: 'capped' });
    expect(await rowCount()).toBe(10);
  });

  it('writes only under the current key', async () => {
    await claim(rotated(underA()));
    const row = await h.one<{ key_id: string; phone_key: string }>(
      'select key_id, phone_key from auth_sms_dispatches',
    );
    expect(row).toEqual({ key_id: KEY_B, phone_key: PHONE_UNDER_B });
  });

  it("counts the previous key's rows for this number only", async () => {
    for (let index = 0; index < 10; index += 1) {
      await claim({ keyId: KEY_A, phoneKey: OTHER_PHONE_UNDER_A });
    }
    expect(await claim(rotated(underA()))).toEqual(SEND);
  });

  it('refuses — no send — when the previous key is dropped while its rows still decide something', async () => {
    await claim(underA());
    // Key B alone: the row above could be this very number and code.
    expect(await claim({ keyId: KEY_B, phoneKey: PHONE_UNDER_B })).toEqual({ decision: 'unknown_key' });
    expect(await rowCount()).toBe(1);
  });

  it('refuses an instance still on the old key once the new key has written', async () => {
    expect(await claim(rotated(underA()))).toEqual(SEND);
    expect(await claim(underA())).toEqual({ decision: 'unknown_key' });
    expect(await rowCount()).toBe(1);
  });

  it('still refuses just inside the day, and sends once the old rows are past it', async () => {
    await claim(underA());
    await ageRows('23 hours 59 minutes');
    expect(await claim({ keyId: KEY_B, phoneKey: PHONE_UNDER_B })).toEqual({ decision: 'unknown_key' });
    await ageRows('2 minutes');
    expect(await claim({ keyId: KEY_B, phoneKey: PHONE_UNDER_B })).toEqual(SEND);
  });

  it('refuses an exact replay too, rather than answer from a ledger it cannot fully read', async () => {
    const webhookId = newWebhookId();
    await claim({ webhookId, ...underA() });
    await claim(rotated(underA()));
    expect(await claim({ webhookId, ...underA() })).toEqual({ decision: 'unknown_key' });
  });

  it.each([
    ['the previous key id equal to the current one', { keyId: KEY_A, phoneKey: PHONE_UNDER_B, contentKey: 'e'.repeat(64) }],
    ['a previous key id with no keys', { keyId: KEY_B }],
    ['previous keys with no key id', { phoneKey: PHONE_UNDER_B, contentKey: 'e'.repeat(64) }],
    ['a previous phone key alone', { phoneKey: PHONE_UNDER_B }],
    ['a malformed previous key id', { keyId: 'B0B0', phoneKey: PHONE_UNDER_B, contentKey: 'e'.repeat(64) }],
    ['a malformed previous content key', { keyId: KEY_B, phoneKey: PHONE_UNDER_B, contentKey: 'ee' }],
  ])('refuses %s', async (_label, previous) => {
    expect(await refused(() => claim({ previous }))).toBe('MU080');
    expect(await rowCount()).toBe(0);
  });
});

describe('claim input is validated before anything is written', () => {
  it.each([
    ['a non-hex phone key', { phoneKey: 'not-a-key' }],
    ['an uppercase phone key', { phoneKey: 'A'.repeat(64) }],
    ['a short content key', { contentKey: 'ab' }],
    ['a short key id', { keyId: 'a0a0' }],
    ['an uppercase key id', { keyId: 'A0'.repeat(8) }],
    ['an empty webhook id', { webhookId: '' }],
    ['an oversized webhook id', { webhookId: 'x'.repeat(201) }],
  ])('refuses %s', async (_label, input) => {
    expect(await refused(() => claim(input))).toBe('MU080');
    expect(await rowCount()).toBe(0);
  });
});

describe('settling an outcome', () => {
  it('writes an outcome exactly once and never overwrites it', async () => {
    const webhookId = newWebhookId();
    await claim({ webhookId });

    expect(await record(webhookId, 'accepted', { providerStatus: '0', messageId: '446' })).toBe(true);
    expect(await record(webhookId, 'rejected', { reason: 'provider_rejected', providerStatus: '1' })).toBe(false);

    const row = await h.one<Record<string, unknown>>(
      'select status, reason, provider_status, provider_message_id, settled_at from auth_sms_dispatches',
    );
    expect(row).toMatchObject({
      status: 'accepted',
      reason: null,
      provider_status: '0',
      provider_message_id: '446',
    });
    expect(row.settled_at).not.toBeNull();
  });

  it('reports false for a call that was never claimed', async () => {
    expect(await record('msg_never_claimed', 'accepted')).toBe(false);
  });

  it.each(['pending', 'sent', '', null])('refuses the outcome %j', async (status) => {
    const webhookId = newWebhookId();
    await claim({ webhookId });
    expect(await refused(() => record(webhookId, status as string))).toBe('MU080');
  });

  it.each([
    ['a reason that is not a category', { reason: 'Has Spaces' }],
    ['a provider status that is not numeric', { providerStatus: 'ACCEPTD' }],
    ['a message id with unexpected characters', { messageId: '444/../etc' }],
  ])('refuses to store %s', async (_label, details) => {
    const webhookId = newWebhookId();
    await claim({ webhookId });
    expect(await refused(() => record(webhookId, 'accepted', details))).toBe('23514');
  });
});

describe('what the ledger holds, and who can reach it', () => {
  it('stores no phone number and no code — only keyed hashes, a key fingerprint, provider metadata and a random owner', async () => {
    const columns = await h.all<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'auth_sms_dispatches'
        order by ordinal_position`,
    );
    expect(columns.map((column) => column.column_name)).toEqual([
      'webhook_id',
      'key_id',
      'phone_key',
      'content_key',
      'status',
      'reason',
      'provider_status',
      'provider_message_id',
      'created_at',
      'settled_at',
      'claim_owner',
    ]);
  });

  it('has no foreign keys and is referenced by none (CLAUDE.md rule 2)', async () => {
    const constraints = await h.all(
      `select conname from pg_constraint
        where contype = 'f'
          and (conrelid = 'public.auth_sms_dispatches'::regclass
               or confrelid = 'public.auth_sms_dispatches'::regclass)`,
    );
    expect(constraints).toEqual([]);
  });

  it('purges rows older than a week on the next claim', async () => {
    await claim();
    await ageRows('8 days');
    await claim();
    expect(await rowCount()).toBe(1);
  });

  it('is unreadable and unwritable by every API role, service_role included', async () => {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      const readCode = await h.as(role, null, () =>
        refused(() => h.all('select * from auth_sms_dispatches')));
      expect(readCode, `${role} must not read the ledger directly`).toBe('42501');
      const writeCode = await h.as(role, null, () =>
        refused(() => h.all(
          `insert into auth_sms_dispatches (webhook_id, claim_owner, key_id, phone_key, content_key)
           values ('msg_direct', '${randomUUID()}', '${KEY_A}', '${PHONE_UNDER_A}', '${PHONE_UNDER_B}')`,
        )));
      expect(writeCode, `${role} must not write the ledger directly`).toBe('42501');
    }
  });

  it('keeps both functions unreachable from anon and authenticated', async () => {
    for (const role of ['anon', 'authenticated']) {
      const claimCode = await h.as(role, null, () => refused(() => h.one(
        'select h5_claim_sms_dispatch($1, $2, $3, $4, $5, $6, $7, $8, $9)',
        ['msg_api_role', randomUUID(), KEY_A, PHONE_UNDER_A, PHONE_UNDER_B, null, null, null, 10],
      )));
      expect(claimCode, `h5_claim_sms_dispatch must be unreachable from ${role}`).toBe('42501');
      const recordCode = await h.as(role, null, () => refused(() => h.one(
        'select h5_record_sms_dispatch($1, $2, $3, $4, $5, $6)',
        ['msg_api_role', randomUUID(), 'accepted', null, null, null],
      )));
      expect(recordCode, `h5_record_sms_dispatch must be unreachable from ${role}`).toBe('42501');
    }
    expect(await rowCount()).toBe(0);
  });

  it('is exactly two functions — the owner-less signatures are gone — each a pinned definer owned by postgres', async () => {
    // The ledger's own names, every overload of them. H-5 also ships
    // h5_revoke_auth_user_sessions (20261005000000), which is not a ledger
    // function; session-revocation.pgtest.ts pins it.
    const functions = await h.all<{ signature: string; definer: boolean; owner: string; config: string[] | null }>(
      `select p.oid::regprocedure::text as signature, p.prosecdef as definer,
              pg_get_userbyid(p.proowner) as owner, p.proconfig as config
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname like 'h5\\_%\\_sms\\_dispatch'
        order by 1`,
    );
    expect(functions.map((row) => row.signature)).toEqual([
      'h5_claim_sms_dispatch(text,uuid,text,text,text,text,text,text,integer)',
      'h5_record_sms_dispatch(text,uuid,text,text,text,text)',
    ]);
    for (const row of functions) {
      expect(row.definer, `${row.signature} SECURITY DEFINER`).toBe(true);
      expect(row.owner, `${row.signature} owner`).toBe('postgres');
      expect(row.config ?? [], `${row.signature} search_path`).toContain('search_path=public');
    }
  });
});

// ── An upgrade over claims the old build left behind ─────────────────────
//
// DEV applied 20261001000000 and holds two rows from the first real send: one
// accepted, one left pending when its reply was lost. The owner migration
// lands on top of that, so it is tested on top of that.

describe('upgrading a ledger that already holds claims', () => {
  let bare: Harness;

  beforeAll(async () => {
    bare = await createBareHarness();
    const files = migrationFiles();
    const at = files.indexOf(OWNER_MIGRATION);
    expect(files.indexOf(CLAIM_MIGRATION)).toBeLessThan(at);
    for (const name of files.slice(0, at)) await bare.exec(migrationSql(name));
    // The old build's two claims, through the old, owner-less functions.
    await bare.one(
      `select h5_claim_sms_dispatch('msg_old_accepted', $1, $2, $3, null, null, null, 10)`,
      [KEY_A, PHONE_UNDER_A, 'e'.repeat(64)],
    );
    await bare.one(`select h5_record_sms_dispatch('msg_old_accepted', 'accepted', null, '0', '444')`);
    await bare.one(
      `select h5_claim_sms_dispatch('msg_old_pending', $1, $2, $3, null, null, null, 10)`,
      [KEY_A, PHONE_UNDER_A, 'f'.repeat(64)],
    );
    for (const name of files.slice(at)) await bare.exec(migrationSql(name));
    await bare.exec(HOSTED_FUNCTION_EXECUTE_MODEL);
  }, 120_000);

  afterAll(async () => bare?.close());

  it('gives every old row its own owner, one no invocation holds, and makes the column required', async () => {
    const rows = await bare.all<{ webhook_id: string; status: string; claim_owner: string }>(
      'select webhook_id, status, claim_owner from auth_sms_dispatches order by webhook_id',
    );
    expect(rows.map((row) => [row.webhook_id, row.status])).toEqual([
      ['msg_old_accepted', 'accepted'],
      ['msg_old_pending', 'pending'],
    ]);
    for (const row of rows) expect(row.claim_owner).toMatch(UUID);
    expect(new Set(rows.map((row) => row.claim_owner)).size).toBe(2);
    expect(await bare.one(
      `select is_nullable, column_default from information_schema.columns
        where table_name = 'auth_sms_dispatches' and column_name = 'claim_owner'`,
    )).toEqual({ is_nullable: 'NO', column_default: null });
  });

  it('never resumes or settles the old pending claim — but it still blocks a duplicate and still counts', async () => {
    await bare.as('service_role', null, async () => {
      const owner = randomUUID();
      const replay = await bare.one<{ value: unknown }>(
        `select h5_claim_sms_dispatch('msg_old_pending', $1, $2, $3, $4, null, null, null, 10) as value`,
        [owner, KEY_A, PHONE_UNDER_A, 'f'.repeat(64)],
      );
      expect(replay.value).toEqual({ decision: 'duplicate', status: 'pending' });
      const settle = await bare.one<{ value: boolean }>(
        `select h5_record_sms_dispatch('msg_old_pending', $1, 'accepted', null, '0', null) as value`,
        [owner],
      );
      expect(settle.value).toBe(false);
      // Both old rows count: a cap of two is already used up.
      const capped = await bare.one<{ value: unknown }>(
        `select h5_claim_sms_dispatch('msg_after_upgrade', $1, $2, $3, $4, null, null, null, 2) as value`,
        [randomUUID(), KEY_A, PHONE_UNDER_A, 'a1'.repeat(32)],
      );
      expect(capped.value).toEqual({ decision: 'capped' });
    });
  });

  it('leaves an old hook build nothing to call: it fails closed, it cannot claim', async () => {
    const code = await bare.as('service_role', null, () => refused(() => bare.one(
      `select h5_claim_sms_dispatch('msg_old_build', $1, $2, $3, null, null, null, 10)`,
      [KEY_A, PHONE_UNDER_A, 'b1'.repeat(32)],
    )));
    expect(code).toBe('42883');
  });
});

// ── The real hook over the real ledger ───────────────────────────────────
//
// The hook's own key derivation, its own RPC argument names, its own handling
// of every decision — against the SQL above, called by name the way PostgREST
// calls it. Only REVE (fetch) is a double, so "one SMS" is counted where it
// would be paid for.

describe('the real hook over the real ledger', () => {
  const HOOK_KEY = Buffer.alloc(32, 7);
  const HASH_A = Buffer.alloc(32, 0xa1).toString('base64');
  const HASH_B = Buffer.alloc(32, 0xb2).toString('base64');
  const PHONE = '8801712345678';

  /** PostgREST's RPC: named arguments, as service_role, SQLSTATE on failure. */
  const rpc: RpcCaller = async (name, args) => {
    if (!/^h5_[a-z_]+$/.test(name)) throw new Error(`unexpected rpc ${name}`);
    const names = Object.keys(args);
    for (const parameter of names) {
      if (!/^p_[a-z_]+$/.test(parameter)) throw new Error(`unexpected parameter ${parameter}`);
    }
    const call = `select ${name}(${names.map((parameter, index) => `${parameter} => $${index + 1}`).join(', ')}) as value`;
    try {
      const row = await h.as('service_role', null, () =>
        h.one<{ value: unknown }>(call, names.map((parameter) => args[parameter])));
      return { data: row.value, error: null };
    } catch (error) {
      return { data: null, error: { code: (error as { code?: string }).code ?? null } };
    }
  };

  /**
   * The same RPC with the reply to the FIRST claim lost — after that claim
   * committed, or before it ever reached the database — and `meanwhile` run
   * while the hook still waits for it. Records every owner a claim names.
   */
  function firstClaimReplyLost(when: 'after_commit' | 'before_commit', meanwhile = async () => {}) {
    let lost = false;
    const claimOwners: string[] = [];
    const lossy: RpcCaller = async (name, args, signal) => {
      const isClaim = name === 'h5_claim_sms_dispatch';
      if (isClaim) claimOwners.push(String(args.p_claim_owner));
      if (!isClaim || lost) return rpc(name, args, signal);
      lost = true;
      if (when === 'after_commit') await rpc(name, args, signal);
      await meanwhile();
      throw new TypeError('connection reset by peer');
    };
    return { rpc: lossy, claimOwners };
  }

  let fetch: ReturnType<typeof vi.fn<FetchLike>>;
  let logs: string[];

  function instance(hashKeys: { current: string; previous?: string }, cap?: number, ledgerRpc: RpcCaller = rpc) {
    const env: Record<string, string | undefined> = {
      SEND_SMS_HOOK_SECRET: `v1,whsec_${HOOK_KEY.toString('base64')}`,
      SMS_DISPATCH_HASH_KEY: hashKeys.current,
      SMS_DISPATCH_HASH_KEY_PREVIOUS: hashKeys.previous,
      OTP_SMS_DAILY_CAP_PER_PHONE: cap === undefined ? undefined : String(cap),
      REVE_API_URL: 'https://smpp.revesms.com:7790/sendtext',
      REVE_TRANSPORT: 'post_json',
      REVE_API_KEY: 'test-api-key-123',
      REVE_SECRET_KEY: 'test-secret-key-456',
      REVE_SENDER_ID: '8809600000000',
    };
    return createSendSmsHandler({
      read: (variable) => env[variable],
      fetch,
      ledger: rpcDispatchLedger(ledgerRpc),
      nowMs: () => Date.now(),
      log: (line) => logs.push(line),
    });
  }

  /** A signed Send SMS hook call; a fresh webhook id, as GoTrue sends, unless one is given. */
  function hookCall(otp: string, id = newWebhookId()): Request {
    const timestamp = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({ user: { phone: PHONE }, sms: { otp, phone: PHONE } });
    const signature = createHmac('sha256', HOOK_KEY).update(`${id}.${timestamp}.${body}`).digest('base64');
    return new Request('https://project.supabase.co/functions/v1/auth-send-sms', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'webhook-id': id,
        'webhook-timestamp': String(timestamp),
        'webhook-signature': `v1,${signature}`,
      },
      body,
    });
  }

  async function reply(response: Response): Promise<unknown> {
    return response.json();
  }

  async function onlyRow(): Promise<Record<string, unknown>> {
    expect(await rowCount()).toBe(1);
    return h.one('select webhook_id, claim_owner, status, reason, provider_message_id from auth_sms_dispatches');
  }

  const sent = {};
  const unavailable = { error: { http_code: 503, message: 'SMS could not be sent' } };
  const capped = {
    error: { http_code: 429, message: 'Too many codes were requested for this number. Try again later.' },
  };

  beforeEach(() => {
    fetch = vi.fn<FetchLike>(async () => new Response('{"Status":"0","Text":"ACCEPTD","Message_ID":"444"}'));
    logs = [];
  });

  describe('across a hash-key rotation', () => {
    it('a GoTrue retry across the rotation is answered from the ledger — one SMS', async () => {
      expect(await reply(await instance({ current: HASH_A })(hookCall('111111')))).toEqual(sent);
      expect(await reply(await instance({ current: HASH_B, previous: HASH_A })(hookCall('111111')))).toEqual(sent);
      expect(fetch).toHaveBeenCalledOnce();
    });

    it('the cap is not reset by the rotation', async () => {
      expect(await reply(await instance({ current: HASH_A }, 2)(hookCall('222221')))).toEqual(sent);
      expect(await reply(await instance({ current: HASH_B, previous: HASH_A }, 2)(hookCall('222222')))).toEqual(sent);
      expect(await reply(await instance({ current: HASH_B, previous: HASH_A }, 2)(hookCall('222223')))).toEqual(capped);
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('dropping the previous key early stops sends instead of doubling them', async () => {
      expect(await reply(await instance({ current: HASH_A })(hookCall('333333')))).toEqual(sent);
      // The retry of that very code, on an instance that no longer holds key A.
      expect(await reply(await instance({ current: HASH_B })(hookCall('333333')))).toEqual(unavailable);
      expect(fetch).toHaveBeenCalledOnce();
      expect(logs).toEqual([expect.stringContaining('outcome=ledger_key_unknown')]);

      await ageRows('25 hours');
      expect(await reply(await instance({ current: HASH_B })(hookCall('333334')))).toEqual(sent);
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('an instance still on the old key stops sending once the new key has written', async () => {
      expect(await reply(await instance({ current: HASH_B, previous: HASH_A })(hookCall('444444')))).toEqual(sent);
      expect(await reply(await instance({ current: HASH_A })(hookCall('444444')))).toEqual(unavailable);
      expect(fetch).toHaveBeenCalledOnce();
    });
  });

  describe('when a claim reply is lost (live DEV, 2026-10-04)', () => {
    it('the claim committed: the same invocation asks again as its owner, resumes it, and sends once', async () => {
      const lossy = firstClaimReplyLost('after_commit');
      expect(await reply(await instance({ current: HASH_A }, undefined, lossy.rpc)(hookCall('515151')))).toEqual(sent);

      expect(fetch).toHaveBeenCalledOnce();
      expect(lossy.claimOwners).toHaveLength(2);
      expect(lossy.claimOwners[1]).toBe(lossy.claimOwners[0]);
      // Settled by its owner: nothing is left pending.
      expect(await onlyRow()).toMatchObject({
        claim_owner: lossy.claimOwners[0],
        status: 'accepted',
        provider_message_id: '444',
      });
      expect(logs).toEqual([
        expect.stringContaining('outcome=ledger_unavailable step=claim attempt=1 db=none'),
        expect.stringContaining('outcome=claim_reconciled resumed=yes'),
      ]);
    });

    it('the claim never arrived: the second ask makes it, and sends once', async () => {
      const lossy = firstClaimReplyLost('before_commit');
      expect(await reply(await instance({ current: HASH_A }, undefined, lossy.rpc)(hookCall('525252')))).toEqual(sent);

      expect(fetch).toHaveBeenCalledOnce();
      expect(await onlyRow()).toMatchObject({ claim_owner: lossy.claimOwners[0], status: 'accepted' });
      expect(logs).toEqual([
        expect.stringContaining('outcome=ledger_unavailable step=claim attempt=1 db=none'),
        expect.stringContaining('outcome=claim_reconciled resumed=no'),
      ]);
    });

    it.each([
      ['an exact replay of the request', true],
      ['a GoTrue retry of the code', false],
    ])('%s, landing while that reply is lost, cannot send — the owner still sends, once', async (_label, sameId) => {
      const webhookId = newWebhookId();
      let raced: unknown = null;
      const lossy = firstClaimReplyLost('after_commit', async () => {
        const racer = hookCall('535353', sameId ? webhookId : newWebhookId());
        raced = await reply(await instance({ current: HASH_A })(racer));
      });

      expect(await reply(await instance({ current: HASH_A }, undefined, lossy.rpc)(hookCall('535353', webhookId))))
        .toEqual(sent);
      // The racer met someone else's claim, still in flight: success, no SMS of its own.
      expect(raced).toEqual(sent);
      expect(fetch).toHaveBeenCalledOnce();
      expect(await onlyRow()).toMatchObject({
        webhook_id: webhookId,
        claim_owner: lossy.claimOwners[0],
        status: 'accepted',
      });
    });
  });

  describe('a replay that finds the claim still pending (consolidated review, 2026-10-05)', () => {
    /** The real RPC, noting the owner each claim names. */
    function watched(base: RpcCaller = rpc) {
      const claimOwners: string[] = [];
      const watchedRpc: RpcCaller = async (name, args, signal) => {
        if (name === 'h5_claim_sms_dispatch') claimOwners.push(String(args.p_claim_owner));
        return base(name, args, signal);
      };
      return { rpc: watchedRpc, claimOwners };
    }

    it('REVE was called but its outcome never reached the ledger: a retry and an exact replay answer success, and send nothing', async () => {
      const webhookId = newWebhookId();
      // The owner's record is lost before it reaches the database.
      const recordLost: RpcCaller = async (name, args, signal) => {
        if (name === 'h5_record_sms_dispatch') throw new TypeError('connection reset by peer');
        return rpc(name, args, signal);
      };
      const owner = watched(recordLost);
      expect(await reply(await instance({ current: HASH_A }, undefined, owner.rpc)(hookCall('565656', webhookId))))
        .toEqual(sent);
      expect(await onlyRow()).toMatchObject({ claim_owner: owner.claimOwners[0], status: 'pending' });

      // GoTrue's retry of the code, then an exact replay — each on an instance whose records would land.
      const replays = watched();
      expect(await reply(await instance({ current: HASH_A }, undefined, replays.rpc)(hookCall('565656'))))
        .toEqual(sent);
      expect(await reply(await instance({ current: HASH_A }, undefined, replays.rpc)(hookCall('565656', webhookId))))
        .toEqual(sent);

      expect(fetch).toHaveBeenCalledOnce();
      // Still pending, still the owner's: never turned into `accepted` by a replay.
      expect(await onlyRow()).toMatchObject({
        webhook_id: webhookId,
        claim_owner: owner.claimOwners[0],
        status: 'pending',
      });
      expect(logs).toEqual([
        expect.stringContaining('outcome=ledger_unavailable step=record db=none'),
        expect.stringContaining('outcome=duplicate status=pending'),
        expect.stringContaining('outcome=duplicate status=pending'),
      ]);

      // Neither replay can take the claim over: their owners settle nothing; the owner's still can.
      expect(replays.claimOwners).toHaveLength(2);
      for (const replayOwner of replays.claimOwners) {
        expect(replayOwner).not.toBe(owner.claimOwners[0]);
        expect(await record(webhookId, 'accepted', { owner: replayOwner })).toBe(false);
      }
      expect(await record(webhookId, 'accepted', { owner: owner.claimOwners[0] })).toBe(true);
    });

    it("a retry landing while the owner's REVE call is in flight answers success — the owner then settles its row", async () => {
      const webhookId = newWebhookId();
      let raced: unknown = null;
      fetch.mockImplementationOnce(async () => {
        // REVE has the owner's request; GoTrue's retry of the code lands on another instance.
        raced = await reply(await instance({ current: HASH_A })(hookCall('575757')));
        return new Response('{"Status":"0","Text":"ACCEPTD","Message_ID":"445"}');
      });
      expect(await reply(await instance({ current: HASH_A })(hookCall('575757', webhookId)))).toEqual(sent);

      expect(raced).toEqual(sent);
      expect(fetch).toHaveBeenCalledOnce();
      expect(await onlyRow()).toMatchObject({ webhook_id: webhookId, status: 'accepted', provider_message_id: '445' });
      expect(logs).toEqual([expect.stringContaining('outcome=duplicate status=pending')]);
    });
  });

  describe('once REVE has been called, its code stands', () => {
    it('an ambiguous send answers GoTrue success, and a retry of that code sends nothing more', async () => {
      fetch.mockImplementation(async () => {
        throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      });
      expect(await reply(await instance({ current: HASH_A })(hookCall('545454')))).toEqual(sent);
      expect(await reply(await instance({ current: HASH_A })(hookCall('545454')))).toEqual(sent);

      expect(fetch).toHaveBeenCalledOnce();
      expect(await onlyRow()).toMatchObject({ status: 'ambiguous', reason: 'provider_timeout' });
    });

    it('a definite rejection still fails, and a retry of that code sends nothing more', async () => {
      fetch.mockImplementation(async () => new Response('{"Status":"109","Text":"Invalid api key"}'));
      const failed = { error: { http_code: 500, message: 'SMS could not be sent' } };
      expect(await reply(await instance({ current: HASH_A })(hookCall('555555')))).toEqual(failed);
      expect(await reply(await instance({ current: HASH_A })(hookCall('555555')))).toEqual(failed);

      expect(fetch).toHaveBeenCalledOnce();
      expect(await onlyRow()).toMatchObject({ status: 'rejected', reason: 'credentials_invalid' });
    });
  });
});
