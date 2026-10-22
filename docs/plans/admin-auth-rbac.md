# Admin panel authentication, roles, audit and sessions

**Shipped:** W4-06 / W4-07 / W4-08, Batch 2, 2026-10-22 (`64c5f4b`, `e8455e4`,
`a2c196a`).
**Status:** CODE-COMPLETE. **Not deployed, no account provisioned.**

This is the reference for how the platform console authenticates people, what
each role may do, and what the panel records. It also states the three limits
honestly, because each one matters operationally.

---

## 1. What this replaced

A single shared `ADMIN_BASIC_AUTH_USER` / `ADMIN_BASIC_AUTH_PASSWORD` pair,
replayed by the browser on every request. It had no identity (every admin was
the same principal), no role, no session, no logout (a browser cannot be told to
forget a Basic Auth credential), no lockout, and no record of who looked at or
changed anything. The one thing it got right — failing closed with nothing
configured — is preserved.

Basic Auth is **retired, not merely unused**: `evaluateBasicAuth` is gone, and a
test asserts the module exports only `constantTimeEquals`, that no source reads
the two old variables, and that nothing sends a `WWW-Authenticate` challenge.

---

## 2. Where each piece runs, and why

| Piece | Runtime | Reads |
|---|---|---|
| `middleware.ts` | Edge, every request | the session cookie's HMAC-SHA256 and its two expiries, plus `ADMIN_ROLES`. **No password material** |
| `app/api/admin/session/route.ts` → `lib/adminLogin.ts` | Node, login only | `ADMIN_ACCOUNTS` (salts and hashes), verified with PBKDF2-SHA256 |
| `lib/adminRoles.ts` | both | the frozen role → permission table |
| `lib/adminAuthz.ts` | Node, per page and action | `requirePermission`, which throws and audits the denial |
| `lib/adminAudit.ts` | both | nothing; it WRITES one JSON line per event to stderr and keeps the last 200 in memory |
| `lib/adminActions.ts` | Node, on a write | the three write actions, each permission-gated and audited |

The split is deliberate. PBKDF2 does not exist in the Edge runtime, and running
a correctly expensive key-derivation function on every page request would itself
be a denial-of-service surface. So the expensive check happens once, at login,
in Node; every subsequent request verifies only a signature.

---

## 3. Credentials

Two environment variables, kept apart on purpose.

**`ADMIN_ACCOUNTS`** — a JSON array of `{ username, salt, hash }`. Salt is 32
hex characters (16 bytes), hash is 64 (32 bytes). Read **only** by
`lib/adminIdentity.ts`, in the Node runtime, at the one place a password is
verified. A plaintext `password` field anywhere in it is a **parse error**, not
a convenience, and so is a `role` field.

**`ADMIN_ROLES`** — a JSON object of `username → role`, and nothing else. Read
by the Edge middleware on every request. Keeping it hash-free is what lets the
middleware resolve a role without any password material in its reach.

Both are **cross-validated**: every account must have a role and every role must
have an account. A username in one and not the other is a startup failure, not a
login that succeeds and then has no authority.

Provisioning, without a plaintext password entering the repo, an env file in
git, or a shell history line:

```bash
node scripts/admin-hash-password.mjs founder     # password on stdin
```

It prints one `ADMIN_ACCOUNTS` element and the matching `ADMIN_ROLES` entry. It
reads the password from stdin, never from `argv` (a command line is visible in
the process table and kept by the shell's history), requires at least 12
characters, writes no file, and never prints the password back.

**Fails closed** on absent, empty, malformed, duplicate-username (including a
case-only difference), cross-variable mismatch, or unknown-role input: the panel
returns 503, exactly as it did with no Basic Auth configured.

---

## 4. The session

A signed, stateless cookie. No session table, therefore no migration.

| Property | Value |
|---|---|
| Name | `muthoy_admin_session` |
| Payload | `{ sub, role, iat, exp, lastSeen, epoch }`, base64url JSON |
| Signature | HMAC-SHA256 over the payload with `ADMIN_SESSION_SECRET` (≥32 bytes, enforced in bytes not characters) |
| Flags | `HttpOnly; Secure; SameSite=Strict; Path=/` |
| Absolute TTL | 8 hours from `iat` — a forgotten open tab stops being a key by end of shift |
| Idle TTL | 30 minutes from `lastSeen`, moved by the middleware re-signing the cookie |
| Revocation | `ADMIN_SESSION_EPOCH`; a payload with a different epoch is rejected |

The verifier checks the signature **before** reading any field of the payload as
data, and refuses: a tampered payload, a cookie signed with another secret, one
past its absolute expiry, one idle too long, one from a previous epoch, a
malformed shape even when correctly signed, and one whose own `iat`/`exp` pair
claims a longer life than the design allows — so a leaked secret cannot also buy
an unbounded session.

`SameSite=Strict` is the CSRF defence for the write actions; a platform console
has no cross-site flow to break.

---

## 5. Roles and permissions

One frozen table in `lib/adminRoles.ts`, and one choke point.

| Role | Permissions |
|---|---|
| `super_admin` | every permission below |
| `billing` | `shops.read`, `accounts.read`, `subscriptions.read`, `subscriptions.write`, `payments.read`, `audit.read` |
| `support` | `shops.read`, `accounts.read`, `subscriptions.read`, `payments.read`, `support.write` |
| `read_only` | `shops.read`, `accounts.read`, `subscriptions.read`, `payments.read` |

**`billing` and `support` are not ordered.** `billing` holds
`subscriptions.write` and `support` does not; `support` holds `support.write`
and `billing` does not. Neither is "lower", so any ranking imposed on them would
preserve a permission the other role never had. That is why a role mismatch is
resolved by taking `ADMIN_ROLES` as authoritative rather than by comparing
ranks. If a future requirement genuinely needs both consulted, the correct
operation is the **intersection** of their permission sets, never a rank
comparison.

**`ADMIN_ROLES` is authoritative and re-read on every request.** Consequences:

- Removing a username from it denies that account's **next** request, even
  though a validly signed, unexpired cookie is still in the browser.
- Demoting an account takes effect on the next request, not at next login.
- The cookie's own `role` claim grants nothing. It exists only so a mismatch can
  be audited.

Permission lookups use an own-property guard, so an inherited name such as
`constructor` cannot resolve to a truthy value and hand out a permission nobody
granted. A test drives `constructor`, `__proto__`, `toString`,
`hasOwnProperty` and `valueOf` through both the role and the permission
position.

Enforcement is server-side in every case: `requirePermission` is the first
statement of every page and every action, a Server Component that throws renders
the 403 notice, and an action that throws never reaches a query. The navigation
hides links a role cannot use, which is presentation — typing the URL is still
refused.

---

## 6. Login throttling

Two independent throttles, because one keyed on the supplied username is
bypassed by rotating usernames.

1. **Per-username:** exponential backoff (1s, 2s, 4s … capped at 60s) and a
   15-minute lockout after 10 failures. Only KNOWN usernames get an entry, so an
   attacker cannot grow the map with invented names.
2. **Per-source:** 30 attempts per 15-minute window per client IP
   (`x-forwarded-for`'s first hop, falling back to `cf-connecting-ip`), keyed on
   nothing the caller supplies in the body, reusing the bucket shape
   `payment-webhook/handler.ts` already uses. Rotating usernames consumes this
   budget, so enumeration stays bounded even when every name is unknown. This
   check runs **before** the KDF, so a flood cannot spend CPU without spending
   budget.

**The backoff is a cooldown WINDOW, not an awaited sleep** — a deliberate
deviation from the plan. Sleeping up to 60 seconds inside a serverless handler
holds a worker and can exceed the platform's function timeout, which would make
the delay a self-inflicted denial of service. An attempt inside the window is
refused instead, which bounds attempts identically without holding a request
open. The refusal still runs the KDF, because short-circuiting there would make
"known username in cooldown" measurably faster than "unknown username".

Login is **not a username oracle**: an unknown username runs the same 600,000-
iteration PBKDF2 against a fixed dummy salt and hash, and every failure returns
byte-identical bytes — same status, same body, same headers, no cookie. Only the
audit log distinguishes the causes, server-side.

---

## 7. The audit log

`recordAdminAction({ actor, role, action, target, outcome, meta })`.

Recorded: every write action, every authorization denial, every login success and
failure, every logout, every stale-role-claim mismatch, and every session whose
role was revoked. **Not** recorded: list-page views — with no durable store,
auditing every page view produces the noise that hides the writes.

**Redaction is by allowlist.** `meta` keys outside `ALLOWED_META_KEYS` are
dropped, so the service-role key, the session secret, a password hash, a salt, a
bKash credential, an `authorization` header and a customer phone number are
structurally unable to reach the sink — a new field has to be let in
deliberately. Values are scalars only, length-capped, and scrubbed for anything
shaped like a Bangladeshi phone number or a long opaque token, because an
allowed free-text key such as `reason` could otherwise carry one.

The scrubber is anchored so it cannot damage the record it protects: a UUID
target survives intact, which four regression tests pin.

---

## 8. The three honest limits

Each of these is a real operational constraint, not a caveat.

1. **Session revocation is all-or-nothing, and environment-bound.** Bumping
   `ADMIN_SESSION_EPOCH` invalidates every live session; there is no per-user
   revoke until the Batch 3 session table. And because it is an environment
   change, on a host like Vercel it takes effect through deployment
   propagation — "immediate" means immediate once the new environment is live.
2. **Both login throttles are per-instance module state.** A multi-instance
   deployment multiplies both allowances by the instance count. The real rate
   limit belongs at the edge/host layer and is an external gate.
3. **The `/audit` page is in-memory and per-instance.** It holds the most recent
   200 entries from one server instance: a restart clears it and another
   instance has its own. **stderr is the record of account**, kept by the host
   platform's log retention. The page says so in the UI. A Postgres audit table
   lands in Batch 3, and because the sink is an interface, adding it changes no
   call site.

---

## 9. Write actions

Three, each permission-gated, audited and idempotent. See
`docs/plans/muthoy-batch-2-implementation-2026-10-21.md` §4 for the table and
the guarantees. The short version: two call existing `SECURITY DEFINER` RPCs
that already carry their invariants, the third performs the exact guarded status
transition the server already performs on its own, and nothing else in
`apps/admin` may write to a table at all — a source-level test allows exactly
one call site, and an effective-ACL pgtest proves `service_role` holds no write
on `shops` or `sales`.

---

## 10. What has NOT happened

- No Vercel deployment, and no admin account provisioned.
- The founder's local `.env.local` still holds the retired Basic Auth
  variables; the four new ones must be added or the panel answers 503. See
  `apps/admin/README.md`.
- The admin read-grant migration (`20260817000000`) is still undeployed, so the
  pages have never been loaded against live Supabase.
- No write action has been executed against live data.
