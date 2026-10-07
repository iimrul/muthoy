import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { HOSTED_FUNCTION_EXECUTE_MODEL, migrationSql, PLATFORM_BOOTSTRAP } from './harness';
import { findPostgresBin, type PsqlResult, type ServerPostgres, startServerPostgres } from './serverPostgres';

// H-5 under REAL concurrency: many backends claiming from the dispatch ledger
// at the same instant, on a PostgreSQL server (review P1, 2026-10-02).
//
// h5-sms-dispatch.pgtest.ts proves every decision one claim at a time, on
// PGlite — one backend, so nothing there ever overlaps. Here every claim is its
// own psql process and its own backend, against the very same migration, the
// same platform roles and the same hosted function ACL.
//
// What is proven, and how:
//
//   - THE LOCK IS WHAT SERIALIZES. A claim is held open mid-transaction; a
//     second claim for the same code is then seen in pg_locks QUEUED on the
//     ledger lock, and decides only after the first commits — or rolls back.
//     The negative control runs the same two sessions against a copy of the
//     function with only the lock line removed: the second claim does not
//     wait, and the one code is sent twice. Deterministic, no timing guess.
//   - UNDER A STAMPEDE, every claimant is parked on a barrier lock, then all
//     are released at once: one code yields one send; ten a day stays ten; one
//     webhook id yields one send; and no mix of hash-key generations during a
//     rotation yields a second send.
//   - OWNERSHIP (live DEV finding, 2026-10-04). A hook that lost its claim's
//     reply asks again as the claim's owner: queued behind its own first ask,
//     it resumes that claim once it commits, or makes it if it rolled back;
//     released together with a crowd of replays, it is still the only send.
//
// Needs PostgreSQL's own binaries (initdb, pg_ctl, psql) — PATH, PG_BIN_DIR,
// or /usr/lib/postgresql/<n>/bin as on GitHub's ubuntu-latest. Skipped, and
// says so, on a machine without them.

const BIN = findPostgresBin();
/** In order. The last one holds the claim function as it now stands. */
const MIGRATIONS = [
  '20261001000000_h5_auth_sms_dispatch.sql',
  '20261004000000_h5_sms_dispatch_claim_owner.sql',
];
const CLAIM_FUNCTION_MIGRATION = MIGRATIONS.at(-1)!;

const KEY_A = 'a0'.repeat(8);
const KEY_B = 'b0'.repeat(8);
const PHONE_UNDER_A = 'a'.repeat(64);
const PHONE_UNDER_B = 'b'.repeat(64);

const SEND = { decision: 'send', resumed: false };
const RESUMED = { decision: 'send', resumed: true };

/** The advisory lock every claimant parks on before a stampede. */
const BARRIER = 770_001;

/** The claim function's own lock, as pg_locks shows a one-bigint advisory lock. */
const CLAIM_LOCK = `locktype = 'advisory' and objsubid = 1
  and ((classid::bigint << 32) | objid::bigint) = hashtextextended('h5_sms_dispatch', 0)`;
const BARRIER_LOCK = `locktype = 'advisory' and objsubid = 1 and classid = 0 and objid = ${BARRIER}`;

if (!BIN) {
  console.warn('[h5 concurrency] SKIPPED: no PostgreSQL binaries (initdb, pg_ctl, psql) on this machine.');
}

let pg: ServerPostgres;
let counter = 0;

function nextHex(): string {
  counter += 1;
  return counter.toString(16).padStart(64, '0');
}

function nextWebhookId(): string {
  counter += 1;
  return `msg_${String(counter).padStart(6, '0')}`;
}

interface Claim {
  webhookId?: string;
  /** Every claimant is its own invocation with its own owner, unless told otherwise. */
  owner?: string;
  keyId?: string;
  phoneKey?: string;
  contentKey: string;
  previous?: { keyId: string; phoneKey: string; contentKey: string };
  cap?: number;
}

/** Every value is generated here and checked, so plain literals are safe. */
function literal(value: string | null): string {
  if (value === null) return 'null';
  if (!/^[A-Za-z0-9_]+$/.test(value)) throw new Error(`unsafe literal ${value}`);
  return `'${value}'`;
}

function uuidLiteral(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) {
    throw new Error(`unsafe uuid ${value}`);
  }
  return `'${value}'::uuid`;
}

function claimSql(claim: Claim, fn = 'h5_claim_sms_dispatch'): string {
  const args = [
    literal(claim.webhookId ?? nextWebhookId()),
    uuidLiteral(claim.owner ?? randomUUID()),
    literal(claim.keyId ?? KEY_A),
    literal(claim.phoneKey ?? PHONE_UNDER_A),
    literal(claim.contentKey),
    literal(claim.previous?.keyId ?? null),
    literal(claim.previous?.phoneKey ?? null),
    literal(claim.previous?.contentKey ?? null),
    String(claim.cap ?? 10),
  ];
  return `select ${fn}(${args.join(', ')});\n`;
}

/** The claim's JSON reply: the last line psql printed that is one. */
function decision(result: PsqlResult): Record<string, unknown> {
  if (result.code !== 0) throw new Error(`claim failed (${result.code}): ${result.stderr}`);
  const line = result.stdout.split(/\r?\n/).filter((text) => text.trim().startsWith('{')).at(-1);
  if (!line) throw new Error(`no claim reply in: ${result.stdout}`);
  return JSON.parse(line) as Record<string, unknown>;
}

function tally(decisions: Record<string, unknown>[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of decisions) {
    const name = String(item.decision);
    counts[name] = (counts[name] ?? 0) + 1;
  }
  return counts;
}

async function count(sql: string): Promise<number> {
  return Number((await pg.query(sql)).trim());
}

const rows = () => count('select count(*) from auth_sms_dispatches;');

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function waitUntil(check: () => Promise<boolean>, what: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await sleep(40);
  }
  throw new Error(`timed out waiting for ${what}`);
}

const claimLockHolders = () => count(`select count(*) from pg_locks where ${CLAIM_LOCK} and granted;`);
const claimLockWaiters = () => count(`select count(*) from pg_locks where ${CLAIM_LOCK} and not granted;`);

/**
 * Parks one backend per claim on BARRIER, waits until every one of them is
 * actually waiting there, then releases them together. Returns each reply.
 */
async function stampede(claims: string[]): Promise<Record<string, unknown>[]> {
  const gate = pg.open(`select pg_advisory_lock(${BARRIER});\n`);
  await waitUntil(async () => (await count(`select count(*) from pg_locks where ${BARRIER_LOCK} and granted;`)) === 1,
    'the barrier to be held');
  const claimants = claims.map((sql) =>
    pg.run(`select pg_advisory_lock_shared(${BARRIER});\nset role service_role;\n${sql}`));
  await waitUntil(
    async () => (await count(`select count(*) from pg_locks where ${BARRIER_LOCK} and not granted;`)) === claims.length,
    `all ${claims.length} claimants to park on the barrier`,
  );
  gate.write(`select pg_advisory_unlock(${BARRIER});\n`);
  const results = await Promise.all(claimants);
  await gate.end();
  return results.map(decision);
}

describe.skipIf(!BIN)('the dispatch ledger under real concurrency (PostgreSQL server)', () => {
  beforeAll(async () => {
    pg = await startServerPostgres(BIN!);
    await pg.query(PLATFORM_BOOTSTRAP);
    for (const name of MIGRATIONS) await pg.query(migrationSql(name));
    await pg.query(HOSTED_FUNCTION_EXECUTE_MODEL);
  }, 180_000);

  afterAll(() => pg?.stop());

  beforeEach(async () => {
    await pg.query('delete from auth_sms_dispatches;');
  });

  describe('the ledger lock is what serializes two claims', () => {
    it('a second claim for the same code queues on the lock, then sees the first and sends nothing', async () => {
      const contentKey = nextHex();
      const first = pg.open(`begin;\nset role service_role;\n${claimSql({ contentKey })}`);
      await waitUntil(async () => (await claimLockHolders()) === 1, 'the first claim to hold the ledger lock');

      let secondDone = false;
      const second = pg.run(`set role service_role;\n${claimSql({ contentKey })}`)
        .then((result) => { secondDone = true; return result; });
      await waitUntil(async () => (await claimLockWaiters()) === 1, 'the second claim to queue on the ledger lock');

      // Queued, not deciding: the first claim's row is not even visible yet.
      await sleep(300);
      expect(secondDone).toBe(false);
      expect(await rows()).toBe(0);

      first.write('commit;\n');
      expect(decision(await first.end())).toEqual(SEND);
      expect(decision(await second)).toEqual({ decision: 'duplicate', status: 'pending' });
      expect(await rows()).toBe(1);
    }, 60_000);

    it('if the first claim rolls back, the queued one re-reads and sends — no phantom duplicate', async () => {
      const contentKey = nextHex();
      const first = pg.open(`begin;\nset role service_role;\n${claimSql({ contentKey })}`);
      await waitUntil(async () => (await claimLockHolders()) === 1, 'the first claim to hold the ledger lock');
      const second = pg.run(`set role service_role;\n${claimSql({ contentKey })}`);
      await waitUntil(async () => (await claimLockWaiters()) === 1, 'the second claim to queue on the ledger lock');

      first.write('rollback;\n');
      await first.end();
      expect(decision(await second)).toEqual(SEND);
      expect(await rows()).toBe(1);
    }, 60_000);

    it('NEGATIVE CONTROL: the same function with only the lock removed sends one code twice', async () => {
      const source = migrationSql(CLAIM_FUNCTION_MIGRATION).match(
        /create or replace function h5_claim_sms_dispatch\([\s\S]*?\n\$fn\$;/,
      )?.[0];
      expect(source, 'the claim function must be found in the migration').toBeTruthy();
      const lockLine = /^\s*perform pg_advisory_xact_lock\(hashtextextended\('h5_sms_dispatch', 0\)\);\r?\n/m;
      expect(source!).toMatch(lockLine);
      const unlocked = source!
        .replace('function h5_claim_sms_dispatch(', 'function h5_claim_sms_dispatch_unlocked(')
        .replace(lockLine, '');
      expect(unlocked).not.toMatch(/pg_advisory_xact_lock/);
      await pg.query(unlocked);

      try {
        const contentKey = nextHex();
        const first = pg.open(`begin;\n${claimSql({ contentKey }, 'h5_claim_sms_dispatch_unlocked')}`);
        await waitUntil(async () => (await count(
          "select count(*) from pg_stat_activity where state = 'idle in transaction';",
        )) === 1, 'the first unlocked claim to sit uncommitted');

        // Nothing to queue on: the second claim decides at once, blind to the first.
        const second = await pg.run(claimSql({ contentKey }, 'h5_claim_sms_dispatch_unlocked'));
        expect(decision(second)).toEqual(SEND);

        first.write('commit;\n');
        expect(decision(await first.end())).toEqual(SEND);
        // Two provider calls for one code — exactly what the lock exists to stop.
        expect(await rows()).toBe(2);
      } finally {
        await pg.query(
          'drop function if exists h5_claim_sms_dispatch_unlocked(text, uuid, text, text, text, text, text, text, integer);',
        );
      }
    }, 60_000);
  });

  describe("an owner asking again after losing its claim's reply", () => {
    it('queues behind its own first ask, then resumes that claim — while a replay queued with it gets the duplicate', async () => {
      const webhookId = nextWebhookId();
      const contentKey = nextHex();
      const owner = randomUUID();
      // The first ask, mid-commit: the hook stopped waiting for it.
      const first = pg.open(`begin;\nset role service_role;\n${claimSql({ webhookId, owner, contentKey })}`);
      await waitUntil(async () => (await claimLockHolders()) === 1, 'the first ask to hold the ledger lock');

      const again = pg.run(`set role service_role;\n${claimSql({ webhookId, owner, contentKey })}`);
      await waitUntil(async () => (await claimLockWaiters()) === 1, "the owner's second ask to queue");
      const replay = pg.run(`set role service_role;\n${claimSql({ webhookId, contentKey })}`);
      await waitUntil(async () => (await claimLockWaiters()) === 2, 'the replay to queue as well');

      first.write('commit;\n');
      // The first ask's reply goes to nobody: the hook acts on the second only.
      expect(decision(await first.end())).toEqual(SEND);
      expect(decision(await again)).toEqual(RESUMED);
      expect(decision(await replay)).toEqual({ decision: 'duplicate', status: 'pending' });
      expect(await rows()).toBe(1);
    }, 60_000);

    it('makes the claim itself when that first ask rolls back instead', async () => {
      const webhookId = nextWebhookId();
      const contentKey = nextHex();
      const owner = randomUUID();
      const first = pg.open(`begin;\nset role service_role;\n${claimSql({ webhookId, owner, contentKey })}`);
      await waitUntil(async () => (await claimLockHolders()) === 1, 'the first ask to hold the ledger lock');
      const again = pg.run(`set role service_role;\n${claimSql({ webhookId, owner, contentKey })}`);
      await waitUntil(async () => (await claimLockWaiters()) === 1, "the owner's second ask to queue");

      first.write('rollback;\n');
      await first.end();
      expect(decision(await again)).toEqual(SEND);
      expect(await rows()).toBe(1);
    }, 60_000);

    it('released at once with twelve replays and retries of its request, is still the only send', async () => {
      const webhookId = nextWebhookId();
      const contentKey = nextHex();
      const owner = randomUUID();
      // Committed; its reply never reached the hook.
      await pg.query(`set role service_role;\n${claimSql({ webhookId, owner, contentKey })}`);

      const decisions = await stampede([
        claimSql({ webhookId, owner, contentKey }),
        ...Array.from({ length: 6 }, () => claimSql({ webhookId, contentKey })),
        ...Array.from({ length: 6 }, () => claimSql({ contentKey })),
      ]);
      expect(decisions[0]).toEqual(RESUMED);
      expect(tally(decisions)).toEqual({ send: 1, duplicate: 12 });
      expect(await rows()).toBe(1);
    }, 120_000);
  });

  describe('a stampede of claimants released at the same instant', () => {
    it('one code, twelve claimants: exactly one send', async () => {
      const contentKey = nextHex();
      const decisions = await stampede(Array.from({ length: 12 }, () => claimSql({ contentKey })));
      expect(tally(decisions)).toEqual({ send: 1, duplicate: 11 });
      expect(await rows()).toBe(1);
    }, 120_000);

    it('one number, fourteen different codes: exactly ten sends, the rest capped', async () => {
      const decisions = await stampede(Array.from({ length: 14 }, () => claimSql({ contentKey: nextHex() })));
      expect(tally(decisions)).toEqual({ send: 10, capped: 4 });
      expect(await rows()).toBe(10);
    }, 120_000);

    it('a number with eight calls today, six claimants: exactly two more sends', async () => {
      for (let index = 0; index < 8; index += 1) {
        await pg.query(`set role service_role;\n${claimSql({ contentKey: nextHex() })}`);
      }
      const decisions = await stampede(Array.from({ length: 6 }, () => claimSql({ contentKey: nextHex() })));
      expect(tally(decisions)).toEqual({ send: 2, capped: 4 });
      expect(await rows()).toBe(10);
    }, 120_000);

    it('one webhook id replayed eight times at once: exactly one send', async () => {
      const webhookId = nextWebhookId();
      const decisions = await stampede(Array.from({ length: 8 }, () => claimSql({ webhookId, contentKey: nextHex() })));
      expect(tally(decisions)).toEqual({ send: 1, duplicate: 7 });
      expect(await rows()).toBe(1);
    }, 120_000);

    it('mid-rotation — old key, new key with previous, new key alone — one code is still sent once', async () => {
      const underA = { keyId: KEY_A, phoneKey: PHONE_UNDER_A, contentKey: nextHex() };
      const underB = { keyId: KEY_B, phoneKey: PHONE_UNDER_B, contentKey: nextHex() };
      const claims = [
        ...Array.from({ length: 4 }, () => claimSql(underA)),
        ...Array.from({ length: 4 }, () => claimSql({ ...underB, previous: underA })),
        ...Array.from({ length: 4 }, () => claimSql(underB)),
      ];
      const counts = tally(await stampede(claims));
      expect(counts.send).toBe(1);
      expect((counts.duplicate ?? 0) + (counts.unknown_key ?? 0)).toBe(11);
      expect(Object.keys(counts).every((name) => ['send', 'duplicate', 'unknown_key'].includes(name))).toBe(true);
      expect(await rows()).toBe(1);
    }, 120_000);
  });
});
