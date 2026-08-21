# sync/

The only mobile boundary that talks to Supabase. It owns persisted Supabase
Auth, OTP, device linking, ordered outbox push, composite-cursor pull, retry
backoff, connectivity triggers, and the foreground scheduler.

SQLite remains the source of truth for every screen. Pulled rows are applied
through `db/sync-helpers.ts` and are never re-enqueued.

Required Expo environment variables are documented in `../.env.example`.
Without them background sync safely no-ops; foreground OTP calls fail loudly.

## Separate-device login (migration 0007)

`deviceAuth.ts` is the fresh-device entry point: phone + PIN, verified by the
server, because a device with an empty SQLite has no local hash to check against.
It is ORCHESTRATION ONLY — `pullChanges(shopId, null)` does the hydration,
`db/auth.ts`'s exact-user verifier checks only the hydrated identity and builds the session, and
`sessionStore`'s `login()` bumps the epoch everything else already keys off.
Once it has run, the device is enrolled and every later login is the existing
offline PIN-only path: no network, no phone re-entry.

Full hydration remains required before fresh-device entry. The post-hydration
check performs one native bcrypt comparison against the server-verified user,
not a scan of every local user. Initial sync is scheduled after navigation
interactions; required hydration is not. Enrolled PIN login never invokes Edge,
Supabase, hydration, or sync before navigation. Staff creation similarly
commits SQLite + permissions + outbox first, navigates, then triggers sync.

`device-login` is the ONE unauthenticated action on the edge function — it is
what mints the token every other action requires — and is dispatched before
`verifyCallerJwt` for exactly that reason. It is rate-limited in SQL before any
bcrypt work (bcrypt at cost 10 is ~300ms of server time, so the lockout is a
CPU-exhaustion guard as much as a brute-force one), and answers every credential
outcome with one identical message so registered numbers cannot be enumerated.

Sessions are minted through a synthetic, non-routable email identity
(`_shared/identity.ts`): Supabase Auth exposes no admin API for minting a session
against a PHONE identity without sending an SMS. Identity existence checks use
the read-only admin user listing; `generateLink` is reserved for minting a real
session after the PIN/OTP proof succeeds. `auth_bindings` keeps ONE auth
identity per app user across both entry points.

OTP survives in exactly one place — `recover-pin`, owner-only, for when the PIN
itself is what was lost. Staff PINs are reset by their owner instead.

Push and pull both call `assertCallerCurrent`, which refuses a token whose
`permission_version` differs from the database. The client refreshes and retries
that request once without consuming outbox attempts. Missing hook claims are a
distinct `hook_not_configured` halt, not a refresh loop. Push additionally
checks `sync_row_permitted` per row, so a tampered client cannot write rows its
user has no permission for — until 0007 the only permission check in the system
lived in the client, which a tampered client simply does not run.

Those claims are read by DECODING THE VERIFIED TOKEN, never off the auth user
row. `custom_access_token_hook` writes `event.claims.app_metadata`, which exists
only inside the JWT; `supabaseAdmin.auth.getUser(token)` returns the `auth.users`
ROW, whose `app_metadata` nothing ever copies those claims into. Reading
`app_user_id` there yielded `undefined` on every request — so every check built
on it was inert while its tests, which matched on source text, stayed green.
`_shared/auth.ts` verifies through GoTrue and then reads the claims of that same
accepted token.

Server-side authorization is TARGET-AWARE, not merely caller-aware. `push`
passes the caller's `app_user_id` into `sync_apply_row`, which is what lets SQL
answer the questions a per-table permission cannot: only an owner may write the
owner's row; `role_id`, `pin_hash` and `is_active` on somebody else's row are
preserved from the server rather than taken from the payload;
`permission_version` is stripped by the client and overwritten on insert as
well as update; only an owner
may change `user_permissions`; a staff caller may only attribute a row to
themselves; and a `reason='sale'` movement must reduce stock. Without those,
`staff_management` — a checkbox the owner's own UI offers — was a promotion to
owner.

A users row that revokes somebody (deactivation, role change, another user's
PIN reset) also triggers a global sign-out. Changing only the caller's own PIN
keeps that caller's refresh token usable; the stale access token refreshes once.
Deactivation and deletion flags are monotonic on the server, so a newer offline
profile payload cannot reactivate or resurrect the account.

Phone is canonicalised to `+8801XXXXXXXXX` at every write, lookup and lockout
key (`packages/validation/src/phone.ts`, mirrored in `_shared/phone.ts`). Stored
as typed it was three strings for one subscriber, which let one person hold
several accounts and gave an attacker three separate lockout budgets. The
lockout itself is keyed per phone AND per IP: the phone budget guards the
account, the IP budget is what stops an attacker walking a list of numbers and
spending ~300ms of server bcrypt per request without tripping anything.

## Inventory ledger hydration

`batches.stock` is a derived ledger projection (see `../db/README.md`'s
"Inventory ledger" section and `DECISIONS.md`'s 2026-08-18 entry), so pull
ordering matters here specifically: `HYDRATION_TABLE_ORDER` applies to BOTH
`pullFullHydration` and incremental `pullIncremental`, and full hydration for
a fresh device runs as one transaction — a device is never left observing a
partially-applied ledger mid-sync. An offline oversell is pulled and kept as
written (`oversold_at` set), never silently corrected by hydration.

`realtime.ts` subscribes to `batches` per shop purely as a pull TRIGGER — the
changed-row payload itself is discarded, and receipt just re-runs the existing
incremental pull. This keeps exactly one apply path (this pull → `db/
sync-helpers.ts`) responsible for FK ordering, LWW, and ledger idempotency;
applying realtime payloads directly would fork that logic into a second place.
