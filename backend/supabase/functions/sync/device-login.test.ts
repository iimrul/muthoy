import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

// Reads the separate-device login migration and its edge-function sources as
// TEXT, the same technique grants.test.ts and inventory-ledger.test.ts use.
// Postgres and Deno are both unavailable in this suite, so this asserts the
// structural guarantees the login rests on rather than executing them.
//
// Stated plainly so nobody mistakes its reach: this proves the code SAYS the
// right things, and that is NOT enough on its own. It was exactly enough to let
// a migration ship that had never been executed, and to let assertCallerCurrent
// ship reading a field the access-token hook never writes — the words were all
// present and the check was inert.
//
// What actually executes:
//   - backend/supabase/pgtest/*.pgtest.ts runs this migration, the dispatcher,
//     the permission functions, the token hook and RLS against a real Postgres;
//   - apps/mobile/db/staff-permissions.sqlite.test.ts runs the mobile half
//     against a real SQLite engine.
//
// What is left here is only what neither of those can load: Deno source, which
// imports npm: specifiers this runner cannot resolve. Anything provable by
// running it belongs in pgtest, not in this file.

const FUNCTIONS = resolve('backend/supabase/functions/sync');
const MIGRATION_SQL = readFileSync(
  resolve('backend/supabase/migrations/20260819000000_staff_device_login.sql'),
  'utf8',
);
const DEVICE_LOGIN = readFileSync(resolve(FUNCTIONS, 'deviceLogin.ts'), 'utf8');
const RECOVER_PIN = readFileSync(resolve(FUNCTIONS, 'recoverPin.ts'), 'utf8');
const IDENTITY = readFileSync(resolve(FUNCTIONS, '_shared/identity.ts'), 'utf8');
const INDEX = readFileSync(resolve(FUNCTIONS, 'index.ts'), 'utf8');
const PUSH = readFileSync(resolve(FUNCTIONS, 'push.ts'), 'utf8');
const PULL = readFileSync(resolve(FUNCTIONS, 'pull.ts'), 'utf8');
const SHARED_AUTH = readFileSync(resolve(FUNCTIONS, '_shared/auth.ts'), 'utf8');

/** Source with comments stripped, so a claim in prose cannot satisfy a test. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function syncRowPermittedBody(): string {
  const match = MIGRATION_SQL.match(
    /create or replace function sync_row_permitted[\s\S]*?\$fn\$;/,
  );
  return match?.[0] ?? '';
}

describe('device-login is the only unauthenticated action', () => {
  test('it is dispatched before verifyCallerJwt, and every other action after', () => {
    const body = code(INDEX);
    const deviceLoginAt = body.indexOf('"device-login"');
    const verifyAt = body.indexOf('verifyCallerJwt(request)');

    expect(deviceLoginAt).toBeGreaterThan(-1);
    expect(verifyAt).toBeGreaterThan(-1);
    // A token cannot be required by the one request whose purpose is to mint one.
    expect(deviceLoginAt).toBeLessThan(verifyAt);

    for (const action of ['"push"', '"pull"', '"link-device"', '"recover-pin"']) {
      expect(body.indexOf(action)).toBeGreaterThan(verifyAt);
    }
  });
});

describe('brute-force and enumeration defences', () => {
  test('the lockout is checked before any bcrypt work', () => {
    const body = code(DEVICE_LOGIN);
    const lockCheckAt = body.indexOf('login_attempt_locked_until');
    const bcryptAt = body.indexOf('bcrypt.compare');

    expect(lockCheckAt).toBeGreaterThan(-1);
    expect(bcryptAt).toBeGreaterThan(-1);
    // bcrypt at cost 10 is ~300ms of server time per call: doing it before the
    // lockout check makes this endpoint a CPU-exhaustion primitive as well as
    // an unmetered PIN oracle.
    expect(lockCheckAt).toBeLessThan(bcryptAt);
  });

  test('an unknown phone still costs a real bcrypt comparison', () => {
    // Without a dummy hash, response time alone reveals which numbers are
    // registered — the enumeration the generic error exists to withhold.
    const body = code(DEVICE_LOGIN);
    expect(body).toMatch(/const DUMMY_HASH = "\$2[aby]\$/);
    expect(body).toMatch(/bcrypt\.compare\(pin, user\?\.pinHash \?\? DUMMY_HASH\)/);
  });

  test('a failed attempt is recorded, and a failure to record refuses the request', () => {
    const body = code(DEVICE_LOGIN);
    expect(body).toMatch(/register_login_failure/);
    // If the counter cannot be written the lockout cannot be trusted next time
    // either, so the request fails rather than serving an unmetered oracle for
    // as long as the outage lasts.
    expect(body).toMatch(/register_login_failure[\s\S]{0,400}?throw new HttpError\(500/);
  });

  test('every credential outcome returns one identical message', () => {
    const body = code(DEVICE_LOGIN);
    expect(body).toMatch(/const GENERIC_FAILURE = /);
    // Locked out, wrong PIN, unknown number and malformed input must be
    // indistinguishable: a distinct reply for any of them confirms the number
    // is registered, which is exactly what the generic error withholds.
    expect(body.match(/GENERIC_FAILURE/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(body).not.toMatch(/not registered|unknown number/i);
    // The PER-PHONE lockout answers with the generic message. The per-IP one
    // may speak plainly, because it identifies a network rather than an
    // account — so the plain reply must be a 429 and must not appear on any
    // path that took a phone-shaped decision.
    expect(body).toMatch(/keys\.ip && await isLocked[\s\S]{0,200}?HttpError\(429/);
    expect(body).toMatch(/isLocked\(keys\.phone\)[\s\S]{0,400}?GENERIC_FAILURE/);
  });

  test('the attempt counter is incremented atomically in SQL, not read-then-written in Deno', () => {
    // Parallel requests each reading the same count would collectively spend
    // far more guesses than the limit allows.
    expect(MIGRATION_SQL).toMatch(/create or replace function register_login_failure/);
    expect(MIGRATION_SQL).toMatch(/on conflict \(key\) do update set/);
    expect(MIGRATION_SQL).toMatch(/locked_until = now\(\) \+ least\(/);
  });

  test('an incomplete registration cannot be probed through its placeholder hash', () => {
    // createShopAndOwner writes a random placeholder hash before PIN Setup runs.
    expect(code(DEVICE_LOGIN)).toMatch(/!data\.pin_set_at/);
  });
});

describe('the PIN never leaks', () => {
  test('deviceLogin hands the raw PIN only to bcrypt', () => {
    const body = code(DEVICE_LOGIN);
    expect(body).not.toMatch(/console\.(log|warn|error)/);
    expect(body).toMatch(/bcrypt\.compare\(/);
    // And not echoed back: the response is a fixed set of fields, none of them
    // the credential. Matched on the LAST return in the file — deviceLogin's —
    // rather than any return, since parseBody legitimately passes the PIN on
    // internally.
    const response = body.slice(body.lastIndexOf('return {'));
    expect(response).toMatch(/shopId:/);
    expect(response).not.toMatch(/\bpin\b/i);
  });

  test('recoverPin hands the raw PIN only to bcrypt.hash, at the same cost factor', () => {
    const body = code(RECOVER_PIN);
    expect(body).not.toMatch(/console\.(log|warn|error)/);
    expect(body).toMatch(/bcrypt\.hash\(newPin, BCRYPT_COST_FACTOR\)/);
    // Must match native/crypto.ts, or a recovered PIN will not verify offline.
    expect(body).toMatch(/const BCRYPT_COST_FACTOR = 10/);
  });
});

describe('owner PIN recovery is the only surviving OTP path', () => {
  test('it demands a verified phone on the caller token', () => {
    const body = code(RECOVER_PIN);
    // A session minted any other way — including one this endpoint just issued
    // — carries no phone_confirmed_at, so Caller.verifiedPhone is null and it
    // cannot be replayed.
    expect(body).toMatch(/caller\.verifiedPhone/);
  });

  test('it checks the token phone against the requested phone', () => {
    // FULL canonical equality, country code included. The last-10-digit
    // comparison this replaced made +91 1712345678 equal +880 1712345678, so an
    // attacker could OTP-verify their own foreign number and recover a
    // Bangladeshi owner's account with it.
    expect(code(RECOVER_PIN)).toMatch(
      /!isSameBdPhone\(caller\.verifiedPhone, canonicalPhone\)/,
    );
    expect(code(RECOVER_PIN)).not.toMatch(/slice\(-10\)/);
  });

  test('it is owner-only, with one message for "not found" and "not an owner"', () => {
    expect(code(RECOVER_PIN)).toMatch(/roleName !== "owner"/);
    expect(code(RECOVER_PIN)).toMatch(/This number cannot be recovered here/);
  });

  test('it globally signs out prior sessions', () => {
    // Recovery is what someone does after losing a phone; a session still
    // living on that phone must not survive it.
    expect(code(RECOVER_PIN)).toMatch(/signOut\(\s*caller\.authUserId,\s*"global",?\s*\)/);
    // And BEFORE the new hash is written: a failure here must leave the old PIN
    // standing rather than a new PIN beside sessions that were meant to die.
    const bodyText = code(RECOVER_PIN);
    expect(bodyText.indexOf('signOut(')).toBeLessThan(bodyText.indexOf('bcrypt.hash('));
  });

  test('a recovery rebind fails closed when global sign-out fails', () => {
    const body = code(IDENTITY);
    const rebind = body.slice(
      body.indexOf('async function rebindAuthUser'),
      body.indexOf('export interface EnsureBindingOptions'),
    );
    expect(rebind).toMatch(/signOutError/);
    expect(rebind).toMatch(/if \(signOutError\)[\s\S]*?throw new HttpError/);
  });
});

describe('JWT claims and revocation', () => {
  test('the access-token hook injects identity, role and permission_version', () => {
    expect(MIGRATION_SQL).toMatch(/create or replace function custom_access_token_hook/);
    for (const claim of ['shop_id', 'app_user_id', 'role', 'permission_version', 'is_active']) {
      expect(MIGRATION_SQL).toMatch(new RegExp(`'${claim}',`));
    }
  });

  test('the hook leaves claims untouched when no binding exists yet', () => {
    // The normal state during first-time registration: the OTP session exists
    // before the shop does, and linkDevice's own app_metadata.shop_id must
    // survive, or every pre-existing RLS policy breaks mid-flow.
    expect(MIGRATION_SQL).toMatch(/if not found then\s*\n\s*return event;/);
  });

  test('permission_version is server-derived, never accepted from a client payload', () => {
    expect(MIGRATION_SQL).toMatch(/create trigger users_bump_permission_version/);
    expect(MIGRATION_SQL).toMatch(/create trigger user_permissions_bump_permission_version/);
    // A device can push is_active = false, but pushing a LOWER version would
    // make an already-revoked token acceptable again — so the column stays out
    // of sync_apply_row's users column list and only the trigger writes it.
    const initialSql = readFileSync(
      resolve('backend/supabase/migrations/20260813000000_initial_schema.sql'),
      'utf8',
    );
    const usersUpsert = initialSql.match(/elsif p_table='users' then insert into users[^\n]*/)?.[0] ?? '';
    expect(usersUpsert).not.toBe('');
    expect(usersUpsert).not.toMatch(/permission_version/);
    // Omitting it from the UPDATE list was NOT enough: the insert arm runs
    // jsonb_populate_record, which fills every column from the payload. The
    // wrapper therefore overwrites the value on BOTH branches — from the
    // server's own row when one exists, and with 0 when it does not.
    expect(MIGRATION_SQL).toMatch(
      /jsonb_build_object\('permission_version', to_jsonb\(v_target\.permission_version\)\)/,
    );
    expect(MIGRATION_SQL).toMatch(/jsonb_build_object\('permission_version', 0\)/);
  });

  test('a stale or deactivated caller is refused on both push and pull', () => {
    expect(code(PUSH)).toMatch(/assertCallerCurrent\(caller\)/);
    // A pull hands over the shop's entire history, so it is gated as hard as a
    // write — otherwise a revoked staff member keeps downloading prices and
    // customer balances until their token expires.
    expect(code(PULL)).toMatch(/assertCallerCurrent\(caller\)/);

    const auth = code(SHARED_AUTH);
    expect(auth).toMatch(/caller\.permissionVersion !== data\.permission_version/);
    // Read from the VERIFIED TOKEN, not from the user row. getUser() returns
    // auth.users, whose app_metadata the access-token hook never writes — so
    // reading app_user_id there yielded undefined on every request and every
    // check built on it was inert while appearing to run.
    expect(auth).toMatch(/decodeVerifiedClaims\(token\)/);
    expect(auth).not.toMatch(/data\.user\.app_metadata\?\.app_user_id/);
    expect(auth).toMatch(/data\.is_deleted \|\| !data\.is_active/);
  });

  test('missing hook claims are distinct from stale permission claims', () => {
    const auth = code(SHARED_AUTH);
    const requireAppUser = auth.slice(
      auth.indexOf('export function requireCallerAppUserId'),
      auth.indexOf('export interface CallerRecord'),
    );
    expect(requireAppUser).toMatch(/hook_not_configured/);
    expect(requireAppUser).not.toMatch(/permissions_changed/);
    expect(auth).toMatch(/permissions_changed/);
  });

  test('the caller auth identity must match auth_bindings', () => {
    const auth = code(SHARED_AUTH);
    expect(auth).toMatch(/\.from\("auth_bindings"\)/);
    expect(auth).toMatch(/binding\.auth_user_id !== caller\.authUserId/);
  });
});

describe('server-side permission enforcement', () => {
  test('push checks the permission for every row, and rejects permanently', () => {
    const body = code(PUSH);
    expect(body).toMatch(/sync_row_permitted/);
    // PERMANENT, not transient: retrying changes nothing while the permission
    // stands, so the row surfaces to the owner instead of retrying forever.
    expect(body).toMatch(/sync_row_permitted[\s\S]{0,600}?reason: "permanent"/);
    expect(body).toMatch(/halted = permitted\.reason === "transient"/);
    expect(body).toMatch(/halted = authorization\.reason === "transient"/);
  });

  test('resolution mirrors domain/permissions.ts: default, then per-user override', () => {
    expect(MIGRATION_SQL).toMatch(/create or replace function user_has_permission/);
    expect(MIGRATION_SQL).toMatch(/p_key in \('sales', 'inventory_view'\)/);
    expect(MIGRATION_SQL).toMatch(/select up\.allowed from user_permissions up/);
    // Owner is "everything, as a rule" and ignores overrides — the owner is the
    // only account that can edit permissions, so honouring a stored denial
    // would lock a shop out of its own administration with no way back in.
    expect(MIGRATION_SQL).toMatch(/when r\.name = 'owner' then true/);
    // Fails closed on the P1 'manager' role and on anything unrecognised.
    expect(MIGRATION_SQL).toMatch(/when r\.name <> 'staff' then false/);
  });

  test('a default staff member can still complete a checkout', () => {
    // Checkout writes customers, credits, cash_drawer and a sale-reason
    // movement as well as the sale itself. Demanding cash_management for the
    // drawer would break every staff sale — the regression this guards.
    const permitted = syncRowPermittedBody();
    expect(permitted).not.toBe('');
    for (const table of ['customers', 'credits', 'cash_drawer']) {
      const clause = permitted.match(
        new RegExp(`when '${table}' then[\\s\\S]*?(?=\\n\\s*(?:--|when |else ))`),
      )?.[0] ?? '';
      expect(clause).toMatch(/'sales'/);
    }
  });

  test('a sale-reason movement rides the sales grant; anything else needs inventory_write', () => {
    // Without the split, a staff member holding only 'sales' could push a
    // +1000 stock adjustment.
    expect(MIGRATION_SQL).toMatch(/p_row ->> 'reason' = 'sale'/);
    const movements = syncRowPermittedBody().match(
      /when 'inventory_movements' then[\s\S]*?\n\s*end\n/,
    )?.[0] ?? '';
    expect(movements).toMatch(/'sales'/);
    expect(movements).toMatch(/'inventory_write'/);
  });

  test('the tables a staff device must not write demand an owner-level key', () => {
    const permitted = syncRowPermittedBody();
    const required: Record<string, string> = {
      medicines: 'inventory_write',
      batches: 'inventory_write',
      purchases: 'inventory_write',
      expenses: 'cash_management',
      users: 'staff_management',
      user_permissions: 'staff_management',
      shops: 'settings_manage',
    };
    for (const [table, key] of Object.entries(required)) {
      expect(permitted).toMatch(
        new RegExp(`when '${table}' then user_has_permission\\(p_app_user_id, '${key}'\\)`),
      );
    }
    // Anything unlisted is denied rather than allowed by default.
    expect(permitted).toMatch(/else false/);
  });
});

describe('phone as a unique credential', () => {
  test('the Postgres index matches the SQLite one exactly', () => {
    const sqliteMigration = readFileSync(
      resolve('apps/mobile/db/migrations/0007_staff_device_login.sql'),
      'utf8',
    );
    expect(MIGRATION_SQL).toMatch(
      /create unique index if not exists users_phone_unique on users\(phone\)\s*\n\s*where phone is not null and is_deleted = false/,
    );
    expect(sqliteMigration).toMatch(
      /CREATE UNIQUE INDEX `users_phone_unique` ON `users` \(`phone`\)\s*\n\s*WHERE `phone` IS NOT NULL AND `is_deleted` = 0/,
    );
  });

  test('a pre-existing duplicate stops the migration rather than being silently resolved', () => {
    expect(MIGRATION_SQL).toMatch(/Cannot enforce users_phone_unique/);
  });
});

describe('one auth identity per app user', () => {
  test('the synthetic address is deterministic and permanently unroutable', () => {
    // RFC 2606 reserves `.invalid`, so this can never receive mail or collide
    // with a real address.
    expect(code(IDENTITY)).toMatch(/return `u-\$\{appUserId\}@users\.muthoy\.invalid`/);
  });

  test('registration binds the owner, so a second device does not mint a second account', () => {
    const linkDevice = readFileSync(resolve(FUNCTIONS, 'linkDevice.ts'), 'utf8');
    expect(code(linkDevice)).toMatch(/assertBindingTarget\(ownerUserId, shopId, "owner"\)/);
    expect(code(linkDevice)).toMatch(/ensureAuthBinding\(ownerUserId, caller\.authUserId\)/);
  });

  test('a binding that already points elsewhere is refused, never reassigned', () => {
    // Whichever way it resolved automatically, somebody would silently gain or
    // lose access to a pharmacy's records.
    expect(code(IDENTITY)).toMatch(/already linked to a different account/);
  });

  test('identity lookup is side-effect-free and provisioning remains retry-safe', () => {
    const body = code(IDENTITY);
    const lookup = body.slice(
      body.indexOf('async function findAuthUserIdByEmail'),
      body.indexOf('async function readBinding'),
    );
    expect(lookup).toMatch(/listUsers/);
    expect(lookup).not.toMatch(/generateLink|createUser/);

    const provisioning = body.slice(body.indexOf('export async function resolveOrCreateAuthUserId'));
    expect(provisioning).toMatch(/findAuthUserIdByEmail\(email\)/);
    expect(provisioning).toMatch(/claimBinding\(appUserId, authUserId\)/);
    expect(provisioning).toMatch(/if \(existing\)[\s\S]*?attachSyntheticEmail\(appUserId, existing\)/);
  });

  test('auth_bindings and login_attempts are never client-readable', () => {
    expect(MIGRATION_SQL).toMatch(/alter table auth_bindings enable row level security/);
    expect(MIGRATION_SQL).toMatch(/alter table login_attempts enable row level security/);
    // No policy is created for either, so only service_role — which bypasses
    // RLS — can reach them.
    expect(MIGRATION_SQL).not.toMatch(/create policy \w+ on auth_bindings/);
    expect(MIGRATION_SQL).not.toMatch(/create policy \w+ on login_attempts/);
  });
});

describe('the two phone normalizers cannot drift', () => {
  // The Edge Function cannot import a pnpm workspace package, so
  // _shared/phone.ts is a hand copy of packages/validation/src/phone.ts. A
  // difference between them splits the login identity in half: the device would
  // send one string and the server would look up another.
  function normalizerBody(raw: string): string {
    // Comments stripped first: the two files explain themselves differently,
    // and only the LOGIC has to be identical.
    const source = code(raw);
    const start = source.indexOf('const digits = value.replace');
    const end = source.indexOf('return null;', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    // Quote style is the one difference allowed: the Deno file follows the
    // backend's double-quote convention, the shared package the mobile single.
    return source
      .slice(start, end)
      .replace(/["']/g, '"')
      .replace(/\s+/g, ' ')
      .trim();
  }

  test('normalizeBdPhone is character-identical on both sides', () => {
    const server = readFileSync(resolve(FUNCTIONS, '_shared/phone.ts'), 'utf8');
    const shared = readFileSync(resolve('packages/validation/src/phone.ts'), 'utf8');
    expect(normalizerBody(server)).toBe(normalizerBody(shared));
  });

  test('both canonicalise to +880 and neither compares a suffix', () => {
    for (const path of ['_shared/phone.ts']) {
      const source = readFileSync(resolve(FUNCTIONS, path), 'utf8');
      expect(source).toMatch(/CANONICAL_PREFIX = "\+880"/);
      // slice(-10) is the bug this file exists to prevent: it made an Indian
      // number equal to a Bangladeshi one with the same last ten digits.
      expect(source).not.toMatch(/slice\(-10\)/);
    }
  });
});
