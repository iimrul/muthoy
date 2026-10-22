# Muthoy POS — Batch 2 complete implementation plan

**Status:** **GATE 2 — six review rounds completed, all `PLAN REVISE`. Revision 7 applies
round 6's findings. The design has converged; what remained in round 6 was two substantive
gaps (both fixed) plus stale text from my own earlier edits, now purged systematically.**
Revision 7.

**Scope as it now stands: 7 executable tasks.** W4-09 (bKash) is **BLOCKED and not
implemented** by founder decision — the official contract has three undocumented
security-relevant gaps, on top of E4, credentials, the unpublished live URL and a
three-phase rollout (§7.5). W5-16 (barcode) is **held** on decision Q1 (§6.2.1). One
sub-item of W2-01 — cleaning up the prescription capture on the `captureOnly` path — is
**descoped to gate E9** after five designs each proved unsafe against money- and sync-path
code this batch may not redesign (§6.2.2).

The independent Codex review ran on 2026-10-22 (`gpt-5.6-sol`, `high` effort) after two
earlier attempts failed — one killed by a session boundary at 639 KB, one on
`You've hit your usage limit … try again at Oct 22nd, 2026 12:36 AM`. Verdict:
**`PLAN REVISE`, 12 findings — 3 CRITICAL, 6 HIGH, 3 MEDIUM.** I re-verified every finding
against the code rather than accepting it, and **all 12 held.** §14 logs each with the
evidence and its disposition.

**Product implementation has still not started**, and will not until the delta review
returns `PLAN ACCEPT`. Two of the three CRITICALs would have shipped real defects —
bKash rejecting *every* payment on an identifier mismatch, and a prescription-attachment
deletion that fires before anything copies the file. The third would have shipped two
SQLite migrations that never run. Revision 2's own self-review caught four other defects
and missed these three, which is the argument for the gate rather than against it.
**Date:** 2026-10-22 (revision 3; revisions 1–2 dated 2026-10-21)
**Baseline:** `HEAD` = `origin/main` = `51c5230e622b2ff5e1ca0c859fdf541a3131cc4c` (verified
against the remote, not assumed). Working tree carries **41** uncommitted pre-existing
paths — 3 modified, 38 untracked — all H-9/prototype work this batch must preserve and must
never stage (§11.3).

> **The count has been wrong twice; this is the derivation.** Revision 1 said 42, revision 2
> "corrected" it to 40, and review finding 10 showed both were wrong. Default
> `git status --porcelain` **collapses** `apps/prototype-web/Muthoy (prototype)/.expo/` into
> one entry, but that directory holds **two** untracked files (`README.md`,
> `devices.json`). The authoritative command for an exclusion manifest is
> `git status --porcelain=v1 --untracked-files=all`, which reports **42** total and **41**
> excluding this plan. `muthoy-batch-1-plan.md`'s recorded "40" is the same collapsed
> artefact and is not a cross-check. **Every manifest in §11.3 is generated from `-uall`.**
**Scope:** one cohesive Batch 2 covering **7 executable task IDs** — W4-09 BLOCKED (§7.5)
and W5-16 held on founder decision Q1 (§6.2.1). No sub-batches, no mini-sprints, no separate execution plans.
Batch 3 is not started.

> **Three of the six founder-assigned scope areas cannot reach live operation inside this
> batch, and the reason is the same in every case: a Postgres migration. The H-9 seal pins
> the chain at exactly 34.** §9 states each constraint precisely, names the exact line of
> SQL that blocks it, and shows that the shipped state is nevertheless *safe* — because
> every blocked path is unreachable without credentials that do not exist. Nothing is
> quietly deferred and nothing is worked around.

---

## 0. Ground rules this plan obeys

| Rule | How this plan satisfies it |
|---|---|
| CLAUDE.md 1 — SQLite is the only source of truth for app screens | the medicine catalog, its FTS index, its importer and every search path are SQLite-local. No screen gains a Supabase call. The admin panel is a **separate Next.js server app**, not a mobile screen, and it reads the cloud mirror server-side only — the existing boundary, unchanged |
| CLAUDE.md 2 — every FK needs an explicit `onDelete` | `medicine_catalog` is deliberately **FK-free** (it is global reference data with no owner; same reasoning recorded in migration `0031`'s header, and stated in `0032`'s). `medicine_catalog_imports` takes no FK either. No new FK is introduced anywhere |
| CLAUDE.md 3 — FEFO sorts on real `expiryDate` | untouched. The catalog carries no stock and no expiry; `batches` is not modified |
| CLAUDE.md 4 — cash formula is fixed | untouched. No cash path is read or written by any Batch 2 task |
| CLAUDE.md 5 — opening cash defaults to 0 | untouched |
| CLAUDE.md 6 — money uses the DM Mono variable | **`formatMoney` alone does not satisfy this** (review finding 11): `packages/utils/src/formatMoney.ts:8-11` returns a string and explicitly tells callers to *pair* it with DM Mono — `StatCard.tsx:16` applies `font-mono` separately. So every new money element in the admin pages carries `font-mono` explicitly, and `tests/font-tokens.test.ts` is extended to assert it for the new subscription and payment tables. A money figure that formats correctly in Plus Jakarta Sans is exactly the silent violation rule 6 exists to prevent |
| CLAUDE.md 7 — a new owner never sees a previous owner's data | the catalog is shop-**independent** reference data containing no owner, shop, phone or sales field. A test asserts the table has no `shop_id` and no owner-identifying column, so there is nothing for an owner reset to leak. Shop-owned `medicines` rows stay shop-scoped and are never written by the importer (§6.3) |
| CLAUDE.md 8 — PINs bcrypt-hashed, never logged | no PIN path is touched. Admin passwords are a **different credential** and use PBKDF2-SHA256 (Edge-runtime-compatible; §4.2); the admin audit redactor denies password/secret/token/PIN/phone fields by **allowlist**, not denylist, reusing W3-04's discipline |
| CLAUDE.md 9 — no seed/demo data ships | **zero medicine rows ship.** Migration `0032` creates the catalog table *empty*; the repository contains no catalog data file; a test asserts both, and asserts a fresh shop still starts with an empty `medicines` table. §6.4 states the tension with "21,000 medicines must be available offline" explicitly rather than resolving it silently |
| CLAUDE.md 10 — plan first for db/sync/money work | this document is that plan. Gate 2 is the approval. No implementation begins before `PLAN ACCEPT` |
| CLAUDE.md 11 — contradictions stated explicitly | §10 lists every contradiction found between the founder's decisions and the repository's actual state, including two that need a founder answer before code moves (barcode removal, §6.2.1; the dataset licence, §6.4) |
| CLAUDE.md 12 — BETA is offline **and** online | respected: the catalog works fully offline; the admin panel is the online half and is built. bKash is the other online half and is **BLOCKED, not quietly deferred** — §7.5 states the constraint, as rule 11 and Gate 1 both require |
| CLAUDE.md 13 — P0/P1/P2 scope lock | all six scope areas are founder-assigned Batch 2 work. OCR was already an explicit, recorded founder override of the scope lock (`docs/plans/ocr.md`, "the user was flagged this scope-lock conflict explicitly… and chose to proceed"). Nothing outside the assigned scope is built — notably **not** shop location/map (§5.4), **not** W4-04/W4-05 |
| CLAUDE.md 15 — `apps/prototype-web` is reference-only | consulted for the admin pages' and the catalog picker's layout and interaction patterns only. No React-Web architecture, CSS, business logic, state management or data layer is copied |
| Batch safety | no hosted Supabase read or write, no migration applied, no deploy, no EAS build, no live payment, no merchant-credential change, no device operation. **No file is added to `backend/supabase/migrations/`** — not written, not applied (§9). The two SQL artefacts this batch produces live in `backend/supabase/deploy/` and are never part of the chain |

---

## 1. Verified repository baseline (Gate 1 evidence)

```
HEAD                     51c5230e622b2ff5e1ca0c859fdf541a3131cc4c
origin/main              51c5230e622b2ff5e1ca0c859fdf541a3131cc4c   (in sync, verified by git ls-remote)
branch                   main
remote                   https://github.com/iimrul/muthoy.git        (PUBLIC)
Postgres migrations      34        tail = 20261015000000_h9_api_role_table_privileges.sql
SQLite migrations        32        0000..0031 (32 journal entries; r1/r2 said 31 — wrong)
vitest include entries   166       globs; apps/admin/lib/**, packages/*/src/** auto-collect
dirty paths              41        3 modified + 38 untracked, pre-existing, via -uall (§11.3)

test baseline (measured, not assumed)
  full suite             243 files / 5062 tests   matches the ledger's Batch 1 figures exactly
  contended full run     2 failed / 5060 passed   VITEST_EXIT=1, duration 1225.81s
  the same 2 in isolation  34/34 passed           exit 0, duration 12.59s
```

**The baseline is green, and the two contended failures are timing flakes — verified, not
assumed.** The full run was executed while the Gate 2 Codex review was saturating the same
machine, and the two failures were both wall-clock:

| Test | Failure | Isolated re-run |
|---|---|---|
| `db/h7-pin-reservation.sqlite.test.ts` — "does not change who may log in" | `Test timed out in 5000ms` (three bcrypt cost-10 fixtures) | PASS |
| `db/inventory-ledger.sqlite.test.ts` — "deducts correctly, prices correctly, and stays fast" | `expected 308 to be less than 250` | PASS |

Re-running just those two files with nothing competing gives `Test Files 2 passed (2) /
Tests 34 passed (34)`, exit 0, in 12.59s. Neither is a regression and neither is Batch 2's.

**Operational constraint this establishes for Gate 3:** the full suite must **not** be run
concurrently with a Codex review or any other CPU-heavy job, or it reports false failures in
these two timing-sensitive tests. Gate 3's regression run is serialized for that reason, and
any timing failure is re-confirmed in isolation before being reported as real.

Facts established by reading the code, not by reading the documentation:

1. **The admin panel is two read-only pages.** `apps/admin` is 32 files: HTTP Basic Auth in
   `middleware.ts`, a dashboard of two numbers, a pharmacy list. No roles, no sessions, no
   audit log, no write path. `lib/env.ts` is `server-only` and is the single reader of the
   service-role key.
2. **`service_role` already holds the SELECT grants the admin build-out needs.** Migration
   `20260831000000_b4_commercial_platform.sql:195-201` grants SELECT (and
   `insert,update` at `:194`) on `plan_offerings`, `billing_accounts`, `shop_memberships`,
   `billing_subscriptions`, `entitlement_snapshots`, `payment_orders` and
   `payment_provider_events`; `20260817000000` grants SELECT on `shops` and `sales`;
   `20260907000000_h7_security_hardening.sql` grants SELECT on `roles` and
   `select, update` on `users`. **Scope B therefore needs no migration** — this is the
   single most important finding in this plan, and it is why admin management is buildable
   now.
3. **`audit_logs` cannot hold an admin action.** `20260813000000_initial_schema.sql:252-259`
   makes it `shop_id uuid not null references shops(id)` + `actor_id uuid not null
   references users(id)`. An admin is neither. It also has **no** `service_role` grant. A
   durable admin audit table is a migration (§9.2).
4. **`sale_refunds` has no `service_role` grant** — W4-04's blocker, unchanged, Batch 3's.
5. **OCR is already implemented and wired into five screens**, not missing. `native/scanner.ts`
   calls `recognizeText` from `@infinitered/react-native-mlkit-text-recognition@^5.0.1`;
   `components/scanner/MedicineTextScanner.tsx` (365 lines) is the shared modal;
   `domain/ocrText.ts` carries label-anchored extractors **including
   `parseScannedInvoiceLines`** for multi-line invoice capture, with a no-auto-commit review
   queue in `app/suppliers/purchase-create.tsx`. §6.2 states what is genuinely missing.
6. **Barcode scanning is implemented, contradicting the founder's exclusion.**
   `native/scanner.ts` exports `scanBarcode`; `MedicineTextScanner.tsx:150` calls it.
   `docs/plans/ocr.md` records this as shipped production behaviour. §6.2.1.
7. **No global medicine catalog exists.** `medicines` (`db/schema.ts:377`) is
   `shop_id text not null references shops(id) on delete cascade` — per-shop, and
   `medicines_fts` indexes `name` and `generic` only. The 21K catalog is a new table, not an
   extension (§6.3).
8. **No transliteration or Bengali normalization code exists anywhere.** Scope E is net-new.
   `domain/medicineMatch.ts` does supply a `similarityScore` + `fuzzyMatchMedicines` that
   scope E must reuse rather than duplicate.
9. **Postgres pins the payment provider to `'sslcommerz'` at five points, and a sixth,
   semantic blocker defeats bKash even after all five are changed.** Three CHECKs —
   `b4_commercial_platform.sql:105` (**`billing_subscriptions`**), `:149` (`payment_orders`,
   which also carries `default 'sslcommerz'`), `:169` (`payment_provider_events`) — plus two
   hardcoded literals inside `b4_apply_verified_payment` at `:659` and `:701`. The sixth is
   `:677`'s `MU031` check, which conflates the merchant invoice with the provider's own
   transaction id; bKash keeps those separate, so no CHECK change fixes it. **SQLite mirrors
   the CHECK**: `0026_b4_commercial_cache.sql:78`. The legacy `subscriptions.payment_provider`
   is unconstrained `text` and is **not** a blocker. Full analysis in §7.3.
10. **No bKash gateway code exists.** The only bKash references are the customer
    `payments.method` enum (how a shopkeeper records that a *customer* paid by bKash —
    unrelated to subscriptions) and the legacy `subscriptions.payment_provider` enum.
11. **The captured OCR photo is never deleted.** No `deleteAsync`/`FileSystem` call exists in
    `MedicineTextScanner.tsx` or `native/ScannerCamera.tsx`. A photograph of a medicine strip
    accumulates in the app cache indefinitely. A real privacy gap, and Batch 2 work (§6.2.2).
12. **The SQLite migration chain is not count-pinned — but it is not directory-driven
    either, and revision 1/2's claim that it was is false** (review finding 3, CRITICAL).
    Two registration points must be edited for a new migration to run **at all**:
    - `apps/mobile/db/test/migrations.ts:35-44` builds its map by iterating
      `_journal.json`'s `entries`, keyed `m` + the zero-padded `idx`. A `.sql` file absent
      from the journal is **never applied under test**.
    - `apps/mobile/db/migrations/migrations.js` **statically imports** every `.sql` file (33
      imports: the journal plus 32 migrations) and lists each key in its default export. A
      file not imported there is **never applied on a device**.

    The chain is **32 entries, `0000`–`0031`** (`_journal.json` `entries.length === 32`), not
    the 31 revisions 1 and 2 claimed. So `0032`/`0033` require the two SQL files **plus** a
    journal entry and a registry entry each — see §9.3 and §11.2. What remains true is the
    part that matters for the seal: there is **no count or tail assertion** anywhere on the
    SQLite chain, so extending it breaks no H-9 gate. Only the **Postgres** chain is sealed,
    and that asymmetry is still what makes the catalog and the SQLite provider change
    possible.

---

## 2. The nine canonical task IDs

The ledger records "Batch 2 (9)" but has never enumerated the nine with IDs — it names only
OCR, the 21,000-medicine database, and Bangla/English/Banglish search. **This plan assigns
the nine IDs**, following the existing `W{wave}-{nn}` scheme and the wave each task actually
belongs to in `pre-rc-master-plan.md`. The assignment is recorded in the ledger at Gate 4 so
it is traceable rather than invented twice.

| ID | Task | Wave source | Reaches |
|---|---|---|---|
| **W4-06** | H-12 — admin authentication, RBAC, audit, sessions; Basic Auth retired | Wave 4 item 16 | CODE-COMPLETE |
| **W4-07** | Phase 3 admin build-out — account, subscription, payment, drill-down pages | Wave 4 item 15 | CODE-COMPLETE |
| **W4-08** | Admin support/operational write actions + admin UI consistency | Phase 3 §5 "Support / admin actions" | CODE-COMPLETE |
| **W2-01** | Medicine OCR completion — confirmation gate, image privacy, prescription capture | Playbook §23 (text only) | CODE-COMPLETE |
| **W2-02** | Offline medicine catalog — schema, chunked importer, indexing, offline lookup | Batch 2 scope D | **CODE-COMPLETE, DATA BLOCKED** (§6.4) |
| **W2-03** | Multilingual medicine search — English, Bangla, Banglish | Batch 2 scope E | CODE-COMPLETE |
| **W4-09** | Direct bKash gateway | Phase 4 / gate E5 | **BLOCKED — NOT IMPLEMENTED.** Founder-approved 2026-10-22. Research and design delivered; no gateway code written (§7.5) |
| **W4-10** | SSLCommerz retirement from active selection and live routing | Founder decision 2026-10-21 | CODE-COMPLETE |
| ~~**W5-16**~~ | ~~Barcode exclusion ratchet~~ | — | **REMOVED FROM EXECUTABLE SCOPE — HELD ON Q1** (§6.2.1) |

**Seven executable tasks. Two are blocked or held, and both for reasons outside this
batch.**

- **W5-16 (barcode) is HELD on Q1.** Review finding 9 is right that the plan could not
  coherently both say Q1 needs a founder decision and schedule barcode work as executable
  scope — that would quietly preserve founder-excluded capability *and* spend new effort on
  it. Held, not scheduled (§6.2.1).
- **W4-09 (bKash) is BLOCKED and not implemented**, by founder decision on 2026-10-22 after
  four review rounds established that it cannot be activated in this batch under any plan.
  §7.5 states the constraint precisely, as Gate 1 requires. Its research and design are
  delivered and preserved; no gateway code is written.

So Batch 2 delivers **W4-06, W4-07, W4-08, W2-01, W2-02, W2-03 and W4-10** — seven tasks.
W2-02 additionally carries a data blocker (§6.4): its pipeline is complete, its dataset is
not shippable.

Nothing about the barcode code changes in the meantime: it keeps working exactly as it does
today, and this batch neither extends nor deletes it.

---

## 3. Dependency order

```
W2-02 (catalog table + importer)
   └─> W2-03 (search keys indexed on the catalog)
          └─> W2-01 (OCR candidate → catalog match → confirmation gate)

W4-06 (admin auth/RBAC/audit)
   └─> W4-07 (pages, each behind a permission)
          └─> W4-08 (write actions, each audited)

W4-09 (bKash)  — BLOCKED, NOT IMPLEMENTED (§7.5)
W4-10 (provider refusal + SSLCommerz retirement)  — ships alone, no bKash dependency
W4-10 (SSLCommerz retirement)          ─┴─> one commit; neither is coherent alone

W5-16 (barcode)  — NOT SCHEDULED. Held on Q1 (§6.2.1)
```

W4-06→08 and W2-01→03 are independent tracks and can be implemented in either order.

---

## 4. W4-06 — admin authentication, RBAC, audit, sessions

### 4.1 What is wrong today

Basic Auth over a single shared `ADMIN_BASIC_AUTH_USER`/`PASSWORD` pair. There is no
identity (every admin is the same principal), no role, no session (the browser replays the
credential on every request), no logout, no lockout, and no record of who looked at or
changed anything. It fails closed with no credentials configured, which is the one thing it
gets right and which this task preserves.

### 4.2 Authentication

The password check and the request gate are deliberately **split across two runtimes**,
because `middleware.ts` runs in the Edge runtime where `node:crypto`'s `scrypt`/`bcrypt` do
not exist, and because running a correctly-expensive KDF on every page request is itself a
denial-of-service surface.

- **`app/api/admin/session/route.ts`** — `export const runtime = 'nodejs'`. Login and
  logout. Verifies the submitted password with **PBKDF2-SHA256, 600,000 iterations,
  32-byte key, per-account 16-byte salt** (OWASP's current PBKDF2-SHA256 floor), compared
  with the existing `constantTimeEquals` from `lib/basicAuth.ts` (reused, not re-written).
- **`middleware.ts`** — Edge. Verifies only the session cookie's HMAC-SHA256 and its two
  expiries via Web Crypto. No password material is read in the Edge runtime at all.

**The matcher must be changed, or login is impossible (revision 2, finding F1).** The
existing matcher is `['/((?!_next/static|_next/image|favicon.ico).*)']`, which in Next
15.5.23 matches `/login` **and** `/api/admin/session`. Left alone it would gate the login
route behind the very session that route exists to issue — a deadlock in which no admin can
ever authenticate.

**Revision 2's fix for that was itself unsafe** (review finding 4). It added the two paths
to the negative lookahead:

```
['/((?!_next/static|_next/image|favicon.ico|login|api/admin/session).*)']   # WRONG
```

Those are **prefix** exclusions, so they also exempt `/login-anything`,
`/api/admin/session-extra`, and any future route under either prefix — silently, and
without a test noticing. A middleware exemption that grows by accident is exactly the shape
of hole this task exists to close.

**Corrected design: the matcher stays broad, and the exemption is an exact-match check
inside the middleware,** where it is ordinary reviewable code rather than regex trivia:

```ts
const PUBLIC_PATHS = new Set(['/login', '/api/admin/session']);
// …
if (PUBLIC_PATHS.has(request.nextUrl.pathname)) return NextResponse.next();
```

`request.nextUrl.pathname` is compared whole, so `/login-anything` is gated like everything
else. A test enumerates the exempt set, asserts each member is reachable without a cookie,
and asserts a list of near-miss paths — `/login-anything`, `/login/`, `/api/admin/sessionx`,
`/Login` — are **all** gated. A mutation check switches the comparison to `startsWith` and
must fail.

The two genuinely public paths each carry their own protection:

| Path | Why it is safe unauthenticated |
|---|---|
| `/login` | a static form. It renders no platform data and performs no query |
| `/api/admin/session` | this *is* the credential boundary. It verifies the password with the §4.2 KDF, enforces **both** §4.6 throttles, and rejects any request whose `Origin` header is not the deployment's own origin — the CSRF defence for a route that cannot rely on a session cookie it has not issued yet. `POST` only; `GET` returns 405 |

**The login route must do constant work, or it is a username oracle** (review finding 5).
As revision 2 specified it, a known username cost 600,000 PBKDF2 iterations while an unknown
one returned immediately — a timing difference large enough to enumerate the admin account
list remotely, and a way to probe cheaply without ever paying the KDF cost. Corrected:

- A **fixed dummy salt and hash** are held as module constants. When the submitted username
  is not in `ADMIN_ACCOUNTS`, the route runs the *same* 600,000-iteration PBKDF2 against
  that dummy and discards the result. Both branches do identical work.
- The response is **byte-identical** for "no such user" and "wrong password": same status,
  same body, same headers. No field distinguishes them, and the audit sink records the
  distinction server-side only.
- A test asserts both branches call the KDF exactly once, and that the two responses are
  indistinguishable. A mutation check makes the unknown-username branch return early and
  must fail.

A test asserts every other route is still gated, that the two exempt paths are reachable
without a cookie, and that a third path cannot be added to the exemption list without the
test failing.

Credentials come from `ADMIN_ACCOUNTS`: a JSON array of `{ username, salt, hash }` — **no
`role` field**, because roles live in the separate `ADMIN_ROLES` variable the Edge middleware
reads (§4.3). Keeping the two apart is what lets the middleware resolve a role per request
without any password material in its reach. Parsed and validated by a Zod schema in
`lib/adminIdentity.ts`, which **cross-validates the two variables**: every `ADMIN_ACCOUNTS`
username must have an `ADMIN_ROLES` entry and vice versa, and a mismatch is a startup
failure rather than a silent half-provisioned account. **Fails closed** on absent, empty,
malformed, duplicate-username, cross-variable mismatch, or
unknown-role input — the panel returns 503 exactly as it does today with no Basic Auth
configured. A plaintext password field anywhere in `ADMIN_ACCOUNTS` is a parse error, not a
convenience.

A small `scripts/admin-hash-password.mjs` generates a salt+hash pair so the founder can
provision an account without a plaintext password ever entering the repo, an env file in
git, or a shell history line (it reads the password from stdin, never `argv`).

### 4.3 Sessions

A signed, stateless cookie — no session table, therefore no migration.

| Property | Value | Why |
|---|---|---|
| Name | `muthoy_admin_session` | — |
| Payload | `{ sub, role, iat, exp, lastSeen, epoch }`, base64url JSON | `sub` is the username; `role` is carried **in the signed payload** (see F2 below) |
| Signature | HMAC-SHA256 over the payload with `ADMIN_SESSION_SECRET` (≥32 bytes, enforced) | fast enough for the Edge runtime |
| Flags | `HttpOnly; Secure; SameSite=Strict; Path=/` | `SameSite=Strict` is the CSRF defence for the write actions in §5.5; there is no cross-site flow to break |
| Absolute TTL | 8 hours from `iat` | a forgotten open tab stops being a key by end of shift |
| Idle TTL | 30 minutes from `lastSeen`, refreshed by the middleware re-signing the cookie | — |
| Revocation | `ADMIN_SESSION_EPOCH` integer in the environment; a payload whose `epoch` differs is rejected | bumping it invalidates every live session without a table. **Honest limit:** it is all-or-nothing — there is no per-user revoke until the Batch 3 table |

**Role resolution, after two wrong turns. Revision 2's reasoning here was false** (review
finding 4). Revision 1 said `role` is re-read per request so a demotion is immediate.
Revision 2 withdrew that, claiming Next inlines `process.env` into the Edge middleware
bundle at build time. **That claim is wrong**: `next/dist/lib/static-env.js:42-63` inlines
only `NEXT_PUBLIC_*`-prefixed variables and `next.config`'s `env` entries, and
`apps/admin/next.config.ts` declares no `env` key. `ADMIN_ACCOUNTS` is neither, so it **is**
readable at request time in the Edge runtime. Revision 2 therefore gave up immediate
demotion for nothing.

**Corrected design — request-time role lookup, restored, with the hashes kept away from the
Edge runtime.** The accounts variable is split in two:

| Variable | Read in | Contains | Why split |
|---|---|---|---|
| `ADMIN_ROLES` | **Edge** middleware, per request | `username → role` only. No salt, no hash | the middleware needs the role and nothing else. Keeping it hash-free means no password material is ever in the Edge bundle's reach, which was revision 2's one legitimate instinct |
| `ADMIN_ACCOUNTS` | **Node** route only (`/api/admin/session`) | `username`, `salt`, `hash` | credential verification is the only thing that needs hashes, and it happens in one place |

So the cookie proves **who** (signed `sub`), and the **role is resolved from `ADMIN_ROLES`
on every request**. Consequences:

- A **demotion takes effect on the next request**, not at next login. An account removed
  from `ADMIN_ROLES` is denied immediately — the cookie stops conferring anything.
- The signed `role` claim is still written into the payload, but **`ADMIN_ROLES` is
  authoritative, full stop**, and the claim is used only to **audit** a mismatch.

  Revision 3 said "the lower-privilege of the two wins", which was wrong (delta finding —
  *role mismatch rule can grant unintended authority*): the roles are **not totally
  ordered**. `billing` holds `subscriptions.write` and `support` does not; `support` holds
  `support.write` and `billing` does not. Neither is "lower", so any ordering imposed on them
  preserves a permission the other role never had — exactly the stale authority the rule was
  meant to prevent. Taking `ADMIN_ROLES` as authoritative has no such hole: a demotion from
  `billing` to `support` removes `subscriptions.write` on the next request, and the cookie's
  stale claim grants nothing. (If a future requirement genuinely needs both consulted, the
  correct operation is the **intersection of their permission sets**, never a rank
  comparison — recorded here so the reasoning is not lost.)
- **Honest limit, stated** (review finding 4's last clause): changing `ADMIN_ROLES` or
  `ADMIN_SESSION_EPOCH` is an environment change, and on a platform like Vercel an
  environment change takes effect through **deployment propagation**, not instantly. So
  "immediate" means immediate once the new environment is live. Per-user cookie revocation
  independent of the environment still does not exist until Batch 3's table.

The role→permission mapping (§4.4) stays in code, where it is reviewable and testable. A
test asserts that removing a username from `ADMIN_ROLES` denies a request bearing a
still-valid signed cookie, and that a cookie claiming `super_admin` for a user whose
`ADMIN_ROLES` entry says `read_only` is treated as `read_only` and audited.

### 4.4 Authorization

`lib/adminRoles.ts` — one frozen role→permission table, and one choke point.

| Role | Permissions |
|---|---|
| `super_admin` | every permission below |
| `billing` | `shops.read`, `accounts.read`, `subscriptions.read`, `subscriptions.write`, `payments.read`, `audit.read` |
| `support` | `shops.read`, `accounts.read`, `subscriptions.read`, `payments.read`, `support.write` |
| `read_only` | `shops.read`, `accounts.read`, `subscriptions.read`, `payments.read` |

`requirePermission(session, permission)` in `lib/adminAuthz.ts` throws
`AdminForbiddenError` and **audits the denial**. Every page and every server action calls it
as its first statement. Enforcement is server-side in all cases: a Server Component that
throws renders the 403 notice, and a Server Action that throws never reaches a query. No
permission is checked in the browser, and no page's visibility is the gate.

Permission lookups use the `ownKey()` own-property guard already established in Batch 1, so
an inherited name such as `constructor` cannot resolve a truthy value off `Object.prototype`
and grant a permission that was never granted. A planted test proves it.

### 4.5 Audit log

`lib/adminAudit.ts` — `recordAdminAction({ actor, role, action, target, outcome, meta })`.

- **Every** write action, **every** authorization denial, and **every** login success and
  failure is recorded. Reads of list pages are not, deliberately: auditing every page view
  with no durable store produces noise that hides the writes.
- **Sink is an interface**, with two implementations now: a one-line structured JSON writer
  to `stderr` (captured by the host platform's log retention), and an in-process ring buffer
  of the most recent 200 entries that `/audit` renders. Batch 3 adds the Postgres sink once
  the table exists (§9.2); no call site changes when it does.
- **Redaction by allowlist.** `meta` is filtered against a permitted key set before it is
  serialized. The service-role key, the session secret, any password hash, any bKash
  credential and any customer phone number are structurally unable to reach the sink. A
  planted test feeds each of those shapes in and asserts none appears in the output.
- **Honest limit, stated on the page itself:** until the Batch 3 table, the in-app view is
  per-instance and non-durable. `stderr` is the record of account. The `/audit` page says so
  in the UI rather than implying a complete history.

### 4.6 Login throttling

**Two independent throttles**, because one keyed on the supplied username is trivially
bypassed by rotating usernames (review finding 5, which revision 3 specified in §4.2 but
left out here — delta finding 5):

1. **Per-username**, for the account under attack: exponential backoff (1s, 2s, 4s… capped
   at 60s) and a 15-minute lockout after 10 failures.
2. **Per-source, keyed independently of anything the caller supplies in the body**: a fixed
   budget of 30 attempts per 15-minute window per client IP (`x-forwarded-for`'s first hop,
   falling back to `cf-connecting-ip`), reusing the bucket shape
   `payment-webhook/handler.ts` already uses for its per-IP limit rather than inventing a
   second mechanism. Rotating usernames consumes this budget, so enumeration is bounded even
   when every username is unknown.

Both live in module-scope `Map`s in the Node route. **Honest limit:** per-instance, so a
multi-instance deployment multiplies both allowances by the instance count. Recorded as an
accepted limitation rather than a claimed defence; the real
rate limit belongs at the edge/host layer and is listed as an external gate.

### 4.7 Cross-shop exposure and service-role containment

The admin panel is *intentionally* cross-shop — it is the platform console. The requirement
is therefore not isolation between shops but these three, each with a test:

1. The service-role key never reaches a browser bundle. `lib/env.ts` is already
   `server-only` and `lib/serviceRoleExposure.test.ts` already guards it; both are extended
   to cover the new modules, and a test asserts no new `NEXT_PUBLIC_*` variable exists.
2. A shop drill-down renders exactly one shop. Every drill-down query is parameterised by a
   Zod-validated UUID route param, never by a client-supplied filter or ordering string.
3. A denied role cannot reach the data at all — the denial happens before the query, not
   after it. A test asserts the Supabase client is never constructed on a forbidden path.

---

## 5. W4-07 / W4-08 — admin management

### 5.1 Pages

| Route | Permission | Reads (all already granted) |
|---|---|---|
| `/` dashboard | `shops.read` | `shops`, `sales` |
| `/pharmacies` | `shops.read` | `shops` + plan/commercial-status columns |
| `/shops/[id]` | `shops.read` | `shops`, `users`, `sales`, `entitlement_snapshots`, `shop_memberships` |
| `/accounts` | `accounts.read` | `billing_accounts`, `shop_memberships`, `shops` |
| `/accounts/[id]` | `accounts.read` | the above + `billing_subscriptions`, `entitlement_snapshots` |
| `/subscriptions` | `subscriptions.read` | `billing_subscriptions`, `entitlement_snapshots`, `plan_offerings` |
| `/payments` | `payments.read` | `payment_orders`, `payment_provider_events` |
| `/audit` | `audit.read` | the in-process ring buffer (§4.5) |

**Every money figure on these pages carries `font-mono` explicitly** (review finding 11).
`formatMoney` returns a string and `packages/utils/src/formatMoney.ts:8-11` tells callers to
pair it with DM Mono — `StatCard.tsx:16` already does so separately. So the new
subscription, payment, account and shop-drill-down figures each render inside an element
carrying `font-mono`, and `tests/font-tokens.test.ts` is extended to assert it. A money
figure that formats correctly in Plus Jakarta Sans is precisely the silent violation
CLAUDE.md rule 6 exists to catch.

### 5.2 The revenue label stays GROSS

The ledger's interim safety boundary 1 is binding: *"The admin dashboard still reports GROSS
sales. Its label is unchanged and is not to be described as net revenue anywhere."* W4-04 is
Batch 3's. So the dashboard keeps its existing `formatMoney(totalSalesToday)` and its
existing label, and the new `/subscriptions` and `/payments` pages describe their figures as
**billed amounts** and **payment-order amounts** — never as revenue, MRR, or net. A test
greps the admin tree for `revenue`, `MRR` and `net` and fails on a new occurrence, so the
boundary is mechanically enforced rather than remembered.

### 5.3 Write actions (W4-08)

Three, deliberately. Each requires a permission, is audited, and is idempotent.

| Action | Permission | Mechanism |
|---|---|---|
| Refresh an account's entitlement snapshot | `subscriptions.write` | `b4_refresh_entitlement_snapshot(uuid)` — existing `SECURITY DEFINER` RPC, already `grant execute … to service_role` |
| Reconcile an account's plan limits | `subscriptions.write` | `b4_reconcile_plan_limits(uuid, timestamptz)` — same |
| Expire a stale, past-`expires_at` payment order | `support.write` | the exact `update` already in `billing.ts`'s `billingStatus`, with the same `in('status',['created','pending']).lte('expires_at', now)` guard |

**No money edit, no entitlement grant, no plan change, no refund, no shop write.** The
master plan's instruction — *"Admin writes must not bypass the money/stock invariants;
prefer existing `SECURITY DEFINER` RPCs"* — is satisfied by using only RPCs that already
exist and already carry their invariants, plus one guarded status transition that the
server already performs on its own.

### 5.4 Shop location / map — BLOCKED, not built

Scope B asks for "Location/map management within approved permissions." It is blocked twice
over and this plan builds **none** of it:

- `pre-rc-master-plan.md` §5: the location row *"requires P-2 writer first."*
- The ledger's interim safety boundary 2: *"No shop-location or permission-dependent
  shop-profile feature may be released before W4-05 acceptance."*
- W4-05 is the `sync_apply_row` wrapper, which is a Postgres migration, which is sealed.

A shop write from the admin panel would also need an `update` grant on `shops`, which does
not exist and would be a migration. This is squarely "preserve W4-05 shop-write
restrictions as Batch 3 blockers; do not work around them." Reported BLOCKED under gate E4.

### 5.5 `adminGrants.test.ts` must be restructured, and why that is safe

The test currently asserts `QUERIED_TABLES` equals exactly `['sales','shops']` and that **no**
migration grants `insert|update|delete` on any queried table. Both assertions break the
moment the panel reads an eleventh table or performs its first write — so the test is
rewritten, not deleted, and it gets *stronger*:

**Revision 2's restructure would have quietly weakened it** (review finding 6). The current
test asserts **no** DML privilege on any queried admin table. The moment the panel reads the
seven commercial tables, a blanket "exactly what is granted" manifest has to **bless** the
broad `insert, update` that `b4_commercial_platform.sql:194` already grants on all seven —
even though the planned code needs only RPCs plus one guarded `payment_orders` update. The
test would still have looked stronger while permitting far more. Corrected:

- **The no-DML assertions are preserved verbatim for `shops` and `sales`.** Those are the
  tables the original guard was written for, the panel still only reads them, and nothing in
  Batch 2 needs that to change.
- The seven commercial tables are listed in a **separate, explicitly-labelled** group as
  *pre-existing privileges Batch 2 does not introduce and does not rely on* — recorded as an
  inherited fact, not endorsed as a permission the panel may use.
- A **source-level** test enforces the real restriction: in `apps/admin`, the only direct
  write permitted is the one guarded `payment_orders` status update (§5.3), and everything
  else must go through an RPC. It greps the admin tree for `.insert(`, `.update(`,
  `.delete(`, `.upsert(` and fails on any occurrence outside that one approved call site.
  This is what actually bounds admin write power, and it is a thing the original test never
  checked.
- An **effective-ACL pgtest** replaces text matching for the question text matching cannot
  answer. Review finding 6 is right that greping GRANT statements cannot establish effective
  privilege after ordered GRANTs, REVOKEs and role memberships. A `backend/supabase/pgtest/`
  test applies the chain to a real Postgres and asserts `has_table_privilege('service_role',
  <table>, <privilege>)` for the intended matrix — including the **negatives**:
  `sale_refunds` SELECT is **false** (W4-04's blocker, proven rather than assumed), `shops`
  UPDATE is **false** (W4-05's), and the device-registry tables are **false** on everything.
- The `anon`/`authenticated` assertions and the "no RLS weakening" assertions are unchanged
  and still absolute.
- A table the panel queries but the manifest does not declare is still a failure, so adding
  an undeclared read fails the build — the protection the original `['sales','shops']`
  assertion was really providing.
- **Negative controls, two of them, because one proves too little.** Review finding 6 notes
  a synthetic DELETE proves only that DELETE detection works. So: (a) a synthetic migration
  granting `delete on shops to service_role` must be rejected, and (b) a synthetic admin
  source file containing `.update('shops')` must fail the source-level test. Each targets a
  different one of the two mechanisms.
- **A passing full suite is not evidence that this test was not weakened.** Its diff is
  called out explicitly in the Gate 5 manifest for review as a security-test change.

---

## 6. W2-01 / W2-02 / W2-03 — OCR, catalog, multilingual search

### 6.1 Inspection first, as scope C and D require

OCR is **not** missing. §1 item 5 lists what exists: the ML Kit wrapper, the shared modal,
the permission state machine, the label-anchored field extractors, the date normalizer, the
multi-line invoice extractor and the no-auto-commit review queue. Writing a second OCR
pipeline would repeat exactly the mistake DECISIONS.md records at "D10 — one error-to-text
map, not two." So W2-01 is a completion task, and the three genuine gaps are below.

### 6.2 W2-01 — the three real OCR gaps

#### 6.2.1 Barcode: a contradiction that needs a founder answer

The founder's decision says *"Barcode scanning is EXCLUDED."* The ledger says it *"remains
EXCLUDED and is not to be reintroduced."* **But barcode scanning is implemented and
shipped** — `native/scanner.ts` exports `scanBarcode`, `MedicineTextScanner.tsx:150` calls
it, and `docs/plans/ocr.md` records it as current production behaviour, not plan text.

"Excluded" can mean *add none* or *remove what exists*. These are different actions, and the
second deletes working, tested, shipped functionality. Per CLAUDE.md rule 11 this plan states
the contradiction instead of picking silently.

**What this plan does: nothing to barcode at all, pending Q1.** Revisions 1–2 proposed a
ratchet (W5-16) pinning the current barcode surface so it could not grow. Review finding 9
rejected that, correctly: scheduling *new work on barcode* while simultaneously declaring
that barcode's fate is an unresolved founder decision is incoherent — it spends effort
preserving founder-excluded capability and claims the batch is complete before its own
blocking question is answered.

So **W5-16 is removed from executable scope** (§2) and the ratchet test is removed from the
file manifest (§11.1). The existing barcode code is left exactly as it is: not extended, not
ratcheted, not deleted. Batch 2 ships **7** tasks (§2).

**Q1, for the founder.** "Barcode scanning is EXCLUDED" admits two readings, and they
require opposite actions:

| Reading | Action | Consequence |
|---|---|---|
| *Add none* | what this batch does | shipped barcode scanning keeps working. The exclusion means no new barcode investment |
| *Remove what exists* | delete `scanBarcode`, the `onBarcodeRecognized` wiring, `MedicineTextScanner.tsx:146-160`, `CameraView`'s `barcodeScannerSettings`, and the barcode candidate paths in `sale.tsx` / `checkout.tsx` | a working, tested, shipped capability is withdrawn from users. Also needs a decision on the `medicines.barcode` **column**, which is synced and cannot be dropped without touching the sealed Postgres chain |

I will not delete working, tested, shipped code on an ambiguous instruction (CLAUDE.md rule
11). On an explicit instruction to remove it, the removal is a clean, well-bounded task —
and it would then also need the exclusion in the ledger superseded rather than merely cited.

#### 6.2.2 The captured photograph is never deleted (privacy)

`captureAsync()` writes a JPEG of a medicine strip — or of a prescription — into the app
cache, and nothing removes it. Verified: no `File.delete`, `deleteAsync` or any cleanup call
exists in `MedicineTextScanner.tsx` or `native/ScannerCamera.tsx`.

**Revision 2, finding F3a — the leak is worse than revision 1 described, in the prescription
path specifically.** `MedicineTextScanner.tsx:122-128` shows that when `captureOnly` is set,
the handler calls `onImageCaptured(uri)` and returns. In `app/sale/checkout.tsx` that
callback is `setImageUri`, and the URI is later handed to
`native/prescriptionAttachment.ts`'s `preparePrescriptionAttachment`, which **copies** the
file into the documents directory. The temporary original is never deleted — so a
prescription photograph ends up in **two** places, one of them a cache file that nothing
owns, tracks, or clears. The sale's own attachment lifecycle covers only the copy.

**Revision 2, finding F3b — revision 1 named the wrong API and a duplicate module.**
Revision 1 proposed "a new `native/imageFile.ts` wrapper around `expo-file-system`'s
`deleteAsync`." Two errors: this repo is on `expo-file-system@57.0.5` and uses the modern
`File` / `Directory` / `Paths` API, not the legacy `deleteAsync`; and
`native/prescriptionAttachment.ts:48-54` **already** contains exactly this helper —
`removePreparedPrescriptionAttachment(localUri)`, a `new File(localUri)` existence check and
`delete()` inside a try/catch commented *"Best-effort orphan cleanup; sale correctness never
depends on it."* Adding a second module around the same call is the duplicate-module mistake
DECISIONS.md records at "D10 — one error-to-text map, not two."

**Revision 2's fix was itself a data-loss bug, and is withdrawn** (review finding 2,
CRITICAL). Revision 2 said the scanner could delete the capture in a `finally` on every
path, including `captureOnly`, "after the copy has been made." **There is no copy at that
point.** `checkout.tsx:764` passes `onImageCaptured={setImageUri}`, which only stores the
URI in React state; the durable copy happens much later — at sale, hold or cancel
persistence — in `db/sales.ts:456-474` and `db/saleDrafts.ts:58-68,221-231`, each of which
reads that same temporary URI and calls `preparePrescriptionAttachment`. Deleting it in the
scanner would remove the source **before** anything copied it, and the prescription
attachment would fail silently. Revision 2 also claimed `captureOnly` has two callers; it
has exactly **one** (`checkout.tsx:764`).

**DESCOPED after five review rounds. The precise constraint, per Gate 1's instruction.**

The scanner-owned half **does** ship (table below). The `captureOnly` half — cleaning up the
prescription capture — is **removed from Batch 2** and recorded as its own task, because
five successive designs each proved unsafe against code this batch is not authorized to
redesign:

| Attempt | Why it failed | Found by |
|---|---|---|
| blanket `finally` delete in the scanner | deletes the source before `db/sales.ts:456+` copies it at sale time | round 3 |
| delete after `onImageCaptured` "once the copy exists" | no copy exists then; `onImageCaptured={setImageUri}` only stores a URI | round 3 |
| caller deletes its own capture | `checkout.tsx:124` seeds `imageUri` from `heldSnapshot?.imageUri`, already **durable** — so this deletes a held sale's prescription | round 4 |
| persistence returns `attachmentCopied` and the caller cleans up | `createSaleTransaction` succeeds despite copy failure (`db/sales.ts:475`) and checkout then navigates away — no owner survives | round 4 |
| failed copies queue the temp URI in `sale_attachments` | **`saleAttachments.saleId` is `.notNull().references(sales.id)`** (`db/schema.ts:754-756`), so a held draft cannot insert a row at all; and `sync/attachments.ts:14` re-reads `localUri` on every retry, so an OS-evicted cache path breaks the upload permanently | round 5 |

**Why it cannot be done safely inside this batch.** A correct design has to change the
transaction boundary in `db/sales.ts` — which prepares the attachment *before* the
transaction and calls `removePreparedAttachment` if the transaction fails, so deleting the
temporary file after the copy risks losing **both** — and add a durable draft-attachment
path that does not use `sale_attachments`. That is money-path and sync-path code.
CLAUDE.md rule 10 puts it behind its own approved plan, and rule 11 requires saying so
rather than shipping the sixth variant of a design that has been wrong five times.

**What is true about the risk, stated without minimising it:** the temporary capture is
**pre-existing** behaviour — nothing in `MedicineTextScanner.tsx` or `ScannerCamera.tsx`
has ever deleted it, on any path, since OCR shipped. Batch 2 neither introduces nor worsens
it. It is a cache-directory file subject to OS eviction, not a permanent store. Recorded as
gate **E9** with the five failed designs above, so the next attempt starts from evidence
instead of repeating them.

**The scanner-owned half ships, and it is the larger share of the leak** — every medicine
strip scanned from Sale Entry, Add Medicine and the purchase-invoice flow:

| Path | Who owns the temporary file | When it is deleted |
|---|---|---|
| OCR path (`captureOnly` false) — the four scanning screens | the **scanner**. Nothing else ever sees the URI | in the scanner's `finally`, on success, throw, null result and close mid-processing. **Ships in W2-01** |
| `captureOnly` path — the single prescription caller | nothing deletes it today and nothing deletes it after this batch | **DESCOPED — gate E9** |

**One test must live outside the scanner** (round-6 finding 1d). A scanner-only negative
assertion cannot protect a resumed held draft, because the durable URI lives in
`checkout.tsx` — a file W2-01 modifies for prescription OCR. So W2-01 also ships a
**resumed-held-draft checkout test**: open checkout from a held draft whose `imageUri` is a
durable path, run a retake, a cancel and an unmount, and assert the durable file still
exists in every case. That test, not the scanner's, is what pins E9's boundary.

**What ships for the scanner-owned path.** `removeTemporaryCapture(uri)` is added to
`native/prescriptionAttachment.ts` — the module that already owns capture-file lifecycle,
already imports `File`, and already carries the best-effort-cleanup contract
(`:47-53`). `MedicineTextScanner` calls it in a `finally` on the **OCR path only**: success,
throw, null result, and close mid-processing. Deletion failure is swallowed and reported to
the W3-04 monitoring sink, never surfaced as a scan error, because the scan succeeded.

On the `captureOnly` path the scanner **does not** call it and **does not** touch
`imageUri` — the one thing every failed design got wrong. A test asserts the scanner never
deletes anything when `captureOnly` is set, which is what keeps a resumed held draft's
durable file safe.

Tests: deleted on OCR success, on throw, on null result, on close mid-processing; the
deletion path never rejects; and **nothing is deleted on the `captureOnly` path**. A mutation
check removes the OCR-path `finally` and must fail; a second mutation makes the scanner
delete on `captureOnly` and must fail the resumed-draft assertion.

**OCR failure must not invalidate a captured prescription.** On the prescription path the
image is the primary artefact and the recognised text is a convenience. Unreadable text must
therefore leave the capture intact and the sale completable, so the existing
`cameraNoText` / `cameraReadFailed` error branches are **not** reused there: recognition
failure on a `captureOnly` capture is surfaced as a non-blocking notice, and the image is
still handed back.

#### 6.2.3 The sale scan auto-commits without confirmation

`app/scan.tsx:40-50` calls `addItem()` — putting a line into the cart — the moment OCR
produces an exact single match. Scope C requires *"manual confirmation and correction before
recording medicine details,"* and the playbook's own recovery prompt for this feature is
*"A misread… got saved without confirmation. Add the confirmation step back — it must never
be skippable."* A cart line is the first step of a money path.

Fix: the scan result lands in a **confirmation sheet** — recognised name, matched product,
batch, expiry and unit price — with Confirm, Edit (drops into the existing manual search
pre-filled) and Discard. `addItem` is reachable only from Confirm. The sheet is not
dismissible by an outside tap, so there is no accidental-confirm gesture. A test asserts
`addItem` is never called without an explicit confirm, and a mutation check removes the gate
and proves the test fails.

Add Medicine and the purchase-invoice flow already gate correctly (form + review queue) and
are **not** changed.

#### 6.2.4 Prescription capture

**Revision 2, finding F3c — revision 1 mis-identified this gap and proposed a screen that
should not be built.** Revision 1 said "prescription does not [exist]" and specified a new
`app/sale/prescription-scan.tsx`. Both are wrong. Prescription **capture** is fully
implemented: `app/sale/checkout.tsx` opens `MedicineTextScanner`, stores the image through
`native/prescriptionAttachment.ts`, records it in the `sale_attachments` table, and syncs it
through the pending-upload queue in `db/attachments.ts` — with draft and refund variants.
Building a second prescription screen would duplicate a working flow.

**The actual gap is one line, and it is exactly the workflow scope C names.**
`app/sale/checkout.tsx:761-767` mounts the scanner with `captureOnly` and
`onTextRecognized={() => undefined}`, and `MedicineTextScanner.tsx:122-128` returns from the
`captureOnly` branch **before `scanText(uri)` is ever called**. So on the prescription path
the camera runs, the image is stored — and the image-to-medicine-**text** step does not
happen at all. The recognised text is not discarded after being computed; it is never
computed.

**Corrected fix — no new screen.** `checkout.tsx` keeps its capture behaviour and
additionally runs recognition on the captured image, routing the text through the
**existing** `parseScannedInvoiceLines` (a prescription is a multi-item list, the same shape
as an invoice) into the same per-line review-and-confirm pattern
`app/suppliers/purchase-create.tsx` already proves. Lines are matched against the catalog
(§6.3) and the shop's stock; each line is confirmed individually; unmatched or ambiguous
lines stay in the list with a manual-search affordance and are **never** auto-added. No
third extractor, no second scanner, no new route.

This needs a small change to `MedicineTextScanner`: `captureOnly` becomes capable of
*both* — hand back the image **and** attempt recognition — rather than returning early.
There is exactly **one** current caller (`checkout.tsx:764`), and it is the one being
changed, so no other screen is affected. A test pins that the recognition attempt is
opt-in, so a future `captureOnly` caller does not silently acquire OCR.

The recognised prescription text is never persisted: it lives only in component state, and
The temporary prescription image is **not** deleted — that cleanup is descoped to gate E9
(§6.2.2). The recognised text is still never persisted.

### 6.3 W2-02 — the offline medicine catalog

**Migration `0032_medicine_catalog.sql`** (SQLite only; the Postgres chain is untouched):

```
medicine_catalog                     -- global reference data, NO shop_id, NO FK
  id text primary key                -- uuidv5 over the normalized natural key (deterministic)
  brand_name text not null
  brand_name_bn text
  generic_name text
  generic_name_bn text
  manufacturer text
  manufacturer_bn text
  strength text
  dosage_form text
  pack_size text
  search_key text not null           -- §6.5's folded multi-script key
  source text not null               -- dataset identifier
  source_version text not null       -- dataset version/date
  row_checksum text not null         -- detects a changed row on re-import
  created_at text not null
  updated_at text not null

medicine_catalog_fts  USING fts5(brand_name, generic_name, manufacturer, search_key,
                                 content=medicine_catalog, content_rowid=rowid)
  + insert/delete/update triggers, mirroring 0001_medicines_fts.sql exactly

medicine_catalog_imports             -- provenance + resumability, NO FK
  id text primary key
  source text not null
  source_version text not null
  file_checksum text not null
  row_count integer not null
  imported_rows integer not null
  status text not null check (status in ('running','completed','failed'))
  started_at text not null
  finished_at text
```

Why FK-free and `shop_id`-free: the catalog belongs to no shop and must survive an owner
reset without carrying anything across. That is also what makes CLAUDE.md rule 7 trivially
satisfiable — a test asserts the table's column list contains no `shop_id`, no `owner`, and
no `phone`.

**Not synced.** The catalog is reference data imported locally, not shop data. It is excluded
from the client sync table registry and from `sync_readable_tables`' knowledge (which already
refuses unknown tables by default — *"a table added later is invisible until somebody names
its rule here, which is the safe direction to forget in"*). A test asserts
`medicine_catalog` appears in no sync table list, so it can never be pushed to Postgres —
which also means it can never need the sealed migration.

**Importer `db/medicineCatalogImport.ts`:**

- Reads a CSV or JSONL file URI **in chunks**, never materialising 21K rows. 500-row
  transactions; a bounded parse buffer; a progress callback. The low-memory test asserts
  peak retained rows stay under a chunk-and-a-half regardless of file size, using a
  synthetic 25,000-row stream.
- **Idempotent and duplicate-proof by construction.** `id` is `uuidV5` over the normalized
  natural key (brand + strength + dosage form + manufacturer), so re-importing the same
  dataset is `on conflict (id) do update` and produces no second row. A test imports the
  same 1,000-row fixture twice and asserts the row count is identical and `updated_at`
  advanced.
- **Never writes `medicines`, `batches` or any shop table.** Enforced by the module importing
  only the three catalog tables, and asserted by a test that seeds a shop with medicines,
  runs a full import, and diffs every shop table byte-for-byte.
- Resumable: a `failed` row in `medicine_catalog_imports` records `imported_rows`, so a
  re-run skips what landed. A test kills an import mid-chunk and asserts the resume completes
  to the same final state as an uninterrupted run.
- Owner-only, reusing `requireOwner` from `db/auth.ts` — the same gate `inventoryImport.ts`
  already uses.

**Lookup `db/medicineCatalog.ts`:** `searchCatalog(query, limit)`, `getCatalogEntry(id)`,
— both **reads**. There is deliberately **no** catalog-to-`medicines` writer: a catalog hit
becomes a shop-owned row only through the existing atomic `createMedicineWithPurchase` when
the user presses Save (see the selection flow below). Revision 4 left a stale line here
requiring a `createMedicineFromCatalog(shopId, catalogId, overrides)` bridge while the flow
below forbade it — a self-contradiction a round-4 finding caught, and the kind of residue
that leads an implementer to rebuild the forbidden early-write path.

**Revision 2, finding F4 — the integration seam already exists, and revision 1 planned a
redundant screen.** `apps/mobile/domain/medicineSearchProvider.ts` is a purpose-built seam
for precisely this work. Its own header says it is *"the seam a real ~21k medicine
master-database search/select will plug into later, without redesigning Add Medicine's UI.
No backend/dataset decision has been made yet (MedEx vs. another source is still
pending) — this stub always returns no results, which the UI renders as an explicit 'not
connected yet' state, never a fake or fixture match."* It exports a `MedicineSearchProvider`
interface, a `MedicineSearchResult` shape, and `unavailableMedicineSearchProvider`.

The consuming UI exists too: `components/inventory/SearchMedicineTab.tsx` takes a
`provider?: MedicineSearchProvider` prop (defaulting to the unavailable one), renders a real
search input and result rows, and shows the "not connected yet" state with a route into
Manual Entry. `app/inventory/add-medicine.tsx` and `ManualEntryForm.tsx` already consume
`MedicineSearchResult`, and `tests/inventory/inventory-remediation.test.tsx:228` already
proves a provider returning real results renders correctly.

So Batch 2 **implements the existing interface** and passes it in. `db/medicineCatalog.ts`
exports a `catalogMedicineSearchProvider: MedicineSearchProvider`, and
`add-medicine.tsx` passes it to `SearchMedicineTab`. Consequences:

- `app/inventory/catalog-picker.tsx` is **removed from this plan.** Revision 1 would have
  built a second medicine-search UI beside a working one.
- **Revision 2's claim that the existing shape suffices was wrong** (review finding 8).
  `MedicineSearchResult` carries only `id`, `name`, `generic?` and `manufacturer?`;
  `SearchMedicineTab.tsx:70-89` renders only those; selection forwards that same object into
  `ManualEntryForm.tsx:101-108`, which prefills three fields — and **no planned caller ever
  invoked `getCatalogEntry`**, so strength, dosage form, pack size and the Bangla names were
  simply lost. For a 21,000-row catalog that is not a cosmetic gap: "Napa 500mg tablet" and
  "Napa 665mg tablet" would arrive as two identical rows reading `Napa`, and the user would
  pick blind. Corrected on three points:

  **(a) The interface gains optional disambiguating fields.** `strength?`, `dosageForm?` and
  `packSize?` are added to `MedicineSearchResult`, and `SearchMedicineTab` renders them as a
  secondary line. They are **optional**, so `unavailableMedicineSearchProvider` and the
  existing test keep compiling unchanged. They are **never concatenated into `name`** —
  `medicines.name` must stay the brand name, because `medicines_fts` indexes it and
  `findExactNameMatch` compares against it, so polluting it would corrupt both the sale
  scan's exact-match gate and existing search behaviour.

  **(b) Selection reads the catalog but writes nothing; Save stays the only commit path.**
  Revision 3 proposed `createMedicineFromCatalog(shopId, catalogId, overrides)` and that was
  wrong twice over (delta finding — *catalog selection remains lossy or bypasses the
  existing atomic save*): **no planned UI caller ever invoked it**, so the extra fields were
  still lost; and calling it at selection time would have written a `medicines` row before
  the user pressed Save — bypassing both the explicit-confirmation rule this batch exists to
  strengthen (§6.2.3) and the existing atomic `createMedicineWithPurchase` transaction that
  creates the medicine, its supplier link and its first batch together.

  Corrected flow, which changes no commit boundary:

  1. On selection, `SearchMedicineTab` calls `getCatalogEntry(id)` — a **read**. It hands
     the full catalog row to `add-medicine.tsx` in place of the four-field search result.
  2. `ManualEntryForm` gains the mapped fields as **prefills**, fully editable:
     `brandName → name`, `genericName → generic`, `manufacturer → manufacturer`,
     `strength → strength`, `dosageForm → type` (the existing dosage-form column),
     `packSize → unitOfMeasure` only when it names a unit, otherwise dropped. Nothing is
     concatenated into `name`.
  3. **Save still commits**, through the existing `createMedicineWithPurchase` — whose input
     type is extended with the newly-mapped fields. There is no second write path, and
     `createMedicineFromCatalog` is **not** built.

  A test asserts a catalog row with every field populated reaches the form with each value
  in its own field; that nothing is written before Save; and that the resulting `medicines`
  row carries strength and dosage form in their own columns. A mutation check writes at
  selection time and must fail the no-write-before-Save assertion.

  **Bangla names are deliberately not modelled on `medicines` yet.** `brandNameBn` /
  `genericNameBn` exist on `medicine_catalog` and feed the **search index** (§6.5), which is
  what the Bangla-search requirement needs. Adding Bangla columns to the shop-owned
  `medicines` table would change a **synced** table's shape, and that is a Postgres
  migration behind the seal. Stated as a bounded limitation, not an oversight: Bangla search
  works; Bangla display names on a shop's own medicine row wait for E4.

  **(c) Stale-query protection.** `SearchMedicineTab`'s `handleChangeText` currently does
  `void provider.search(text).then(setResults)` with no ordering guard, so against a real
  21k catalog a slow early query can resolve after a fast later one and overwrite the
  results. It reuses the existing `domain/latestRequestGuard.ts` — the module W3-01 extracted
  for exactly this — rather than a new mechanism. A test resolves two searches out of order
  and asserts the later query's results win.
- The "not connected yet" state becomes the honest **empty-catalog** state: with no licensed
  dataset imported (§6.4), the provider returns no results and the existing UI already says
  so correctly. **Scope D therefore degrades gracefully to exactly today's behaviour** until
  a licensed file is imported — which is why shipping zero rows breaks nothing.
- This also confirms §6.4 from inside the repository: the codebase itself records the dataset
  decision as "still pending," and names MedEx as an unresolved option.

A test asserts `add-medicine.tsx` passes a provider other than
`unavailableMedicineSearchProvider`, so the wiring cannot silently regress to the stub.

### 6.4 The dataset: verified provenance, and why no data ships

Scope D says *"Identify an authentic, licensed medicine dataset"* and *"Do not invent
medicine records or claim 21K without verifying the actual count."* What verification found:

| Source | What it is | Count | Licence |
|---|---|---|---|
| **DGDA** — `info.dgda.gov.bd/allopathic-medicines`, `dgda.gov.bd` | the authoritative Bangladesh government registry; the registry of record | its portal reports **~34,000** allopathic products — **not** 21,000 | no stated open licence; **no confirmed bulk export**; the English portal's **TLS certificate is currently expired**, so it could not be fetched for this plan |
| **Kaggle "Assorted Medicine Dataset of Bangladesh"** | six CSVs, the medicine file ~**21,000** rows — this is almost certainly where the 21,000 figure comes from | ~21,000 | **no stated licence.** Acknowledged as scraped from **medex.com.bd**, a private portal |
| `github.com/ahmedshahriar/bd-medicine-scraper` | the scraper behind that Kaggle dataset | — | source is medex.com.bd |
| `github.com/mahfuj-m/Medicine-s-Dataset` | medicine.csv / medicine.json | — | author states **"all rights reserved to MedEx"** |
| Kaggle MedEasy "All medicine data (20k)" | an online-pharmacy retail catalogue, not a registry | ~20,000 | retailer catalogue |

**Conclusion, stated plainly:** the ~21,000 figure matches a MedEx-derived scrape that
carries no redistribution licence, and the authoritative DGDA registry holds roughly 34,000
products, not 21,000. There is therefore **no dataset this batch can lawfully ship**, and
the "21,000" count cannot be asserted from a licensed source. Shipping the scrape would put
unlicensed third-party data into a public repository and into every installed app.

So: the **entire pipeline** is built and proven against synthetic fixtures, and **zero
catalog rows ship**. This is also what CLAUDE.md rule 9 requires — the table is created
empty and the owner imports a licensed file. New gate **E7** records the founder decision
needed: obtain DGDA data under licence, licence the MedEx data commercially, or supply
another licensed file. The importer accepts any of them; only the `source`/`source_version`
strings change.

### 6.5 W2-03 — English, Bangla and Banglish search

New shared module `packages/utils/src/bengali.ts` — framework-free, in `packages/utils`
because `DEVELOPMENT_RULES.md` requires one definition of shared logic and both the mobile
app and the importer need it.

| Function | Behaviour |
|---|---|
| `normalizeBengali(text)` | Unicode NFC; strip ZWJ/ZWNJ (U+200C/U+200D); normalize nukta and the two ya-phala forms; fold Bengali digits (U+09E6–U+09EF) to ASCII; collapse whitespace; casefold |
| `banglishToBengali(text)` | table-driven, **longest-match-first** romanization → Bengali. A documented, deterministic mapping — no ML, no network, no ambiguity resolution by guess |
| `bengaliToBanglish(text)` | the reverse fold, used to build the index key |
| `medicineSearchKeys(text)` | the token set actually indexed: the normalized original, the Bengali normalization, and the ASCII/Banglish fold — joined into `search_key` |

Because one `search_key` holds all three folds, `"নাপা"`, `"Napa"`, `"napa"` and `"napA"`
all reach the same FTS row with one query and no per-locale branch. The query is passed
through the same `medicineSearchKeys` before being turned into an FTS prefix query by the
**existing** `toFtsPrefixQuery` pattern from `db/sales.ts` — not a second query builder.

**Spelling tolerance** reuses `domain/medicineMatch.ts`'s `similarityScore`; it is **not**
re-implemented. The fallback runs only when the FTS prefix query returns zero rows, over a
bounded candidate set drawn from the first-character bucket, so the fast path stays fast.

**Ambiguity is never resolved by guessing.** Multiple hits are returned ranked
(`bm25` then name, matching `searchMedicinesForSale`); nothing is auto-selected. This is the
same rule that `findExactNameMatch` already enforces for the strip scan.

Tests: a correctness table of English/Bangla/Banglish inputs → expected hit; round-trip
properties for the transliterator; a zero-width-joiner case; a Bengali-digit case; an
ambiguity case asserting two ranked results and no auto-select; and a performance bound
asserting a search over a synthetic 21,000-row catalog stays under a declared wall-clock
ceiling. Plus a mutation check: removing the Banglish fold from `search_key` must make the
Banglish rows fail.

---

## 7. W4-09 / W4-10 — direct bKash, and SSLCommerz retirement

### 7.1 The verified official contract

Taken from bKash's own developer documentation (`developer.bka.sh`) and its own
S3-hosted *Tokenized Checkout — API Integration Guide*, read directly. **No endpoint, field
or security parameter in this plan is inferred.** The flow used is **Tokenized Checkout
without agreement**, because a subscription charge is a one-off payment and the agreement
flow would force every owner through a wallet-registration ceremony first.

Sandbox base: `https://tokenized.sandbox.bka.sh/v2/tokenized-checkout`

| Operation | Method + path | Headers | Request body | Response fields used |
|---|---|---|---|---|
| Grant token | `POST /auth/grant-token` | `Content-Type`, `Accept`, `username`, `password` | `app_key`, `app_secret` | `id_token`, `refresh_token`, `expires_in` (3600), `token_type` |
| Refresh token | `POST /auth/refresh-token` | same | `app_key`, `app_secret`, `refresh_token` | same |
| Create payment | `POST /payment/create` | `X-App-Key`, `Authorization`, `Content-Type` | `payerReference`, `callbackURL`, `amount`, `currency`, `intent`, `merchantInvoiceNumber` | `paymentId`, `bKashURL`, `transactionStatus`, `successCallbackURL`, `failureCallbackURL`, `cancelledCallbackURL`, `signature` |
| Execute payment | `POST /payment/execute` | same | `paymentId` | `trxId`, `transactionStatus` (`Completed`), `amount`, `currency`, `payerAccount`, `merchantInvoiceNumber`, `maxRefundableAmount` |
| Query payment | `POST /query/payment` | same | `paymentId` | `transactionStatus` (`Completed` \| `Initiated`), `verificationStatus`, `trxId`, `amount`, `currency`, `merchantInvoice` |
| Search transaction | `POST /general/search-transaction` | same | `trxId` | `transactionStatus`, `amount`, `currency`, `completedTime`, `payerAccount` |
| Refund | `POST /refund/payment/transaction` | same | `paymentId`, `refundAmount`, `sku`, `reason`, `trxId` | `refundTrxId`, `refundTransactionStatus`, `originalTrxId` |

Error shapes: `externalCode` + `errorMessageEn` on business APIs; `statusCode` +
`statusMessage` on the token APIs. Documented token rules honoured: refresh at the
50–55-minute mark, and **at most two refreshes per hour** (exceeding it blocks the app for an
hour), so the client refreshes on a margin and falls back to a fresh grant rather than
retrying a refresh.

**The live base URL is not published** — bKash supplies it at merchant on-boarding. It is
therefore **configuration with no default**, and an unset value fails closed. That is the
rule "never invent endpoints" applied literally: this plan ships the two paths the
documentation states verbatim and takes the host from config.

**Three gaps in this contract, all of them security-relevant** (review finding 7). The rule
"never invent endpoints or security fields" applies to the *absences* too, so each is named
rather than filled in:

1. **The callback request contract is not documented here.** The table above covers the
   seven server-to-server calls, but not what bKash sends **to** `callbackURL` — its method,
   its parameters, or how `paymentId` and the success/failure/cancel outcome are recovered
   from it. Revision 2 nevertheless routed `payment-webhook/handler.ts` by provider, which
   would have forced an implementer to invent the parsing — at exactly the point where
   payment authentication happens. **Callback handling is therefore BLOCKED** (gate E8) and
   this batch implements **none** of it for bKash. The device learns the outcome the way it
   already does for a lost deep link: by asking the server, which calls `/query/payment`.
   The documented `successCallbackURL` / `failureCallbackURL` / `cancelledCallbackURL`
   values are used only as the redirect targets bKash returns them as — never as an
   authorization input.
2. **The `Authorization` header's value format is named but not specified.** The docs give
   the header and the `id_token`, and the token response carries `token_type: "Bearer"`, but
   the exact value the business APIs expect is not stated in the material read. Treated as
   configuration-adjacent: the provider module sends the `id_token` and the form is pinned
   by a single constant with a comment recording the uncertainty, so one change fixes it if
   bKash's onboarding material says otherwise.
3. **`/payment/create` returns a `signature` field with no documented verification
   procedure.** It is therefore **explicitly ignored and treated as untrusted** — not
   stored, not compared, not used in any decision. A test asserts no code path reads it.
   Trusting an unverifiable signature is worse than ignoring one, because it reads as a
   check that is not one.

**IPN is deliberately not trusted either.** bKash's IPN is an SNS-style signed POST carrying
`Signature`, `SignatureVersion` and `SigningCertURL`, but **bKash does not document the
verification procedure**. An unverified webhook must never grant an entitlement, so this
batch implements **no IPN trust path at all**; verification is server-pull only
(`/query/payment`), which is the same posture W3-06 established for SSLCommerz.

Gate **E8** covers all of the above: the official callback contract, the `Authorization`
value format, and the signature/IPN verification procedures must come from bKash's
onboarding material before any callback or signature path is built.

### 7.2 Code — **DESIGN ONLY; not implemented in this batch**

> Everything in this subsection is the **preserved design** for W4-09, which §7.5 reports
> BLOCKED. `_shared/bkash.ts` and `_shared/paymentProvider.ts`'s bKash branch are **not
> written** in Batch 2. The exception is the provider-abstraction *refusal* path, which
> belongs to W4-10 and **is** implemented — see §7.6. Read what follows as the specification
> the next attempt starts from, not as work this batch ships.

- **`_shared/paymentProvider.ts`** — the abstraction. A `PaymentProvider` interface
  (`providerId`, `createSession`, `verify`, `matchesOrder`) and `resolveProvider(read)`,
  which selects from `PAYMENT_PROVIDER` and **throws `PaymentProviderError(503,
  'payment_not_configured')` on unset, unknown, or `'sslcommerz'`**. A test asserts
  `resolveProvider` can never return the SSLCommerz implementation, whatever the environment
  says — that is W4-10's enforcement, not a comment.
- **`_shared/bkash.ts`** — the implementation against §7.1. Token cache with the refresh
  margin and the two-per-hour cap; `isAllowedCheckoutUrl` re-checked against the configured
  bKash host exactly as the SSLCommerz module does for its own; amount conversion reusing the
  existing exact-integer `paisaToProviderAmount` / `providerAmountToPaisa` helpers so no float
  math enters a money path.
- **`verifyBkashPayment`** — `POST /query/payment`, then a strict conjunction, mirroring
  `verificationMatchesOrder`: `transactionStatus === 'Completed'`, a non-empty `trxId`,
  `merchantInvoice === order.transactionId`, exact integer-paisa amount equality,
  `currency === 'BDT'`. Anything else is a rejection that is recorded, not a retry.
- **Idempotency** reuses the existing `payment_provider_events` unique `(provider,
  validation_id)` and `(provider, event_key)` constraints, with `trxId` as the validation id —
  so a **replayed status poll** grants exactly one entitlement — the property W3-06 already
  proves for the other provider. ("Redelivered callback" was the wrong term here: bKash has
  no trusted callback in this design, and the replay that must be idempotent is a repeated
  `billingStatus` poll, not an inbound webhook.)
- **`billing.ts`** — `initiateBilling` calls `resolveProvider()` instead of
  `sslCommerzConfig()`, still failing before any checkout URL is read or reused.
- **`payment-webhook/handler.ts`** — **stays SSLCommerz-only**, unchanged but for a comment
  recording why. Revision 3 said "no bKash callback parsing" in §7.1 while simultaneously
  routing this handler by provider: a third CRITICAL defect (delta finding — *bKash has no
  complete server-pull completion path*). A provider-routed webhook whose contract is
  blocked leaves an implementer either inventing the parsing or leaving completed bKash
  payments **unapplied forever**. The handler keeps serving historical SSLCommerz orders and
  never sees a bKash one.
- **`billing.ts` — `billingStatus` is where a bKash payment completes.** This needs no new
  endpoint: it is already authenticated, already owner-gated, already accepts `body.orderId`,
  and already reconciles that order (it expires a stale `created`/`pending` order past
  `expires_at`). It gains one branch — when the named order is a `pending` **bKash** order,
  call `/query/payment`, apply `verifyBkashPayment`, and on `Completed` invoke the new
  `b4_apply_verified_payment` signature with `p_provider='bkash'`, the merchant invoice,
  `paymentId` and `trxId`. Anything short of `Completed` leaves the order untouched for the
  next poll; a mismatch records a rejection rather than retrying.

  **The order of operations must be reversed, and revision 4's claim that this endpoint is
  already owner-gated was wrong — two more defects** (round-4 findings: *bKash completion is
  ordered after destructive reconciliation*; *`billingStatus` is not owner-gated*).

  **(i) Ordering.** `billing.ts:55-75` currently runs `b4_refresh_entitlement_snapshot` →
  `b4_reconcile_plan_limits` → **expire the stale `created`/`pending` order** → *then* read
  it. Adding query/verify/apply without reordering means a **paid, completed order can be
  marked `expired` before anyone asks bKash about it**, and the entitlement is never granted.
  The corrected sequence is explicit:

  1. select the account-scoped order named by `orderId`;
  2. if it is `pending` **and** bKash → `/query/payment` → `verifyBkashPayment` → apply;
  3. **only then** expire it, and only if step 2 did not complete it;
  4. then `b4_refresh_entitlement_snapshot` and `b4_reconcile_plan_limits`;
  5. then build the response.

  Tests: an order past `expires_at` that bKash reports `Completed` must be granted, not
  expired; two concurrent `billingStatus` calls for the same order must grant exactly once
  (the SQL's own order lock and `verified` guard at
  `b4_commercial_platform.sql:665` make this safe, and the test proves it rather than
  assuming it).

  **(ii) Authorization.** `billingStatus` calls `assertCallerCurrent`, **not**
  `requireOwner` — `requireOwner` is used by `initiateBilling` (`:90`) and
  `finalizeBillingAttempt` (`:180`) only. A non-owner carrying a billing-account id reaches
  it today, which is correct for ordinary entitlement hydration and **not** acceptable for
  applying a payment. So the **`orderId` completion branch is owner-gated**
  (`record.isOwner && record.billingAccountId`) while the existing staff hydration path is
  left exactly as it is. A non-owner passing an `orderId` gets the normal status response
  with no verification attempted — not an error, because staff hydration must keep working.
  A test asserts a non-owner cannot trigger verification and that their hydration still
  succeeds.

  The device already calls `billing-status` with its `orderId` on return from checkout, on
  app foreground and on reconnect — the hydration paths W3-06 built — so a lost deep link, a
  killed browser or a dropped network all resolve on the next status call. That is the
  master plan's "entitlement resolves only from server state on next hydration", reached
  without trusting any callback.

  An end-to-end test drives create → execute → `billingStatus` and asserts the entitlement
  is granted exactly once, that a second call grants nothing further, and that an order left
  `Initiated` at bKash grants nothing at all.
- **Mobile:** `db/schema.ts:325` provider enum → `['bkash']`; `db/commercial.ts:467` →
  `provider: 'bkash'`; `app/settings/plan-payment.tsx` branding and both Bangla and English
  strings → bKash. **SQLite migration `0033` is NOT created** (revision 6): it would relax
  `payment_attempts`' provider CHECK to admit `'bkash'`, which is dead scope while no
  code writes `'bkash'`. Retained here only as the design a resumption would need, which
  would rebuild
  `payment_attempts` to relax `CHECK (provider = 'sslcommerz')` to
  `CHECK (provider IN ('bkash','sslcommerz'))` — keeping the legacy value readable so an
  in-flight historical attempt row still loads, while new rows are bKash. (SQLite cannot
  `ALTER` a CHECK; the migration uses the create-copy-drop-rename pattern, preserving the
  three indexes and the unique constraint. A test asserts a pre-existing `sslcommerz` row
  survives the upgrade and a `'stripe'` row is still rejected.)
- **SSLCommerz is retired, not deleted.** `_shared/sslcommerz.ts` and its 47 tests remain as
  a retired implementation so the historical evidence survives, and `resolveProvider` cannot
  reach it. Deleting it would destroy W3-06's accepted test evidence for no safety gain.

### 7.3 The blocker, stated exactly

A bKash payment **cannot be persisted in Postgres.** Revisions 1–2 described four pins and
named one table wrongly; review finding 1 showed there are **five change points plus a
semantic blocker that no CHECK change fixes**:

```
b4_commercial_platform.sql:105   billing_subscriptions.provider    check (provider='sslcommerz')
                                 (r1/r2 called this `subscriptions`. The LEGACY
                                 `subscriptions.payment_provider` is unconstrained text
                                 and is NOT a blocker at all)
b4_commercial_platform.sql:149   payment_orders.provider           check (provider='sslcommerz')
                                 AND default 'sslcommerz' — the insert in billing.ts never
                                 writes the column, so it relies on that default
b4_commercial_platform.sql:169   payment_provider_events.provider  check (provider='sslcommerz')
b4_commercial_platform.sql:659   b4_apply_verified_payment         literal #1 — the
                                 payment_provider_events insert
b4_commercial_platform.sql:701   b4_apply_verified_payment         literal #2 — the
                                 billing_subscriptions insert
```

**The semantic blocker — the part that would have shipped broken.**
`b4_apply_verified_payment:677` is:

```sql
if v_order.provider_transaction_id is distinct from p_provider_transaction_id then
  ... raise exception 'payment transaction does not match order' using errcode='MU031';
```

For SSLCommerz this round-trips, because the merchant-generated `tran_id` that `billing.ts`
stores in `provider_transaction_id` is the same value the validation response returns. For
**bKash the two are different values**: `merchantInvoiceNumber` is merchant-generated, while
`trxId` is bKash's own identifier, minted at execute time. So with revision 2's design:

- passing `trxId` as `p_provider_transaction_id` → the comparison fails and **every single
  payment is rejected** with `MU031`;
- passing the invoice instead → the comparison passes, but `trxId` — the only identifier
  bKash's own support, refund and search APIs accept — is **never stored anywhere**.

Relaxing the CHECKs would not have revealed this; it would have produced a system that
either refused all payments or lost the transaction id. **Three identifiers must be kept
distinct**, and the staged SQL and the caller are redesigned around that:

| Identifier | Minted by | Sent/received as | Stored in |
|---|---|---|---|
| merchant invoice (`MTH…`) | us, at order creation | `merchantInvoiceNumber` → echoed in `/payment/execute` and `/query/payment` as `merchantInvoiceNumber` / `merchantInvoice` | `payment_orders.provider_transaction_id` — **unchanged**, so the `MU031` contract and the `unique` constraint keep working |
| `paymentId` | bKash, at `/payment/create` | the handle for `/payment/execute` and `/query/payment` | `payment_orders.provider_session_key` (existing nullable text, currently the SSLCommerz session key) |
| `trxId` | bKash, at `/payment/execute` | the real transaction id; the only one `/refund` and `/general/search-transaction` accept | `payment_provider_events.validation_id` (the idempotency key) **and** `billing_subscriptions.provider_reference`, via a new parameter |

`b4_apply_verified_payment` therefore takes a `p_provider` parameter (replacing both
literals) and a `p_provider_reference` parameter for `billing_subscriptions.provider_reference`,
while `p_provider_transaction_id` keeps its existing meaning — the merchant invoice checked
against the order. `payment_orders.provider` is written **explicitly** by the caller rather
than relying on a default, and the default itself is dropped so no future insert silently
lands as SSLCommerz.

**"Gains a parameter" is not a thing Postgres does, and saying so was a CRITICAL defect**
(delta finding: *old payment function survives as an overload*). Postgres identifies a
function by **name plus argument types**, so `create or replace function
b4_apply_verified_payment(… 7 args)` does **not** replace the five-argument function at
`b4_commercial_platform.sql:643` — it creates a second, independent function. The old one
would keep its body, its `'sslcommerz'` literals, its `security definer` and its
`grant execute … to service_role` from `:731-732`, and `payment-webhook/handler.ts:123`
calls it by name through `.rpc()`. The new pgtest could pass while production still invoked
the obsolete routine against the old identifier semantics.

The staged SQL therefore **retires the old signature explicitly** — but **not in one step,
because the database and the Edge Functions do not deploy atomically** (round-4 finding:
*function replacement has unavoidable deployment version skew*). Revision 4 said every
caller is "updated in the same change", which is not a thing the platform offers: applying
the SQL first breaks the live five-argument caller at
`payment-webhook/handler.ts:123`, and deploying the functions first breaks them against the
old database. Either way **live SSLCommerz callbacks fail during the rollout** — real money,
mid-flight.

So the retirement is **phased**, and each phase is a single transaction:

```sql
-- PHASE 1 (ships with this batch's staged SQL, once E4 unseals the chain).
-- Additive only: the 5-arg function keeps working untouched.
begin;
  create function b4_apply_verified_payment(uuid,text,text,text,text,text,jsonb) …;
  revoke execute on function b4_apply_verified_payment(uuid,text,text,text,text,text,jsonb)
    from public,anon,authenticated;
  grant  execute on function b4_apply_verified_payment(uuid,text,text,text,text,text,jsonb)
    to service_role;
commit;

-- PHASE 2: deploy the Edge Functions that call the 7-arg signature. Verify in the
-- hosted environment that no caller invokes the 5-arg one any more.

-- PHASE 3 (a separate, later change — NOT this batch):
begin;
  revoke execute on function b4_apply_verified_payment(uuid,text,text,text,jsonb)
    from service_role;
  drop function b4_apply_verified_payment(uuid,text,text,text,jsonb);
commit;
```

Both signatures coexist only between phases 1 and 2, and that is deliberate: the overload
hazard the earlier finding identified is *contained* by the grant — during the window the
5-arg function is still the one live callers hold, which is exactly the compatibility that
makes the window safe. **Phase 3 is what closes it**, and it is listed as its own
deliverable rather than assumed.

The pgtest covers both states: after phase 1 it asserts the 7-arg function exists, is
granted to `service_role` only, and applies a bKash payment correctly; after a simulated
phase 3 it asserts
`to_regprocedure('b4_apply_verified_payment(uuid,text,text,text,jsonb)') is null`. A
negative control recreates the five-argument function and the phase-3 assertion must fail.

**This is a Batch 3 sequencing dependency, recorded as such:** phase 3 cannot run until
phase 2 is verified in the hosted environment, which is an E4-gated operation.

The new body also **rejects a provider mismatch**: `if p_provider is distinct from
v_order.provider then … raise` using a distinct error code. Without it, a bKash verification
could be applied against an order created for a different provider.

Because this changes a money function's signature and its idempotency keying, §12 requires
an **isolated Postgres test** that applies the staged SQL and asserts provider, invoice,
`paymentId`, `trxId`, event count, order state and entitlement version across a replay
(review finding 12). A fetch double cannot prove any of it.

Relaxing those three checks and re-parameterising that function is a new file in
`backend/supabase/migrations/`, which breaks all three H-9 gates (§9). So the SQL is
**written and reviewed but staged outside the chain**, at
`backend/supabase/deploy/batch2-bkash-provider.sql`, exactly as W4-05's artefact was in
Batch 1. Reported BLOCKED under gate E4.

**Why the batch is still coherent and still safe.** With `PAYMENT_PROVIDER=bkash` and no
bKash credentials configured, `resolveProvider()` throws `payment_not_configured` (503)
*before* an order is created — so the blocked DB write is never reached in the shipped
state. The founder's requirement "the system fails closed without bKash merchant
credentials" is therefore met *by* the blocker, not despite it.

---

### 7.5 W4-09 is BLOCKED and not implemented — the precise constraint

Gate 1 requires: *"If a mandatory backend migration, external identity-provider choice,
unavailable licensed medicine dataset or **official bKash contract** blocks complete
implementation, identify the precise constraint. Do not invent a workaround or silently
defer tasks."* The official bKash contract does block complete implementation. This section
is that identification, and the founder approved stopping here on **2026-10-22**.

**The contract gaps — what bKash does not publish.** Seven server-to-server calls are fully
documented and verified (§7.1). Three things an implementation needs are not:

| Gap | Why it blocks implementation, not just hardening |
|---|---|
| **The callback request contract** | bKash redirects the payer to `callbackURL`, but its method, parameters, and how the outcome and `paymentId` are recovered are undocumented. Any implementation must invent the parsing — at the point where payment authentication happens |
| **The `Authorization` value format** | the header name and `id_token` are given; the exact value the business APIs expect is not stated in the published material |
| **Signature and IPN verification procedures** | `/payment/create` returns a `signature`, and IPN is SNS-style signed with `Signature` / `SignatureVersion` / `SigningCertURL`. **Neither verification procedure is documented.** An unverifiable signature cannot be trusted, so neither can be used |

**The other four blockers, none of which this batch can clear:**

1. **E4 — the H-9 migration seal.** The five provider pins plus the `MU031` identifier
   semantics (§7.3) all require a Postgres migration. The chain is sealed at 34.
2. **Merchant credentials.** None exist, and creating them is outside this batch's
   authorization.
3. **The live base URL.** Unpublished; bKash supplies it at onboarding.
4. **Phased rollout.** Retiring the five-argument `b4_apply_verified_payment` spans three
   phases, and phase 3 cannot run until phase 2 is verified in the hosted environment —
   an E4-gated operation in Batch 3.

**Why writing the code anyway was rejected.** It would be written against three undocumented
security-relevant surfaces, could not be activated, and would be rewritten when the real
contract arrives — while adding an unexercised money-handling path to the repository. The
safe posture is already in place and is *improved* by W4-10: with SSLCommerz retired from
routing and no bKash implementation wired, `resolveProvider()` fails closed with
`payment_not_configured` (503) before any order is created. No money can move in either
direction.

**What W4-09 delivers instead, and it is not nothing:**

- the **verified seven-endpoint contract** from bKash's own documentation (§7.1), with its
  three gaps named rather than guessed — so the next attempt starts from evidence;
- the **five-point blocker analysis** (§7.3), including the `MU031` identifier conflation
  that four review rounds were needed to find and that would otherwise have shipped as
  "bKash rejects every payment";
- the **three-identifier design** (merchant invoice / `paymentId` / `trxId`) that resolves it;
- the **phased-rollout SQL specification** (§7.3) that avoids breaking live SSLCommerz
  callbacks mid-deploy;
- the **completion-path design** — ordering, owner-gating and idempotency in `billingStatus`
  (§7.2) — with the two ordering/authorization defects already corrected.

All of it is recorded in `docs/plans/bkash-integration-runbook.md` at Gate 4.

**New gate E8** records the three documentation gaps. W4-09 resumes when E8 and E4 are
cleared, and not before.

### 7.6 W4-10 still ships, and what it means without bKash

Retiring SSLCommerz is **not** contingent on bKash existing, and it is implemented:

- `_shared/paymentProvider.ts` ships with `resolveProvider(read)` that returns **no**
  provider for an unset or unknown `PAYMENT_PROVIDER` **and explicitly refuses
  `'sslcommerz'`**, throwing `PaymentProviderError(503, 'payment_not_configured')`. A test
  asserts it can never yield the SSLCommerz implementation whatever the environment says.
- `billing.ts`'s `initiateBilling` calls `resolveProvider()` instead of `sslCommerzConfig()`,
  so it fails before any checkout URL is read or reused.
- The mobile side stops naming SSLCommerz in its **UI**, and nothing else:
  `app/settings/plan-payment.tsx`'s SSLCommerz card becomes a **payment-unavailable** state
  in both locales. `db/schema.ts`'s provider enum, `db/commercial.ts` and SQLite migration
  `0033` are all **left alone** — nothing writes `'bkash'`, so changing them is dead scope.
- **`apps/mobile/sync/billing.ts` must fail locally, before the local row is written**
  (round-6 finding 2a). `initiatePlanPayment:77` calls `createPaymentAttempt` at `:85`
  **before** the server request, so revision 6's premise that server refusal makes the local
  write unreachable was wrong: a `payment_attempts` row carrying `'sslcommerz'` would be
  created on every attempt and orphaned when the server returned 503. So
  `initiatePlanPayment` checks payment availability **first** and throws
  `payment_not_configured` without creating a local row. A test asserts no
  `payment_attempts` row exists after a refused attempt — which is also what keeps the
  untouched SQLite CHECK harmless.
- `_shared/sslcommerz.ts` and its 47 tests are **retired, not deleted** — the historical
  W3-06 evidence survives and `resolveProvider` cannot reach the module.

**The honest consequence, stated plainly:** after W4-10 the product has **no active
subscription payment path at all**, and `payment-webhook/handler.ts` continues to serve only
historical SSLCommerz orders. That is the direct result of the founder's locked decision
("SSLCommerz is no longer approved", "Direct bKash is the ONLY subscription payment
gateway") combined with W4-09's blockers. It changes nothing operationally — the system
already failed closed with no credentials configured — but it must not be described as a
working payment integration anywhere, and no pilot or production sign-off can treat
subscriptions as functional until E8 and E4 clear.

---

## 8. Documentation (Gate 4)

| File | Change |
|---|---|
| `docs/plans/muthoy-five-batch-delivery-ledger.md` | Batch 2 status on both axes; the nine IDs from §2; gates E7 and E8 added; E5 closed by the founder's decision |
| `docs/plans/muthoy-batch-2-plan.md` | this document, with its review log |
| `docs/plans/muthoy-batch-2-implementation-2026-10-21.md` | the implementation record: per-task before/after, test counts, exit codes |
| `DECISIONS.md` | **appended at the end** (the file's convention is chronological-ascending after one pinned top entry; the uncommitted H-9 hunk at line 3654 is untouched): the bKash supersession of the 2026-08-31 "SSLCommerz is first provider" decision, preserving its text; the catalog's rule-9 reconciliation; the admin stateless-session decision; the barcode contradiction |
| `docs/plans/medicine-catalog-provenance.md` | new — §6.4's provenance table, the import format, the licensing gate, and what "verified count" will mean once a licensed file exists |
| `docs/plans/ocr-and-multilingual-search.md` | new — the OCR architecture as it now stands (correcting `ocr.md`'s stale status text), the confirmation gates, the image-deletion guarantee, and the transliteration tables |
| `docs/plans/bkash-integration-runbook.md` | new — the §7.1 contract with its sources, the required configuration, the fail-closed matrix, the staged SQL, and the four live-activation gates |
| `docs/plans/admin-auth-rbac.md` | new — roles, permissions, session properties, the audit sink and its honest limits, and provisioning without a plaintext password |
| `apps/admin/README.md` | Basic Auth → the new scheme; the env var list |
| `docs/plans/ocr.md` | a status header pointing to the new document; historical text preserved |

`CODE-COMPLETE` and `DEVICE/PRODUCTION-VERIFIED` stay separate columns everywhere. No Batch 2
task is claimed as DONE: no physical-device run is authorized, so `DEVELOPMENT_RULES.md`
clauses 2–3 are unmet for all seven by construction.

---

## 9. Database dependencies and the H-9 seal

### 9.1 What the seal is, verified

Adding any file to `backend/supabase/migrations/` breaks three gates:

1. `scripts/h9-prod-preflight.mjs:232` — `if (migrations.length !== 34 || …tail !== H9_MIGRATIONS)
   refuse('migration-chain-unexpected')`.
2. `backend/supabase/checks/h9_postmigration_checks.sql:369-382` — asserts
   `count(*) = 34`, all three H-9 versions present, and
   `not exists (… where version > '20261015000000')`. This file's **SHA-256 is pinned** at
   `361a400a29025f2d859b4cd3e4f826afcdcd2c134a332b3412b9a2e0af1e2bd9`
   (`scripts/h9/h9-a5-dev-readonly.mjs:14`) and its line endings are pinned `text eol=lf` in
   `.gitattributes` "for every file whose SHA-256 is recorded as H-9 evidence." It is
   founder-signed-off sealed evidence.
3. `backend/supabase/pgtest/h9-cron-cleanup.pgtest.ts:406` — records every migration and then
   expects those checks to pass.

### 9.2 What Batch 2 would need from Postgres, and what it does instead

| Need | Blocked by | This batch |
|---|---|---|
| **(DEFERRED WITH W4-09 — §7.5; recorded so the resumption inherits it)** `payment_orders` / `payment_provider_events` / `billing_subscriptions` accept `'bkash'`; `b4_apply_verified_payment` takes the provider **and** a separate provider-reference parameter, so the merchant invoice and `trxId` stop being conflated | §7.3's 5 change points **plus** the `MU031` identifier mismatch → a migration | SQL staged at `backend/supabase/deploy/batch2-bkash-provider.sql`, proven by `pgtest/batch2-bkash-provider.pgtest.ts`; **BLOCKED on E4** |
| A durable admin audit table (`audit_logs` cannot hold an admin action — §1 item 3) | a new table + `service_role` grant → a migration | SQL staged at `backend/supabase/deploy/batch2-admin-audit.sql`; the stderr + ring-buffer sinks ship now behind the same interface; **BLOCKED on E4** |
| `update` on `shops` for location/map | a grant → a migration, **and** W4-05 | not built at all (§5.4); **BLOCKED on E4 + W4-05** |
| `select` on `sale_refunds` for refund-net revenue | a grant → a migration | not built; W4-04, Batch 3's. The GROSS label is preserved and mechanically enforced (§5.2) |

**Everything else needs nothing from Postgres.** The admin build-out reads and writes only
already-granted tables and already-granted RPCs (§1 item 2); the catalog, the search index and
the provider abstraction are SQLite-local or stateless.

### 9.3 SQLite migrations this batch adds

`0032_medicine_catalog.sql` only — `0033` is dropped with W4-09 (§7.5): relaxing
`payment_attempts`' provider CHECK to admit `'bkash'` is pointless when no code writes
`'bkash'`, and `initiateBilling` now fails closed before an attempt row is ever created.
The SQLite chain is
**not** sealed and **not** count-pinned, so extending it breaks no H-9 gate.

**But a new `.sql` file alone does nothing** (review finding 3). Each migration needs
**four** artefacts, and revisions 1–2 listed only the first:

| Artefact | Why |
|---|---|
| `apps/mobile/db/migrations/0032_*.sql` / `0033_*.sql` | the SQL itself |
| an entry appended to `apps/mobile/db/migrations/meta/_journal.json` | `idx: 32` / `33`, with `version`, `when`, `tag`, `breakpoints`. Without it the **test** migrator never applies the file (`db/test/migrations.ts:35-44` iterates `entries`) |
| an `import m0032 from './0032_*.sql'` in `apps/mobile/db/migrations/migrations.js` | without it the **device** never applies the file — the registry is static |
| the matching `m0032` / `m0033` key in that file's default export | Drizzle looks the migration up by key |

A new test asserts the three sets agree: the `.sql` files on disk, the journal's `tag`s, and
`migrations.js`'s export keys. It fails if any future migration is added to one and not the
others — the exact defect this finding caught, made permanent. A negative control adds a
synthetic fourth file to only one set and must fail.

The two fixture tests that enumerate migration filenames explicitly
(`h6-conflict-queue.sqlite.test.ts:55`, `h6-conflict-resolution.sqlite.test.ts:86`) are
per-test fixture lists, not seals, and are updated only if they apply by list.

---

## 10. Contradictions and open decisions (CLAUDE.md rule 11)

| # | Contradiction | This plan's position |
|---|---|---|
| **Q1** | "Barcode scanning is EXCLUDED" vs barcode scanning being implemented and shipped (§6.2.1) | **touch barcode not at all.** Revision 3 removed the ratchet (W5-16) per review finding 9 — scheduling new barcode work while its fate is undecided was incoherent. Nothing is extended, ratcheted or deleted. **Needs a founder answer; blocks no other task** |
| **Q2** | "Approximately 21,000 real medicines must be available offline" vs no licensed dataset and DGDA's own ~34,000 count (§6.4) | ship the whole pipeline, ship zero rows, record gate E7. The 21,000 figure is **not** asserted |
| **Q3** | "Direct bKash is the ONLY subscription payment gateway" vs Postgres pinning `provider='sslcommerz'` (§7.3) | **W4-09 BLOCKED and not implemented** (§7.5, founder-approved 2026-10-22); W4-10 retires SSLCommerz from routing and fails closed locally. Report BLOCKED on E4. The shipped state fails closed, which is the safe posture the decision wants |
| **Q4** | Scope B's "Location/map management" vs the ledger's own interim boundary 2 and W4-05 (§5.4) | build none. Reported BLOCKED |
| **Q5** | CLAUDE.md 9 "no seed/demo data ships" vs a 21K catalog | reconciled, not overridden: reference data ≠ shop seed data; the table ships empty; a fresh shop still starts empty, with a test (§6.3) |
| **Q6** | `docs/plans/ocr.md` describes barcode as "not implemented" in its body while its own header says it is | the header is right; a status note and a new architecture document correct it without rewriting history (§8) |

Items Q2, Q3 and Q4 are **external gates**, not engineering choices. Q1 is the only one that
blocks a code decision inside this batch, and it blocks a *deletion*, so the default (change
nothing) is safe.

---

## 11. Files and the staging manifest

### 11.1 New files

```
apps/admin/lib/adminIdentity.ts            + .test.ts
apps/admin/lib/adminSession.ts             + .test.ts
apps/admin/lib/adminRoles.ts               + .test.ts
apps/admin/lib/adminAuthz.ts               + .test.ts
apps/admin/lib/adminAudit.ts               + .test.ts
apps/admin/lib/adminQueries.ts             + .test.ts        (accounts/subscriptions/payments reads)
apps/admin/lib/adminActions.ts             + .test.ts        (the three write actions)
apps/admin/app/api/admin/session/route.ts
apps/admin/app/login/page.tsx
apps/admin/app/shops/[id]/page.tsx
apps/admin/app/accounts/page.tsx
apps/admin/app/accounts/[id]/page.tsx
apps/admin/app/subscriptions/page.tsx
apps/admin/app/payments/page.tsx
apps/admin/app/audit/page.tsx
apps/admin/components/{AdminNav,DataTable,StatusPill,ActionButton}.tsx
scripts/admin-hash-password.mjs
packages/utils/src/bengali.ts              + .test.ts
apps/mobile/db/migrations/0032_medicine_catalog.sql
apps/mobile/db/medicineCatalog.ts
apps/mobile/db/medicineCatalogImport.ts
apps/mobile/db/medicine-catalog.sqlite.test.ts
apps/mobile/db/medicine-catalog-import.sqlite.test.ts
apps/mobile/db/medicine-catalog-search.sqlite.test.ts
apps/mobile/components/scanner/ScanConfirmSheet.tsx   + .test.tsx
apps/mobile/tests/scanner-capture-privacy.test.ts
apps/mobile/db/migration-registration.test.ts              (journal = registry = .sql files)
                                           (the bKash pgtest and staged SQL move to W4-09's
                                           resumption — see §7.5; neither ships here)
backend/supabase/pgtest/batch2-admin-acl.pgtest.ts         (has_table_privilege matrix)
```

> **Revision 2 removed three planned files.** `native/imageFile.ts` (F3b — duplicates
> `native/prescriptionAttachment.ts`'s existing `File.delete` helper),
> `app/sale/prescription-scan.tsx` (F3c — prescription capture already exists in
> `checkout.tsx`), and `app/inventory/catalog-picker.tsx` (F4 — `SearchMedicineTab.tsx`
> already is that UI).
>
> **Revision 3 removed one more and added three.** Removed:
> `tests/barcode-exclusion-ratchet.test.ts`, because W5-16 is no longer executable scope
> (review finding 9). Added: the migration-registration test (finding 3), the bKash
> persistence pgtest (findings 1 and 12), and the admin effective-ACL pgtest (finding 6) —
> each replacing an assertion that revisions 1–2 could not actually have proven.

```
backend/supabase/functions/sync/_shared/paymentProvider.ts   W4-10 only: resolveProvider()
                                           refuses sslcommerz and has NO bkash branch
backend/supabase/functions/sync/payment-provider.test.ts
backend/supabase/deploy/batch2-admin-audit.sql             (OUTSIDE the chain)
docs/plans/muthoy-batch-2-plan.md
docs/plans/muthoy-batch-2-implementation-2026-10-21.md
docs/plans/medicine-catalog-provenance.md
docs/plans/ocr-and-multilingual-search.md
docs/plans/bkash-integration-runbook.md
docs/plans/admin-auth-rbac.md
```

### 11.2 Modified files

```
apps/admin/middleware.ts                   Basic Auth -> signed session; still fails closed
apps/admin/lib/basicAuth.ts                constantTimeEquals kept and reused; evaluateBasicAuth retired
apps/admin/lib/basicAuth.test.ts           retirement asserted
apps/admin/lib/adminGrants.test.ts         restructured per §5.5, with a negative control
apps/admin/lib/serviceRoleExposure.test.ts extended to the new modules
apps/admin/lib/queries.ts                  pharmacy list gains plan/status columns
apps/admin/app/{layout,page,pharmacies/page}.tsx
apps/admin/{README.md,.env.example}
apps/mobile/db/schema.ts                   medicine_catalog* tables ONLY. The provider enum
                                           and db/commercial.ts are UNTOUCHED — nothing writes
                                           'bkash', so changing them is dead scope (r5)
apps/mobile/app/scan.tsx                   confirmation gate before addItem
apps/mobile/app/inventory/add-medicine.tsx pass catalogMedicineSearchProvider to SearchMedicineTab (F4)
apps/mobile/app/sale/checkout.tsx          run recognition on the prescription capture (F3c)
apps/mobile/native/prescriptionAttachment.ts   + removeTemporaryCapture() (F3b)
apps/mobile/components/scanner/MedicineTextScanner.tsx   scanner-owned deletion on the OCR
                                           path only; captureOnly can also recognise and
                                           hands ownership to the caller (F3a/F3c, r4, r5)
apps/mobile/native/prescriptionAttachment.ts   + removeTemporaryCapture()
apps/mobile/components/inventory/ManualEntryForm.tsx   catalog prefills for strength /
                                           dosageForm / packSize (round-4 finding)
apps/mobile/db/inventory.ts                createMedicineWithPurchase input extended with the
                                           mapped catalog fields — the ONLY commit path
packages/validation/src/inventory.ts       schema for the new optional medicine fields
apps/mobile/tests/localization-and-ui-consistency.test.ts  enrol Batch 2's new screens in the
                                           W3-08 ratchet, whose own header says "the scope
                                           grows as later batches fix more"
apps/mobile/db/migrations/meta/_journal.json   append idx 32 ONLY (finding 3 — without
                                           this the migrations never run under test)
apps/mobile/db/migrations/migrations.js    two static imports + two registry keys (finding 3
                                           — without this they never run on a device)
apps/mobile/domain/medicineSearchProvider.ts   optional strength/dosageForm/packSize on
                                           MedicineSearchResult (finding 8)
apps/mobile/components/inventory/SearchMedicineTab.tsx  render the disambiguating line;
                                           latestRequestGuard for stale queries (finding 8)
apps/mobile/tests/font-tokens.test.ts      assert font-mono on the new admin money elements
                                           (finding 11)
apps/mobile/tests/inventory/inventory-remediation.test.tsx   the catalog-provider UI flow:
                                           read -> prefill -> single atomic Save (r5)
apps/mobile/sync/billing.ts                fail locally with payment_not_configured BEFORE
                                           createPaymentAttempt writes a row (r6 2a)
apps/mobile/tests/sale/resumed-draft-capture.test.tsx   a resumed held draft's DURABLE
                                           prescription survives retake/cancel/unmount (r6 1d)
apps/mobile/app/settings/plan-payment.tsx  payment-UNAVAILABLE state replacing the
                                           SSLCommerz card, bn + en. NOT bKash branding —
                                           there is no bKash integration to brand (§7.6)
apps/mobile/i18n/catalog.ts                new keys, both locales
apps/mobile/db/sales.ts                    search keys via medicineSearchKeys
apps/mobile/db/purchases.ts                same
packages/utils/src/index.ts                export ./bengali
backend/supabase/functions/sync/billing.ts resolveProvider()
backend/supabase/functions/payment-webhook/handler.ts    comment only — stays SSLCommerz-only
                                           for historical orders; bKash never reaches it
vitest.config.ts                           new explicit test entries
DECISIONS.md                               appended at the end only
docs/plans/{muthoy-five-batch-delivery-ledger,ocr}.md
```

### 11.3 Never staged — the 41 pre-existing dirty paths

**Generated from `git status --porcelain=v1 --untracked-files=all`, never from collapsed
output** (review finding 10). Default `--porcelain` reports `.expo/` as one entry while it
holds two files, which is how revisions 1–2 undercounted. An exclusion manifest that
collapses a directory cannot be checked against a staged diff, so the `-uall` form is the
only acceptable source here.

Modified: `DECISIONS.md` (H-9's +137-line hunk at line 3654 — Batch 2 appends at the **end**
and must not touch it), `scripts/h9/install-local-runtime.ps1`,
`apps/prototype-web/Muthoy (prototype)/pnpm-workspace.yaml`.

Untracked (38): 8 `docs/plans/h9-*` documents, 26 `scripts/h9/**` files, and **4** prototype
paths — `.expo/README.md` and `.expo/devices.json` listed **individually**, plus
`pnpm-lock.yaml` and `tsconfig.json`. The superseded collapsed form counted 3
`apps/prototype-web/Muthoy (prototype)/` paths (`.expo/`, `pnpm-lock.yaml`, `tsconfig.json`).

Gate 5 produces an explicit path-level manifest. **`git add .` and `git add -A` are
forbidden**; every path is staged by name.

---

## 12. Test plan — and how each new test is made non-vacuous

Every new suite ships at least one negative control or mutation check that demonstrates the
test can still fail. The planted-shape technique W3-08 established is reused.

| Area | Positive | Negative control / mutation |
|---|---|---|
| Admin auth | correct password authorizes; wrong one does not; absent `ADMIN_ACCOUNTS` → 503 | a plaintext-password account must be a parse error; a tampered cookie signature must be rejected; an expired `exp`, a stale `lastSeen` and a stale `epoch` each rejected |
| Admin RBAC | each role reaches exactly its permissions | each role is denied every permission it lacks, for every action; `constructor` as a permission name must not resolve; removing the `ownKey` guard must fail the test |
| Admin audit | every write and every denial is recorded | a service-role key, a session secret, a password hash, a bKash secret and a customer phone are each fed into `meta` and must not appear in the sink |
| Admin grants | the declared manifest matches the migrations | a synthetic migration granting `delete on shops to service_role` must be rejected; an undeclared queried table must fail |
| Revenue label | dashboard renders the existing gross label | a planted `net revenue` string anywhere under `apps/admin` must fail the grep test |
| Catalog schema | table created, FTS triggers fire on insert/update/delete | the column list must contain no `shop_id`/`owner`/`phone`; `medicine_catalog` must appear in no sync table list |
| Catalog import | 1,000-row fixture imports; re-import is idempotent | a seeded shop's `medicines`/`batches` are byte-identical after a full import; an interrupted import resumes to the same state; peak retained rows stay bounded on a 25,000-row stream |
| Rule 9 | a fresh shop's `medicines` is empty after migration | the repository must contain no catalog data file, and the catalog table must be empty after `0032` |
| Search | EN/BN/Banglish table all hit; ambiguity returns ranked, auto-selects nothing | removing the Banglish fold from `search_key` must make the Banglish cases fail; a ZWJ and a Bengali-digit case; a declared wall-clock ceiling on 21,000 synthetic rows |
| OCR confirmation | Confirm adds to cart; Edit and Discard do not | removing the confirmation gate must fail the test; the sheet must not be dismissible by outside tap |
| OCR privacy — **scanner-owned path only** (`captureOnly` false) | the captured file is deleted on success, on throw, on null, and on close mid-processing | removing the scanner's `finally` must fail; a deletion rejection must not surface as a scan error |
| Capture privacy — **caller-owned path** (`captureOnly` true) | **DESCOPED to gate E9 (§6.2.2).** The only assertion that ships is a negative one: the scanner **never** deletes anything when `captureOnly` is set, and never touches `imageUri` | a mutation making the scanner delete on the `captureOnly` path must fail — this is what protects a resumed held draft's durable prescription, and it is the guard the five failed designs each broke |
| ~~Barcode ratchet~~ | **removed** — W5-16 is not executable scope (review finding 9). No barcode test ships, because no barcode work ships | — |
| Admin money font (review finding 11) | every money figure on the new `/subscriptions`, `/payments`, `/accounts` and `/shops/[id]` pages carries `font-mono`, asserted by `tests/font-tokens.test.ts` | a planted money element rendered without `font-mono` must fail. `formatMoney` returning a correct string is **not** sufficient — `formatMoney.ts:8-11` says so itself |
| **W4-10 provider refusal** — the only payment code shipping in this batch | `resolveProvider` is exercised across every `PAYMENT_PROVIDER` value | unset, empty, unknown, **and `'sslcommerz'`** each → 503 `payment_not_configured`; `initiateBilling` fails before reading or reusing any checkout URL; a test asserts `resolveProvider` can **never** yield the SSLCommerz implementation whatever the environment says; the retired module stays importable so W3-06's 47 tests still pass |
| ~~bKash provider module~~ | **deferred with W4-09 (§7.5)** — the amount/invoice/currency/status/host/refresh/signature assertions are specified in the runbook so the resumption inherits them | — |
| **bKash persistence — isolated Postgres pgtest** (review finding 12). **DEFERRED WITH W4-09 (§7.5); specified here so the resumption inherits it** | the staged `batch2-bkash-provider.sql` is applied to a real Postgres, then a full create→execute→apply cycle | A fetch double **cannot** prove any of this — `payment-webhook/webhook.test.ts:285-306` says in terms that its in-memory model is not database proof, and real idempotency was always proven by a pgtest. This test asserts, after apply: `payment_orders.provider = 'bkash'` (written explicitly, not defaulted); `provider_transaction_id` still equals the **merchant invoice**; `provider_session_key` holds `paymentId`; `payment_provider_events.validation_id` holds `trxId`; `billing_subscriptions.provider_reference` holds `trxId`, not the invoice. **Negative controls:** passing `trxId` as `p_provider_transaction_id` must raise `MU031` (the exact defect finding 1 caught); replaying the same `trxId` must leave `count(*) = 1` on `payment_provider_events` and advance `entitlement_snapshots.version` exactly once; and the un-staged function must still reject `'bkash'`, proving the staged SQL is what unblocks it |
| SQLite migration registration (review finding 3) | `0032` applies under both the test migrator and the production registry | the `.sql` files on disk, `_journal.json`'s tags and `migrations.js`'s export keys must be the **same set**; a synthetic fourth file added to only one set must fail |
| SQLite `0033` | a legacy `sslcommerz` row survives the rebuild; a `bkash` row inserts | a `'stripe'` row must still be rejected; the three indexes and the unique constraint must survive |
| Regression | the full suite at exit 0, no pre-existing test weakened | — |

Also run, with exit codes recorded: `pnpm lint`, `pnpm typecheck`, `pnpm test`,
`git diff --check`, and a secret scan over the staged diff.

**No shell heredoc is used to author or edit any file.** Batch 1 injected control characters
that way six times. Every file is written with the editor tooling.

---

## 13. What this batch explicitly does not do

- No Batch 3 work, and no file added to `backend/supabase/migrations/`.
- No W4-04 and no W4-05, not even partially. No shop-location feature.
- No hosted Supabase read or write, no migration applied, no deploy, no EAS build.
- No live payment, no sandbox payment, no merchant credential created or changed.
- No physical-device operation; the founder's Galaxy A04s installation is untouched.
- No sealed H-9/F12/H1 evidence modified, and no H-9 gate weakened.
- **No barcode work of any kind** — not deleted, not extended, and not ratcheted either
  (W5-16 removed in revision 3 per review finding 9). Pending Q1.
- No SSLCommerz module deleted — only retired from active selection and routing.
- No medicine data shipped.
- **No bKash callback or signature-verification path built** — the contract is undocumented
  (§7.1, gate E8). Verification is server-pull only.
- No task marked DONE. **Seven** tasks reach CODE-COMPLETE at most; one of those carries a
  named blocker on top, and a ninth slot stays open on Q1.

---

## 14. Review log

### Round 1 — self-review (Gate 2 blocked, see §15)

Four findings against revision 1. Each was verified against the code before being accepted,
and each is corrected in revision 2.

| # | Severity | Section | Claim in revision 1 | Reality | Disposition |
|---|---|---|---|---|---|
| **F1** | **CRITICAL** | §4.2 | the new auth works with the existing middleware | the matcher `['/((?!_next/static\|_next/image\|favicon.ico).*)']` matches `/login` and `/api/admin/session` in Next 15.5.23, so the login route would be gated by the session it issues — **no admin could ever log in** | matcher gains both paths; each gets its own protection (origin check, throttle, POST-only); a test pins the exemption list |
| **F2** | HIGH | §4.3 | "`role` is re-read from `ADMIN_ACCOUNTS` on every request, so a demotion takes effect immediately" | Next inlines `process.env` into the Edge middleware bundle **at build time**, so the value is frozen at deploy and the immediacy claim is false; it would also bake password hashes into that bundle | claim withdrawn. `role` travels in the signed payload; demotion lands at next login or on an `ADMIN_SESSION_EPOCH` bump, stated as a bounded trade-off |
| **F3** | HIGH | §6.2.2, §6.2.4 | prescription OCR does not exist → build `app/sale/prescription-scan.tsx`; delete the capture via a new `native/imageFile.ts` wrapping `deleteAsync` | prescription **capture** is fully implemented (`checkout.tsx` + `native/prescriptionAttachment.ts` + `sale_attachments` + upload queue). The real gap is that `MedicineTextScanner.tsx:122-128` returns from the `captureOnly` branch **before `scanText` is called**, so recognition never runs. Separately, `prescriptionAttachment.ts:48-54` already has the `File.delete` helper, on the modern `expo-file-system@57` API — `deleteAsync` is the legacy one | no new screen; wire recognition into the existing capture; add `removeTemporaryCapture()` to the module that already owns capture-file lifecycle. Also records the sharper leak: the prescription path leaves **two** copies, one untracked |
| **F4** | HIGH | §6.3, §11.1 | build `app/inventory/catalog-picker.tsx` as the catalog UI | `domain/medicineSearchProvider.ts` is a purpose-built seam for "a real ~21k medicine master-database," `components/inventory/SearchMedicineTab.tsx` already consumes it via a `provider` prop, and `tests/inventory/inventory-remediation.test.tsx:228` already tests it with real results | screen removed. Implement the existing `MedicineSearchProvider` interface and pass it in. Scope D now degrades gracefully to today's "not connected yet" state with zero rows |

**Revision 1 claims independently re-verified and KEPT:**

| Claim | Verified against |
|---|---|
| No migration revokes `service_role` on any table §5.1 reads, so Scope B needs no migration | all 34 migrations searched for `revoke`. The seven `revoke all … service_role` statements hit only `h7_staff_reactivation_operations`, the five A2.3 device-registry tables, and `auth_sms_dispatches` — none in §5.1. `20261015000000_h9_api_role_table_privileges.sql:40` states every `service_role` privilege is "Untouched" |
| No trigger independently rejects a `'bkash'` write, so §7.3's blocker is exactly the four CHECK pins plus the literal — neither over- nor under-stated | `b4_protect_commercial_columns`, `b4_protect_user_commercial_columns` and `b4_reject_legacy_subscription_write` all gate on `current_user in ('authenticated','anon')`; `service_role` passes through |
| `medicine_catalog` cannot be accidentally synced | `HYDRATION_TABLE_ORDER` (`db/sync-helpers.ts:93`) is an explicit allowlist consumed by `sync/pull.ts:48` and `sync/cursorStore.ts:6`; a new table is invisible to sync unless named |
| The nine assigned task IDs collide with nothing | each of W4-06…W4-10, W2-01…W2-03, W5-16 searched across `docs/` and the root `*.md`: zero pre-existing occurrences |
| The SQLite chain is not count-pinned, so `0032`/`0033` are safe | `db/test/migrations.ts:19-40` and `scripts/generate-history-fixture.mjs:83-91` both read the journal off disk and iterate it |

### Round 2 — independent Codex review: **PLAN REVISE**

Obtained 2026-10-22 against `gpt-5.6-sol` at `high` effort. **12 findings: 3 CRITICAL, 6
HIGH, 3 MEDIUM.** Every finding was re-verified against the code before being accepted —
none was taken on trust — and **all 12 were confirmed correct.** Revision 3 applies all 12.

Three are defects revision 2's own self-review did not catch, and one of those is a case
where **revision 2's "fix" was itself a data-loss bug**. That is the clearest possible
vindication of not waiving Gate 2.

| # | Sev | What it found | Verified by me against | Disposition in r3 |
|---|---|---|---|---|
| **1** | **CRITICAL** | bKash cannot work even after the CHECK/literal changes, because `b4_apply_verified_payment:677` raises `MU031` unless the stored `provider_transaction_id` equals its argument. For SSLCommerz that value **is** `tran_id` so it round-trips; for bKash the merchant value is `merchantInvoiceNumber` while bKash's own id is `trxId` — different values. Passing `trxId` rejects **every** payment; passing the invoice loses `trxId`. Also: 5 pins not 4, literals at **659 and 701**, line 105 is `billing_subscriptions` not `subscriptions`, and the insert relies on the `default 'sslcommerz'` | `b4_commercial_platform.sql:677-681`, `:105/:149/:169/:659/:701`, `billing.ts` order insert | §7.2/§7.3 redesigned around **separate** invoice and transaction identifiers. Both literals parameterised, `payment_orders.provider` written explicitly, default addressed, `paymentId` stored, `trxId` preserved |
| **2** | **CRITICAL** | r2's capture-cleanup fix would delete the temporary file **before** anything copies it. `onImageCaptured={setImageUri}` only stores the URI; the durable copy happens much later at sale/hold/cancel time in `db/sales.ts:456+`. Also: there is **one** `captureOnly` caller, not the two r2 claimed | `checkout.tsx:764` (sole caller), `db/sales.ts:456-474`, `saleDrafts.ts:58-68,221-231` | §6.2.2 rewritten around **explicit ownership transfer**. The scanner deletes only on the OCR path it owns; the `captureOnly` path hands ownership to the caller, which deletes the source only **after** a successful durable copy. OCR failure must never invalidate a captured prescription |
| **3** | **CRITICAL** | SQLite migrations are **not** picked up from the directory. `db/test/migrations.ts:35-44` maps over `_journal.json` entries, and production `migrations.js` **statically imports** all 32 files. `0032`/`0033` would never run. The chain is **32** entries (`0000`–`0031`), not 31 | `db/test/migrations.ts:19-47` (maps `journal.entries`), `_journal.json` (32 entries), `migrations.js` (33 static imports) | §1 item 12, §9.3 and §11.2 corrected. `_journal.json` and `migrations.js` added to modified files with indices 32/33 and both registry entries, plus a test asserting journal ≡ registry ≡ `.sql` files |
| **4** | HIGH | The r2 matcher exempts **prefixes**, so `/login-anything` and `/api/admin/session-extra` are also exempt. And r2's premise for abandoning request-time role lookup is **false**: Next inlines only `NEXT_PUBLIC_*` and `next.config` `env` values | `next/dist/lib/static-env.js:42-63`, `next.config.ts` (no `env` key), `middleware.ts:9-16` | §4.2/§4.3 corrected. Middleware matches everything and exempts **exact `pathname` values**; request-time role lookup **restored** via a separate hash-free `ADMIN_ROLES`, so demotion is immediate again and no hash goes near the Edge bundle. Epoch propagation documented |
| **5** | HIGH | No constant-work path for an unknown username: known accounts cost 600k PBKDF2 iterations, unknown ones return instantly — a timing oracle. Per-username throttling is bypassed by rotating usernames | plan §4.2/§4.6 as written | §4.2/§4.6: always run PBKDF2 against a fixed dummy salt/hash, return indistinguishable responses, and add a second throttle keyed independently of the supplied username |
| **6** | HIGH | The r2 grants-test restructure would have to **bless** the broad existing `insert,update` on all seven commercial tables, while the planned code needs only RPCs plus one guarded `payment_orders` update. A synthetic DELETE proves only DELETE detection. Text matching cannot establish *effective* privilege after ordered GRANT/REVOKE | `adminGrants.test.ts:38-49`, `b4_commercial_platform.sql:192-201` | §5.5 rewritten: no-DML assertions **preserved** for `shops`/`sales`; unavoidable commercial privileges enumerated separately; a `has_table_privilege` effective-ACL pgtest added; a source-level test limits direct admin writes to the one approved action |
| **7** | HIGH | §7.1 does **not** contain the callback contract (method, fields, how `paymentId`/status are recovered) that §7.2's webhook handler needs, nor the `Authorization` value format; and create-payment's `signature` is neither verified nor marked untrusted | plan §7.1 vs §7.2, `payment-webhook/handler.ts:76-105` | §7.1/§7.2: callback handling marked **BLOCKED** pending the official contract; verification is **server-pull only**; `signature` explicitly ignored and documented as untrusted absent an official procedure |
| **8** | HIGH | `MedicineSearchResult` carries only `id`/`name`/`generic`/`manufacturer`; the UI shows only those, selection forwards that same object, and **no planned caller invokes `getCatalogEntry`**. Strength, dosage form, pack size and Bangla names are lost, so same-brand rows are indistinguishable | `medicineSearchProvider.ts:8-17`, `SearchMedicineTab.tsx:70-89`, `add-medicine.tsx:81-97`, `ManualEntryForm.tsx:101-108` | §6.3: the selection fetch is defined explicitly **and** the result/display model gains disambiguating fields; the strength/dosage→schema mapping is stated (never concatenated into `name`); stale-query protection added via the existing `latestRequestGuard` |
| **9** | HIGH | The plan cannot both say Q1 needs a founder decision and schedule W5-16 as executable scope — that silently preserves founder-excluded capability and claims completeness before its own blocking decision | `muthoy-five-batch-delivery-ledger.md:102-105` | **W5-16 removed from executable scope.** Batch 2 was **8 executable tasks + 1 held on Q1** at this round; revision 6 later reduced it to **7** when W4-09 was blocked (§7.5) |
| **10** | MEDIUM | The dirty baseline is **41** pre-existing paths, not 40: default `git status --porcelain` collapses `.expo/`, which holds two untracked files | `git status --porcelain=v1 --untracked-files=all` → 42 total, 41 excluding this plan | §1/§11.3 corrected to 41 and the manifest is generated from `-uall`, never collapsed output |
| **11** | MEDIUM | `formatMoney` returns only a string and tells callers to pair it with DM Mono; `StatCard` adds `font-mono` separately, and the new payment/subscription tables carry no such requirement or test | `formatMoney.ts:8-11`, `StatCard.tsx:16` | §0 rule 6 and §5.1: `font-mono` required on every new money element, with the admin pages added to a font-token assertion |
| **12** | MEDIUM | The bKash idempotency negative control is a fetch double; the existing webhook test says its in-memory model is **not** database proof, and real idempotency is proven by a pgtest. Batch 2 changes the SQL contract but listed no pgtest applying it | `payment-webhook/webhook.test.ts:285-306` | §12: an isolated Postgres test applies the staged SQL and asserts provider, invoice, `paymentId`, `trxId`, event count, order state and entitlement version across replay |

**What the review independently CONFIRMED from revision 2** (its own `file:line` citations):
the `service_role` SELECT grants on every §5.1 table and that no later migration revokes
them; that RLS does not defeat them on the PostgREST path; that the three approved write
mechanisms hold their privileges; all three H-9 gates and the SHA-256 pin `361a400a…2bd9`;
that the SQLite chain carries no count/tail seal; that no trigger independently rejects
`'bkash'`; the OCR/barcode/auto-add facts; that `parseScannedInvoiceLines` exists and
purchase OCR does not auto-commit; the catalog seam and its test; that the nine IDs collide
with nothing; and that the empty-catalog reconciliation is legitimate rather than seed-data
sophistry.

**What the review could NOT verify, so these rest on my evidence alone** — recorded because
a reader must not mistake them for independently confirmed: the official bKash contract,
live URL, signature semantics and refresh limits (no network); the DGDA/MedEx/Kaggle counts
and licence status (no network); hosted `service_role` ACL state (hosted access prohibited);
`origin/main` against the remote (it checked the local ref only); and **the test baseline**,
because Vitest could not start under its sandbox (`esbuild … spawn EPERM`). My own baseline
run stands as the sole evidence for 243 files / 5062 tests and the two timing flakes (§1).

### Round 3 — targeted delta review: **PLAN REVISE**

Obtained 2026-10-22, same model and effort. Of the 12: **4 FIXED** (3, 6, 10, 12), **8
PARTIAL** — plus **5 new defects (3 CRITICAL, 2 HIGH) introduced by revision 3's own fixes**,
and **7 internal contradictions** left by its edits. All verified; all applied in revision 4.

Notably, the CRITICALs have moved from *premises* to *fixes* — revision 3 got the facts right
and the remedies wrong, which is a different and later failure mode than rounds 1–2.

| New defect | Sev | Reality | Verified against | Fix in r4 |
|---|---|---|---|---|
| **Old payment function survives as an overload** | **CRITICAL** | "`b4_apply_verified_payment` gains two parameters" is not something Postgres does — it identifies functions by name **plus argument types**, so a 7-arg `create or replace` creates a *second* function. The 5-arg one keeps its body, its `'sslcommerz'` literals, its `security definer` and its `grant execute … to service_role`, and `handler.ts:123` still calls it by name | `b4_commercial_platform.sql:643`, `:731-732` (grant/revoke keyed to the exact 5-arg signature) | staged SQL now **revokes and drops** the 5-arg signature, creates and grants only the new one, updates every caller, and the pgtest asserts `to_regprocedure(…5-arg…) is null`. Body also rejects `p_provider <> v_order.provider` |
| **Capture cleanup cannot tell temporary from durable** | **CRITICAL** | `checkout.tsx:124` is `useState(heldSnapshot?.imageUri ?? null)` — on a **resumed held draft** `imageUri` is already a durable document-directory file, so r3's cleanup would delete a held sale's prescription. And `db/sales.ts:475` swallows copy failure (`catch { preparedAttachment = null }`), so the caller cannot know a copy exists | `checkout.tsx:124`, `db/sales.ts:464-478` | a separate, explicitly-owned `temporaryCaptureUri` set **only** by `onImageCaptured`; `imageUri` is never a deletion target; persistence returns an explicit copy outcome (or consumes the source atomically). Resumed-draft retake and failed-copy tests added |
| **bKash has no completion path** | **CRITICAL** | r3 said "no callback parsing, server-pull only" while still routing `payment-webhook/handler.ts` by provider, and never said **where** bKash verification and apply happen. A completed payment would never be applied | plan §7.2 vs §7.1, `billing.ts:51` | webhook stays **SSLCommerz-only**; bKash query → verify → apply moves into **`billingStatus`**, which is already authenticated, owner-gated, takes `orderId` and already reconciles that order. End-to-end test added |
| **"Lower privilege wins" is undefined** | HIGH | `billing` and `support` are **incomparable** — each holds a write permission the other lacks — so any total ordering preserves a permission the other role never had | plan §4.4's own role table | `ADMIN_ROLES` is **authoritative**; the cookie claim is audit-only. Intersection recorded as the correct operation if both ever must be consulted |
| **Catalog selection still lossy, or bypasses the atomic save** | HIGH | **No planned UI caller invoked `createMedicineFromCatalog`**, so the extra fields were still lost; and calling it at selection would write a `medicines` row before Save, bypassing both the confirmation rule and the existing atomic `createMedicineWithPurchase` | `ManualEntryForm.tsx:101-108`, plan §6.3 | selection **reads** via `getCatalogEntry` and prefills the form; **Save remains the only commit**, through the existing atomic creator with an extended input type. `createMedicineFromCatalog` is **not** built. Bangla display columns deferred to E4 with the reason stated |

**The 7 internal contradictions**, all from revision 3's own edits and all now resolved:
`ADMIN_ACCOUNTS` carrying `role` in one place and not another (it no longer carries it —
roles live only in `ADMIN_ROLES`); "both throttles" referenced in §4.2 while §4.6 defined
one (§4.6 now defines two); "two current `captureOnly` callers" against the verified one;
"no bKash callback" against a provider-routed webhook in two places; §1 item 9's stale
four-pin/`subscriptions` baseline against §7.3's five-point analysis; the barcode ratchet
removed from scope but still listed in the §12 test plan; and Round 2's disposition claiming
§5.1 carried the money-font requirement when it did not.

### Round 4 — targeted delta review: **PLAN REVISE**

**4 FIXED** (role authority, the exact-pathname matcher, the login timing oracle, W5-16, the
money font — and the 7 contradictions all cleared bar one wording slip), **6 PARTIAL**, and
**5 new defects (2 CRITICAL, 3 HIGH, 1 MEDIUM)**. Verified and applied in revision 5.

**The live findings are now concentrated in two tasks, not spread across eight.** Six scope
areas have converged — admin auth/RBAC (W4-06), admin pages and write actions (W4-07/08),
the catalog schema and importer (W2-02), multilingual search (W2-03), SSLCommerz retirement
(W4-10) and the migration/grants/test machinery are all FIXED or settled. Everything still
open belongs to **W4-09 (bKash)** or the **prescription-capture lifecycle inside W2-01**.

| New defect | Sev | Reality | Verified against | Fix in r5 |
|---|---|---|---|---|
| **bKash completion ordered after destructive reconciliation** | **CRITICAL** | `billing.ts:55-75` runs refresh → reconcile → **expire the stale order** → *then* read it. Adding query/verify/apply without reordering lets a **paid, completed order be marked `expired`** and never granted | `billing.ts:55,59,63` — expiry precedes the read | explicit 5-step order: select → query/verify/apply → expire only if still uncompleted → refresh/reconcile → respond. Concurrency and completed-after-local-expiry tests added |
| **Failed capture copy has no surviving owner** | **CRITICAL** | `createSaleTransaction` **succeeds** despite a copy failure (`db/sales.ts:475`), checkout navigates away, and nothing is left mounted to own the temp file. r4's "recoverable orphan" was neither recoverable nor owned | `db/sales.ts:464-478`, `checkout.tsx:319-323` | ownership transfers **into** persistence, never back to the caller. A failed copy is recorded in `sale_attachments` as `uploadStatus:'pending'` — the queue `db/attachments.ts` already walks — so a durable owner exists |
| **Function replacement has deployment version skew** | HIGH | DB SQL and Edge Functions do not deploy atomically. r4's "update every caller in the same change" is not available: DB-first breaks the live 5-arg caller at `handler.ts:123`; Edge-first breaks against the old DB. Live SSLCommerz callbacks fail mid-rollout | `handler.ts:123-129` | **phased**: phase 1 additive (create/grant 7-arg, 5-arg untouched) → phase 2 deploy callers and verify → **phase 3, a separate later change**, revoke/drop the 5-arg. Each phase one transaction; phase 3 recorded as a Batch 3 sequencing dependency |
| **`billingStatus` is not owner-gated** | HIGH | r4 claimed it was. It calls `assertCallerCurrent`; `requireOwner` is used only by `initiateBilling` (`:90`) and `finalizeBillingAttempt` (`:180`). Payment-application authority was being added on a false premise | `billing.ts:51-54,90,180` | the **`orderId` completion branch** is owner-gated; ordinary staff entitlement hydration is left untouched, with a test for both |
| **Catalog fix contradicts itself and cannot be staged** | HIGH | §6.3 still required `createMedicineFromCatalog` while the flow below forbade it, and §11.2 omitted `ManualEntryForm.tsx`, `db/inventory.ts`, `packages/validation/src/inventory.ts` and their tests | plan §6.3 vs §11.2 | stale requirement deleted; all four files plus `db/attachments.ts` added to §11.2 |
| Revision metadata and callback wording | MEDIUM | the header still said "revision 3"; bKash idempotency still said "redelivered callback" in a design with no trusted callback | plan `:3`, `:1097` | header now revision 5; the term is **replayed status poll** |

### Round 5 — narrow delta review: **PLAN REVISE**, and the decision it forced

Scoped to the capture lifecycle, the catalog wiring and scope coherence. **1 PARTIAL, 2 NOT
FIXED, 1 CRITICAL regression, 1 new HIGH, 1 new MEDIUM** — and it ended five rounds of
failed designs for one sub-item.

| Finding | Reality | Verified against | Disposition in r6 |
|---|---|---|---|
| **Capture lifecycle — NOT FIXED, CRITICAL regression** | r5's "queue the temp URI in `sale_attachments`" cannot work: **`saleAttachments.saleId` is `.notNull().references(sales.id)`**, so a held draft has no row to write; and `sync/attachments.ts:14` re-reads `localUri` on every retry, so an OS-evicted cache path breaks the upload permanently. Retake, back/unmount and cancel still had no owner. Deleting the temp right after the pre-transaction copy can lose **both** files, because `db/sales.ts` removes the prepared copy if the transaction then fails | `db/schema.ts:754-756`, `sync/attachments.ts:8-30`, `db/sales.ts:456-478` | **DESCOPED to gate E9** (§6.2.2). The scanner-owned OCR path still ships — four of the five scanning screens. The `captureOnly` half needs the `db/sales.ts` transaction boundary changed and a durable draft-attachment path that does not use `sale_attachments`: money- and sync-path code, which CLAUDE.md rule 10 puts behind its own plan. I had independently found the `storagePath` half of this before the review returned |
| **Scope coherence — NOT FIXED** | §2 said seven tasks while `:33`, `:1427` and the DoD paragraph still said eight, and the manifests still scheduled executable bKash work: migration `0033`, the provider enum, `commercial.ts`, bKash branding and its tests | plan `:33`, `:1462-1475`, `:1528-1535`, `:1609` | every count now **seven**; migration `0033`, the enum change and the `commercial.ts` change **dropped entirely** as dead scope; `plan-payment.tsx` shows a payment-**unavailable** state rather than bKash branding |
| Catalog wiring — PARTIAL | the forbidden writer is gone and Save stays atomic, but `tests/inventory/inventory-remediation.test.tsx` — the suite that must change — was missing from §11.2 | `db/inventory.ts:346-362`, `inventory-remediation.test.tsx:227-281` | added to §11.2 with the SQLite mapping test |

**Why this round ended the iteration on that sub-item rather than producing a sixth design.**
Five designs failed for the same underlying reason: the prescription capture's lifecycle is
entangled with a money-path transaction boundary and a sync-path upload queue that Batch 2
is not authorized to redesign. Rule 11 requires saying so. The risk is **pre-existing** —
nothing has ever deleted that file, on any path, since OCR shipped — so the batch neither
introduces nor worsens it, and E9 now carries all five failed designs so the next attempt
starts from evidence.

### Round 6 — final narrow delta review: **PLAN REVISE**

Scoped to revision 6's two changes. **The descope reasoning passed on every substantive
point**; what failed was two real gaps and an incomplete purge.

**PASSED — the E9 descope is sound:**

| Check | Result |
|---|---|
| all four OCR callers receive text only, so the scanner may delete the URI after OCR settles | **PASS** |
| no downstream OCR callback uses the image URI | **PASS** |
| the `captureOnly` leak really is pre-existing | **PASS** — confirmed against **git history**: neither the scanner nor the camera code has ever explicitly deleted these captures |

**Two genuine gaps, both fixed in revision 7:**

| Finding | Reality | Verified against | Fix |
|---|---|---|---|
| **A scanner-only test cannot protect a resumed draft** (1d) | the durable URI lives in `checkout.tsx` — a file W2-01 *modifies* — so the guard has to sit there, not in the scanner | plan §6.2.2 vs `checkout.tsx:124` | W2-01 also ships `tests/sale/resumed-draft-capture.test.tsx`: retake, cancel and unmount on a held draft, asserting the durable file survives each. **That** test pins E9's boundary |
| **`createPaymentAttempt` runs before the server call** (2a) | `sync/billing.ts:77` → `:85` writes the local `payment_attempts` row **first**, so revision 6's premise that server refusal makes the write unreachable was wrong: a `'sslcommerz'` row would be created on every attempt and orphaned by the 503 | `sync/billing.ts:77,85`, `db/commercial.ts:467` | `initiatePlanPayment` checks availability **first** and throws `payment_not_configured` without writing a row. A test asserts no `payment_attempts` row exists after a refused attempt — which is also what keeps the untouched SQLite CHECK harmless |

**The incomplete purge, and the lesson from it.** Round 6 listed ~9 further places where
revision 6's scope reductions had left stale executable claims — task counts, migration
`0033`, the provider enum, `commercial.ts`, branding, the superseded capture tests, the
failed `db/attachments.ts` queue design. Every one was residue from patching a 1,900-line
document across six revisions, not a design error. Revision 7 purged them **systematically**
rather than by another patch-and-review cycle: enumerate every `bkash` and capture-cleanup
reference, classify each as historical-log (keep) or executable-scope (remove), fix in one
pass, then verify by `grep` instead of paying for a seventh round. That pass also found and
removed a **24-line block my own earlier edit had duplicated** inside §6.2.2 — a defect no
reviewer had flagged.

**Status after six rounds:** the seven executable tasks' designs have converged. Round 6
raised no new defect in admin auth/RBAC, the admin pages or write actions, the catalog
schema or importer, multilingual search, the migration/grants machinery, or the test plan.

### Gate 2 disposition

Six rounds, every one `PLAN REVISE`, every finding verified against the code and applied.
For precedent: `muthoy-batch-1-plan.md` records **eight** rounds before `PLAN ACCEPT` on a
narrower scope. **Implementation has not begun** — Gate 3 awaits the founder's decision on
whether to run a seventh round or proceed on revision 7.

---

## 15. Gate 2 status — BLOCKED, with evidence

| Attempt | Model | Effort | Outcome |
|---|---|---|---|
| Availability probe | `gpt-5.6-sol` | xhigh | **OK.** The configured `gpt-6.1-sol` in `~/.codex/config.toml` is not the available model; `[tui.model_availability_nux]` lists `gpt-5.6-sol`, which the probe confirmed |
| Review run 1 | `gpt-5.6-sol` | xhigh | **No verdict.** Killed by a session boundary at 639 KB of transcript, mid-verification |
| Review run 2 | `gpt-5.6-sol` | high, with an explicit instruction to emit the verdict even if unfinished | **No verdict.** `ERROR: You've hit your usage limit. … try again at Oct 22nd, 2026 12:36 AM` |

Both transcripts show the review doing real verification before it stopped — reading the
H-9 preflight and post-migration checks, hashing
`backend/supabase/checks/h9_postmigration_checks.sql`, counting the migration chain, and
sweeping the task IDs. Run 2's partial work is what surfaced
`domain/medicineSearchProvider.ts`, which became finding F4. None of that is a verdict, and
**no `PLAN ACCEPT` exists.**

**Consequence:** Gate 2's condition is unmet, so Gate 3 has not begun. No product code has
been written. The only files changed in this batch so far are this plan.

**Options, for the founder to choose:**

1. **Wait for the quota reset** (2026-10-22 00:36) and re-run the review on revision 2.
   Keeps the mandated workflow intact. Costs a delay.
2. **Add Codex credits / upgrade** and re-run immediately. Same workflow, no delay.
3. **Authorize a different independent reviewer** for Gate 2. This is a deviation from the
   stated workflow ("ONE independent Codex review") and needs explicit approval.
4. **Waive Gate 2** and proceed to implementation on the self-reviewed revision 2. This
   contradicts the batch's own instruction and is **not** recommended — revision 1 contained
   one CRITICAL and three HIGH findings that a single self-review pass caught, which is
   direct evidence that this plan benefits from review rather than an argument that it has
   converged.

Option 1 or 2 is recommended. Revision 2 is ready for review as it stands.
