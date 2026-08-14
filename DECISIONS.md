# DECISIONS.md — Muthoy POS
### A running log of real decisions made during the build, dated, with a why.
### Read alongside CLAUDE.md, PROJECT_CONTEXT.md, TECH_STACK.md, and
### DEVELOPMENT_RULES.md.

---

## 2026-08-09 — Expo SDK 52 → current stable (SDK 57)

**What changed:** TECH_STACK.md originally locked "React Native 0.76+ / Expo
SDK 52." Day 1 foundation work instead targets **Expo SDK 57** (React Native
0.86, React 19.2), the current stable release as of this build date.

**Why:** SDK 52 (Nov 2024) was significantly behind current stable by the
time this repo's Day 1 was actually built. Greenfield Day 1 — before any app
code exists — is the cheapest possible point to absorb an SDK upgrade, rather
than starting already several majors behind.

**Tradeoff considered:** SDK 56 (2026-05-21), one release behind current
stable at build time. Rejected in favor of 57 given the short gap and that
no app code existed yet to make upgrading later costly.

**Follow-up:** TECH_STACK.md's Client section updated in the same change.

---

## 2026-08-09 — Shared design tokens shipped as JSON, not TypeScript

`packages/constants`'s actual values live in `src/tokens/*.json`, re-exported
by thin `.ts` wrappers. `apps/mobile/tailwind.config.js` is `require()`'d by
NativeWind's Metro plugin with no TypeScript transform active at that point;
JSON is readable by both that plain Node `require()` and normal TypeScript
`import` (via `resolveJsonModule`) — one source of truth, not two.

---

## 2026-08-09 — Internal package scope `@muthoy/*`

All `packages/*` (and `apps/mobile`) are scoped `@muthoy/<name>`. Purely an
internal-clarity choice — every package is `private: true` and never
published to a registry.

---

## 2026-08-09 — `formatMoney` uses `en-IN` digit grouping

Bangladeshi convention groups digits as lakh/crore (`১,০০,০০০` /
`1,00,000`), not the Western `1,000,000`. JavaScript's `Intl` has no `en-BD`
locale with this grouping, but `en-IN` produces the identical grouping
pattern, so `packages/utils/src/formatMoney.ts` and `formatNumber.ts` use it.
Flagged for founder review — a one-line constant change if this isn't
actually wanted.

---

## 2026-08-09 — Tailwind preset is a factory function, not a direct `require`

`packages/config/tailwind/native-preset.js` originally did
`require('@muthoy/constants/...')` directly, which created a workspace
dependency cycle (`packages/constants` already depends on `packages/config`
for its shared tsconfig/eslint base — `pnpm install` warned about exactly
this). Fixed by making the preset a factory function that takes tokens as a
parameter; callers (`apps/mobile/tailwind.config.js`) import
`@muthoy/constants` themselves and pass its exports in. `packages/config` now
has zero runtime dependencies, matching its role as the dependency-free base
every other package extends.

---

## 2026-08-09 — Metro's `disableHierarchicalLookup` must stay off with pnpm

`apps/mobile/metro.config.js` initially set `resolver.disableHierarchicalLookup
= true` (a commonly-suggested Expo monorepo setting). This broke bundling —
`@expo/metro-runtime` (nested inside `expo-router`'s own pnpm-resolved
dependency tree, not hoisted to a flat top-level `node_modules`) could no
longer be found. That option guards against wrong-version hoisting in
npm/yarn-classic flat `node_modules`; pnpm's symlinked, content-addressed
store doesn't have that failure mode, so the option isn't needed and actively
breaks resolution here. Removed — `unstable_enableSymlinks` + explicit
`watchFolders`/`nodeModulesPaths` alone are sufficient. Confirmed via
`npx expo export --platform web` after the fix.

`unstable_enableSymlinks: true` was also removed after `expo-doctor` flagged
it as a deviation from `expo/metro-config`'s defaults. Rather than keep an
override on the assumption it was needed, tested removing it: the bundle
still exports cleanly. SDK 57's Metro already handles pnpm's symlinks
correctly out of the box — the earlier `disableHierarchicalLookup` bug was
the actual (and only) necessary fix. `expo-doctor` now reports 20/20 checks
passing.

---

## 2026-08-09 — `apps/mobile`'s lint script is `eslint .`, not `expo lint`

`expo lint` auto-detects and explicitly passes conventional directories
(`components/`, etc.) to ESLint. Volume 2's skeleton folders (`components/`,
`db/`, `state/`, `domain/`, `sync/`, `native/`) currently hold only a
`README.md` each — zero `.ts`/`.tsx` files — and ESLint 9's flat config
treats an explicitly-passed directory with no matching files as a hard error,
not a no-op. Plain `eslint .` does its own broad discovery instead and
doesn't hit this; switched to it for robustness against empty
not-yet-populated folders. Revisit once these folders have real code — either
form will work then, but `eslint .` has no known downside either way.

---

## 2026-08-09 (Day 2) — Money is stored as INTEGER PAISA, not floating-point taka

**What changed:** the finalized `schema.ts` declared every money column as
`real` (floating point). All 23 money columns are instead `integer`, holding
a whole number of paisa (1 taka = 100 paisa). Approved explicitly by the
founder before implementation, per CLAUDE.md rule 10.

**Why:** floating point cannot represent decimal fractions exactly. Verified
during implementation: `10.10 + 20.20` evaluates to `30.299999999999997` in
float, while `1010 + 2020` is exactly `3030` paisa. A cash drawer that must
reconcile to the paisa (Volume 0's Day 7/Day 10, the project's highest-risk
work) cannot be built on a representation that drifts when summed.

**How the 100x mistake is prevented:** `Paisa` (packages/types/src/money.ts)
is a *branded* type — a number at runtime, but distinct from `number` to
TypeScript. Reading a paisa value as taka is therefore a compile error, not a
runtime surprise found while counting a real shop's cash. Conversion happens
only through `fromTaka()` / `toTaka()` / `asPaisa()`.

**Two columns deliberately NOT converted:**
- `shops.latitude` / `longitude` — geographic, not money; stay `real`.
- `sale_items.discount_value` — a discount RULE, not an amount (`10` means
  either 10% or ৳10, per `discount_type`). A percentage expressed in paisa is
  meaningless. The resolved money lives in `discount_amount`, which IS integer
  paisa.

**Coupled change in the same commit:** `packages/utils/src/formatMoney.ts` now
takes `Paisa` and converts at the display boundary. Had it been left taking
taka, every amount in the app would have rendered 100x too small.

### ⚠ HARD PRECONDITION FOR DAY 12 (Supabase schema)
`supabase-schema.sql` mirrors this schema for sync. Its money columns MUST be
integer (`BIGINT`), matching paisa. If the cloud side stays `numeric`/float
while the phone sends paisa, **every synced amount is wrong by 100x** —
silently, on real pharmacy money. This must be verified before Day 13's sync
engine moves a single row.

---

## 2026-08-09 (Day 2) — Local schema is 24 tables, not 23

The playbook said 23 in five places; the finalized `schema.ts` defines 24.
The extra table is `conflict_queue` (P1 — the conflict-resolution UI is
post-beta, but the table ships now so the sync engine has somewhere to write).
Founder confirmed: keep all 24 including `conflict_queue`, correct the docs.
Updated in `00-execution-roadmap.md` (x2), `03-database-backend.md` (x2), and
`06-ai-prompt-library.md`.

---

## 2026-08-09 (Day 2) — First migration + the two PRAGMAs that make it real

**Migration file:** `apps/mobile/db/migrations/0000_open_senator_kelly.sql`
(62 statements, 24 tables, 38 indexes). Generated by `drizzle-kit`, never
hand-written. Never edit it after this commit — a schema change is always a
NEW migration (DEVELOPMENT_RULES.md).

**`PRAGMA journal_mode = WAL`** — crash-safe, concurrent read-while-write.
Persistent: stored in the database file itself.

**`PRAGMA foreign_keys = ON`** — SQLite ships with foreign key enforcement
**OFF by default**. Without this line every `onDelete` policy in schema.ts
parses cleanly and enforces nothing, so `ON DELETE RESTRICT` would silently
fail to protect financial and audit history (CLAUDE.md rule 2 satisfied on
paper, violated in reality). Unlike WAL this is **per-connection and resets to
OFF every time the database is opened**, which is why it lives in
`db/client.ts`'s open path, not in a migration.

**Verified, not assumed:** the generated SQL was applied to a real SQLite
engine (`node:sqlite`) and asserted: 24 tables created; all 46 foreign keys
carry an explicit `ON DELETE` (25 cascade / 19 restrict / 2 set null); an
`INSERT` referencing a non-existent shop was **rejected** — proving FKs are
actually enforced, not merely declared; `medicines.shop_id` = CASCADE,
`sale_items.batch_id` = RESTRICT, `sales.customer_id` = SET NULL.

**Still outstanding (founder, on a real device):** Volume 0 Day 2's own test —
write a row to `medicines`, read it back, in airplane mode.

---

## 2026-08-09 (Day 2) — SQLCipher deferred, but REQUIRED before pilot data

TECH_STACK.md lists SQLCipher (encryption at rest) and it **stays in the
stack** — this is a deferral, not a removal. Not done on Day 2 because it is a
native-build change (`useSQLCipher: true` in `app.json` + `expo prebuild` + a
fresh EAS build) plus a key-management design problem (where the key lives,
how it relates to the PIN) that deserves its own plan under CLAUDE.md rule 10.

**Deadline: before ANY real pharmacy/pilot data is stored.** Encrypting a
database that already holds a live shop's data means migrating that data;
right now the database is empty, so the change is nearly free. The `muthoy.db`
file created today is unencrypted — during development that is fine and can be
deleted and recreated at will.

---

## 2026-08-10 (Days 4-5/11) — Native bcrypt binding, not pure-JS

`react-native-bcrypt-cpp` was chosen over pure-JS options (`bcryptjs`,
`react-native-bcrypt`) for two verified reasons, not a stylistic preference:

1. **Security**: React Native's `crypto.getRandomValues` falls back to
   `Math.random()` unless explicitly polyfilled. Pure-JS bcrypt libraries
   depend on that source for salt generation — an insecure PRNG produces
   guessable salts, defeating the point of hashing at all.
2. **Performance**: pure-JS bcrypt is 3-50x slower than native C++ bindings.
   PROJECT_CONTEXT.md targets a 2GB-RAM Samsung Galaxy A14-class phone, and a
   PIN is entered on every app open — not a rare path. The chosen package's
   own published benchmark: ~14s (JS) vs ~0.3s (native, multithreaded) for
   the same hash.

`bcrypt-react-native` (a same-named, older alternative) was ruled out
specifically: last published 2022, before React Native's New Architecture
became the default — a real compatibility risk against RN 0.86.

**Requires New Architecture.** No `newArchEnabled: false` override exists in
`app.json`, and Expo SDK 57 defaults to it, so this should already be
satisfied — but unlike Day 2's schema work, this can't be proven from a
terminal. **The first EAS dev build after this change is the actual
confirmation point**; if linking fails, that is the signal New Architecture
isn't active.

Cost factor: 12 (a standard modern default). Native + multithreaded, so this
doesn't reintroduce the UI-blocking risk pure-JS bcrypt would have had at the
same cost factor.

> **REVERSED the same day — see "Reverted to bcryptjs" below.** The package
> turned out not to work on Android at all, for reasons no amount of reading
> its README could have revealed. The reasoning above was sound; one of its
> two premises (the `Math.random` claim) was also simply out of date.

---

## 2026-08-10 (Days 4-5/11) — Reverted to bcryptjs; the native package was broken upstream

The dev build failed at runtime with
`TurboModuleRegistry.getEnforcing('BcryptCpp') could not be found`. Root cause,
established by reading the package's own source rather than guessing:
**`react-native-bcrypt-cpp` ships no Android JNI registration whatsoever.** Its
iOS side has a working `ios/onLoad.mm` calling
`registerCxxModuleToGlobalModuleMap`; Android has no equivalent file, and its
`BcryptCppPackage.kt` is a stub whose `getModule()` returns `null` and whose
`getReactModuleInfoProvider()` returns an empty map. The C++ was compiled but
never connected to anything JS could reach — so it could never have worked on
Android, on any build, for anyone. (npm confirms the package was abandoned 8
days after first publish.) Nothing about this project's setup caused it.

Writing the missing bridge was attempted and got genuinely close: 8 distinct
build-configuration defects were found and fixed across 8 EAS builds (missing
`find_package(ReactAndroid)`, missing `prefab true`, static-vs-shared STL,
un-namespaced CMake targets, `react_nativemodule_core` not existing under
plain CONFIG mode, C++17-vs-C++20, codegen output never pulled in via
`add_subdirectory`, and `REACT_NATIVE_DIR` not being an ambient Gradle
property). Each fix was verified against real working packages in this repo
(gesture-handler, reanimated, nitro-modules) and each build got measurably
further. That work is preserved, **unreferenced and no longer applied**, at
`patches/react-native-bcrypt-cpp@0.2.3.patch`.

It was abandoned not because it was failing but because the remaining unknown
count wasn't zero and — critically — **even a successful compile would not
have proven the JNI registration actually works at runtime**, which was the
original bug. Maintaining a hand-written JNI bridge for an abandoned package
is also a long-term liability for a solo-founder project.

**The security premise for rejecting pure-JS was out of date.** `bcryptjs` v3
sources salt entropy from Web Crypto, then Node crypto, and **throws** if
neither is available — it does *not* silently fall back to `Math.random()`.
That was v2 behaviour, and it is the reason pure-JS bcrypt earned its bad
reputation. `native/crypto.ts` sets `setRandomFallback()` to `expo-crypto`'s
`getRandomBytes()` (the platform CSPRNG — `SecRandomCopyBytes`/`SecureRandom`),
so salts come from the OS secure source, exactly as the native module would
have. Without that line RN would throw, not silently weaken — the failure mode
is loud.

**The performance premise was real, and is handled by lowering the cost factor
from 12 to 10.** Cost 12 in JS is roughly 1-3s on the target Galaxy A14-class
hardware — too slow for a POS login on every app open; cost 10 is ~300-600ms.
The `hash`/`compare` async variants are used (not `hashSync`/`compareSync`)
because bcryptjs chunks async work across ticks instead of hard-blocking the
JS thread. Note that for a **4-digit** PIN the real defence against an attacker
holding the database is the 10,000-combination keyspace, not the cost factor —
that is addressed by attempt rate-limiting and by SQLCipher at rest (already
tracked above as a pre-pilot requirement), not by bcrypt tuning.

Because `db/auth.ts` and `db/staff.ts` only ever call `hashPin`/`verifyPinHash`
and never bcrypt directly, this swap changed exactly one file plus docs — no
SQL, no schema, no screens. The hash format is standard bcrypt in both cases,
so any hash already written remains verifiable.

---

## 2026-08-10 (Days 4-5/11) — Two stub signatures corrected against the real schema

Tracing the approved auth work against Day 2's actual `schema.ts` (not just
Volume 4's prose) surfaced two places where the original skeleton-phase stub
signatures couldn't actually implement the required flow:

**`users.pin_hash` is `NOT NULL`, but Registration and PIN Setup are separate
screens** (Volume 0 Day 4). The owner's `users` row is created during
`createShopAndOwner` with a placeholder hash — `hashPin()` of a freshly
generated random UUID, never a 4-digit string, so it can never match a real
PIN attempt through `verifyPin`. `setOwnerPin` overwrites it once PIN Setup
completes. This keeps the original two-call shape
(`createShopAndOwner` → `setOwnerPin`) intact rather than restructuring it
into one combined write.

**`verifyPin(userId, rawPin)` couldn't work as originally stubbed** — PIN
Login has no username step (Volume 4 AUTHENTICATION describes PIN-only
entry), so there is no `userId` to check against until AFTER a match is
found. Corrected to `verifyPin(rawPin)`: checks the PIN against every active
local user's hash and returns whichever one matched. Assumes one shop per
device (Volume 0's P0 scope — multi-shop is P1); revisit this function when
multi-shop ships.

---

## 2026-08-10 (Days 4-5/11) — Owner's `users.name` defaults to the shop name

**Flagged for founder review, not silently decided.** Volume 0 Day 4 is
explicit that Registration collects "shop name + phone only" — there is no
field for the owner's personal name. But `users.name` is `NOT NULL`. Rather
than add an unrequested field to the Registration form, `createShopAndOwner`
defaults the owner's `users.name` to the shop name. One-line change in
`db/auth.ts` if an owner-name field should exist instead.

---

## 2026-08-10 (Days 4-5/11) — react-native-mmkv v4's API is not `new MMKV()`

Caught by `tsc`, not assumed correct: v4 is rebuilt on Nitro Modules.
`MMKV` is now a TYPE only; instances come from `createMMKV(config)`.
Key removal is `remove(key)`, not the `delete(key)` used in v2/v3.
`state/sessionStore.ts` uses the v4 API throughout.

---

## 2026-08-10 (Days 4-5/11) — MMKV holds session only, never a PIN or its hash

Volume 4 STATE MANAGEMENT says "MMKV for PIN hash + session" — read as loose
phrasing for "the fast-storage layer used around PIN auth," not a literal
second copy of the hash living outside SQLite. `state/sessionStore.ts`
persists only `{ shopId, userId, role }`. CLAUDE.md rule 1 makes SQLite the
sole source of truth; duplicating a security-sensitive hash across two
stores needs a reason, and none was found. Flagged explicitly in the
approved plan before implementation — say so if a literal second copy was
actually intended.

---

## 2026-08-10 (Days 4-5/11) — `listStaff` returns staff only, not the owner

Volume 0 Day 11: "List existing staff with active/deactivated status." The
first implementation queried all users joined to roles and only excluded
`manager`, which meant the owner appeared in their own staff list. Caught
before wiring the screen: query now filters to `role.name = 'staff'`
directly in SQL, matching the function's name and the screen's actual intent.

---

## 2026-08-10 (Days 4-5/11) — react-hooks/set-state-in-effect (React Compiler)

Expo SDK 57 runs with React Compiler enabled, which flagged two real
patterns via `react-hooks/set-state-in-effect`:

- `PinPad.tsx`'s `usePinEntry` called `setPin('')` immediately after
  `onComplete(pin)` inside a `useEffect` watching `pin` — two `setState`
  calls chained from one effect run. **Fixed properly**, not suppressed: the
  complete-and-reset logic moved into `handleDigitPress` itself (an event
  handler, not an effect), where React just batches the two calls. No
  external system was being synchronized with, so an effect was never the
  right tool here.
- `app/staff/management.tsx` loads the staff list on mount via
  `useEffect(() => { reloadStaff(); }, [reloadStaff])`. This one keeps a
  scoped, commented `eslint-disable` — Volume 4 STATE MANAGEMENT explicitly
  rules out TanStack Query for local reads ("never used to fetch what a
  screen displays"), so there is no fetching-library hook to delegate a
  load-on-mount to; a plain effect is the correct tool, and the lint rule's
  heuristic (tracing through an async `useCallback` to the eventual
  `setState`) is overly broad for this specific, unavoidable pattern.

---

## 2026-08-10 (Days 4-5/11) — Auth verified in Node without importing db/auth.ts directly

`db/auth.ts` imports `expo-sqlite` (via `db/client.ts`) and the native
bcrypt binding — neither loads in plain Node, so it can't be `import`-tested
the way Day 2 tested raw migration SQL directly. Rather than add a new test
framework or a Node-side SQLite driver (`better-sqlite3`) to work around
this — outside the approved scope — verification mirrors the SAME SQL
operations `db/auth.ts`/`db/staff.ts` perform against a real `node:sqlite`
in-memory database (Day 2's pattern), plus the `verifyPin` search-for-a-match
algorithm proven independent of which library computes the hash. 22/22
checks pass: all 6 Zod schemas (valid/invalid BD phone, PIN shape, all three
confirm-match refinements), shop+3-roles+owner created atomically, `owner_id`
confirmed to have no FK (the placeholder-hash creation order actually works,
not just in theory), staff-role attachment creates no new role row,
`listStaff` returns staff only, deactivation flips `is_active` without
deleting the row, and an audit-log row's `action`/`target`/`meta` fields
contain no PIN-shaped value. **What this does NOT verify**: the actual
native bcrypt call, or the exact SDK-native `expo-sqlite`/Drizzle wiring —
both remain device-only checks (Volume 0 Day 4's own checklist: "PIN is
stored hashed (inspect the DB row directly)").

---

## 2026-08-11 — Explicit PIN completion marker recovers interrupted registration

`users.pin_set_at` is a nullable completion marker. Owner registration writes
the shop/user with the existing unmatchable placeholder hash and leaves the
marker null; `setOwnerPin` replaces the hash and sets the marker in one write.
The root gate can therefore resume an interrupted registration at PIN Setup
with the original `shop_id`/`user_id`, instead of sending the owner to an
impossible PIN Login.

Migration `0002_furry_celestials.sql` is additive: it adds one nullable column
and deletes or replaces no existing rows or hashes. Existing owner rows remain
null and complete PIN Setup once. Existing staff rows are backfilled from
`updated_at` because staff creation has always stored a real PIN hash directly
and never used the owner placeholder. New staff creation and staff PIN reset
set `pin_set_at` with the hash, preserving the Day 11 staff PIN-login flow.

`verifyPin` ignores users whose marker is null. `role-select` remains
unreachable/deferred; owner and staff continue using the same PIN-only login.

---

## 2026-08-12 — Purchases shipped early with owner-only financial access

The full supplier/purchase-invoice feature remains classified P1/post-beta in
the roadmap, but the founder explicitly approved implementing it early. This is
a deliberate scope exception, not a change to the general P0/P1/P2 rule.

Supplier details, payables, and purchase creation are owner-only. The UI guards
all three supplier routes, and every supplier/purchase DB operation that exposes
financial data independently revalidates the active owner against local SQLite;
all reads and writes remain shop-scoped. Purchase invoices use
`PUR-{YYYY}-{6-digit-seq}`.

COD purchases are fully paid at creation, record a cash supplier payment, and
recompute the cash drawer. Credit purchases create no immediate cash movement;
their outstanding supplier payable is derived from
`purchases.total - purchases.paid_amount`, never cached separately.

---

## 2026-08-12 — Customer credit balance is derived; collections are atomic

Customer records retain name, phone, address, and notes, while checkout's picker
reads only id/name/phone. All customer, credit, payment, and drawer operations
are shop-scoped.

Outstanding balance is derived as credit sales minus collections; it is never
maintained as a mutable cached total. Over-collection is rejected. Cash
collections recompute today's expected cash drawer, while non-cash collections
reduce the credit balance without touching the drawer.

`collectPayment` deliberately uses a synchronous/no-await transaction callback:
the balance check and payment insert must remain within one uninterrupted SQLite
transaction. Standalone `recordCreditSale` remains intentionally out of scope;
checkout already creates sale-backed credit rows atomically.

---

## 2026-08-12 — Notifications shipped early; device-local and fail-closed

Notifications remain classified P1/post-beta, but the founder explicitly
approved implementing them early as a scope exception. Low-stock alerts use a
resolved marker for threshold-crossing hysteresis; expiry alerts always compute
from the real batch expiry date. Notification history stays device-local and is
excluded from the sync outbox.

One shared OS background task runs all checks, with foreground activation as a
self-heal. Delivery near 8 PM is best-effort because Android Doze and OEM task
killing control actual wake time. Daily cash summaries require a persisted owner
session plus fresh SQLite owner validation; staff sessions cannot create, count,
or list those rows. If staff is last logged in, that day's summary is skipped.

No custom notification icon exists yet. Expo's default remains in use until a
real design asset is supplied. Adding the native modules requires a fresh EAS
development-client build before device validation.

Successful sales start a fire-and-forget notification check only after the sale
transaction commits. Notification failures therefore cannot fail or roll back
the completed sale. Low-stock semantics remain unchanged: stock below the
threshold creates one unresolved alert, recovery at or above the threshold
resolves it, and a later drop can alert again.

Notification permission and channel initialization runs from normal,
authenticated foreground app startup; opening Notification Center is not a
prerequisite. Android also ensures the channel immediately before posting. If
OS permission is denied, the system banner is suppressed, but the in-app row
created before delivery may still exist in Notification Center.

---

## 2026-08-13 — Beta sync uses row-level last-write-wins

The Beta sync engine resolves every competing row version, including stock,
using updated_at last-write-wins. conflict_queue and stock delta-merge stay P1
and must ship before any multi-device shop pilot. Beta remains one active device
per shop.

---

## 2026-08-13 — Synced Postgres rows preserve client edit timestamps

The Postgres mirror does not attach a generic updated_at trigger to synced
tables. Sync writes preserve the canonical client edit timestamp because
replacing it with server arrival time would corrupt LWW ordering.

---

## 2026-08-13 — Supabase shop identity lives in app metadata

Cloud isolation reads app_metadata.shop_id, not client-writable user metadata.
RLS protects direct table access; the Edge Function independently verifies the
same claim for service-role sync calls; sync RPC execution is restricted to the
service role.

---

## 2026-08-13 — Synced SQLite timestamps use canonical ISO strings

All synced write sites stamp created_at and updated_at with Date.toISOString().
Local LWW comparisons parse timestamps to epoch milliseconds instead of
comparing mixed SQLite and ISO strings.
