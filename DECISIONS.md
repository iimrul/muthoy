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

---

## 2026-08-16 — Day 5 Morning Dashboard and navigation shell are complete (backfilled)

Volume 0 Day 5's navigation shell, PIN login loop, and MorningDashboard shell
all ship. `app/(tabs)/_layout.tsx` is a minimal 3-tab bar (Dashboard, Sale,
Inventory); MorningDashboard shows the shop-name greeting plus a
permission-filtered tile list (`hasPermissionForRoleName`, see the Day 11
entry below) routing to every implemented P0 screen — this functional P0
navigation is done and exercised by every screen built since.

`StandardHeader` is live and used by most Day 6+ transactional/detail screens
(Sale's cart/checkout/confirmation, Inventory's tab/add-medicine/batches/
expiry, Cash Summary/Expenses/End of Day, Credit, Suppliers, Notifications).
MorningDashboard and Registration are documented in-code as deliberately
exempt (Volume 4 Navigation). Several other screens built since — Settings,
Staff Management, the PIN/OTP auth flow, Reports — do not yet call it; Volume
4's "every screen" framing describes the intended end state, not verified
current coverage.

Visual/UX parity with `apps/prototype-web`'s Figma-level polish is a separate
question from the above. CLAUDE.md rule 15 already keeps the prototype
reference-only for layout/UX ideas — its React Web architecture, styling, and
state management are never ported into React Native, on any timeline, not
just "for now." Beyond that permanent architectural boundary, no day in
`docs/playbook/00-execution-roadmap.md` commits to a specific visual-polish
pass, and neither does the P1/P2 list in that same volume.

**Audit note:** this entry was written in response to a request to also
record that prototype-level UI parity is "deferred to Days 26–28." That
figure does not appear anywhere in this repo — not in `docs/playbook/`, not
in `apps/prototype-web/`. It is not recorded here because it cannot be
verified against the live docs; if it is a real commitment made outside this
repo, it should be added explicitly with its source, not inferred.

---

## 2026-08-16 — Day 9 Expiry Management is complete; batch/medicine reads are join-isolated per shop (backfilled)

`app/inventory/expiry.tsx` lists every non-deleted batch shop-wide, nearest
real expiry date first, via `db/inventory.ts`'s `listBatchesByExpiry` —
sorted through the same `domain/fefo.ts` `sortByExpiry` the checkout
deduction path uses, never a second hand-rolled sort (CLAUDE.md rule 3: the
real `expiryDate`, recomputed at read time, never a stored day-count).

**Security decision:** the batch→medicine join enforces shop isolation on
BOTH sides. The `INNER JOIN`'s ON clause requires `medicines.shop_id =
shopId`, not only a later `WHERE` on `batches.shop_id`. A batch row whose
`medicine_id` points at another shop's medicine — a corrupted or hostile sync
payload — matches nothing and is dropped, instead of rendering that other
shop's medicine name under this shop's batch row. Filtering only
`batches.shop_id` would have leaked it (CLAUDE.md rule 7: one shop can never
see another's data).

The "Soon" threshold uses the shared repo-wide default
(`domain/notificationRules.ts`'s `EXPIRY_WINDOW_DAYS_DEFAULT = 30`), the same
window the Notifications expiry job alerts on, so the badge on this screen
and the alert the owner receives always agree. A per-shop configurable
threshold does not exist in the schema and needs a real Settings slice
(Volume 4 SETTINGS) before it can be built — intentionally deferred, not
started.

---

## 2026-08-16 — Day 10 Expenses/Cash Summary/End of Day are complete (backfilled)

`db/cash.ts` implements the full Day 10 slice: `recordExpense` (one
transaction writing both the `expenses` row and its `payments` row,
type='expense'), `setOpeningCash` (CLAUDE.md rule 5 — defaults to 0, set by
the user, written only against the business date passed in, never inherited
from yesterday), `getCashSummary`/`listExpenses`/`getEndOfDaySummary` (every
figure derived from `domain/cashFormula.ts`'s fixed formula — CLAUDE.md rule
4, never re-derived here), and `closeDay` (locks `cash_drawer`, recomputing
`closing_expected` from the ledger rather than trusting whatever the screen
last rendered, and storing `closing_counted` plus the resulting variance).
Money stays integer paisa throughout, consistent with the Day 2 decision.

**Closed-day guard:** `assertBusinessDateOpen` runs first, inside the same
transaction, for every write that could still affect an already-closed
date's locked snapshot — expenses, opening cash, sales (cash and credit),
customer credit collections, and supplier purchases (both COD and
credit-terms; a credit-terms purchase's stock write is blocked too, not just
its payment). A write against a closed date throws `DayClosedError` before
touching any row, so the transaction rolls back with zero partial rows or
outbox entries (proven in `db/closed-day-guard.sqlite.test.ts`).

Receipt-photo capture UI (camera/attach flow) remains deferred;
`recordExpense` accepts a `receiptPhotoUri` string today, but no screen
produces one yet.

**Verification on record:** automated coverage (`db/cash.sqlite.test.ts`,
`db/closed-day-guard.sqlite.test.ts`, `domain/cashFormula.test.ts`) runs a
full simulated day — opening cash, multiple cash/credit sales, an expense, a
credit collection, close — and asserts every Day 10 Validation Checklist line
by hand-calculated value; it is green. Volume 0's required real-device human
verification pass (Human Review Workflow, CLAUDE.md) for Day 10 is not
evidenced anywhere in this repo and should not be read as done from this
entry — automated test coverage is not a substitute for it
(DEVELOPMENT_RULES.md: "'AI said it works' is NOT done").

---

## 2026-08-16 — Day 11's centralized P0 permission model is complete (backfilled; supersedes the (Days 4-5/11) fragments above)

The SIMPLE two-role model Volume 0 Day 11 specifies (Owner = everything,
Staff = `sales` + `inventory_view` only; the full Owner/Manager/Staff matrix
stays P1) is implemented as one grant table, `domain/permissions.ts`:
`hasPermission(role, permission)` for code already holding a narrowed `Role`,
and `hasPermissionForRoleName(roleName, permission)` — the fail-closed entry
point for code holding a raw/untrusted role string (a persisted MMKV
session, or a `roles.name` read back from SQLite). The latter denies every
permission for anything `toRole` cannot narrow to exactly `'owner'` or
`'staff'`, including the P1 `manager` role every shop already carries from
registration, and any unknown/null/empty value.

Enforcement is two-layer, and both layers resolve through the same table so
they cannot disagree:
- Route guards (`state/usePermission.ts`) decide what renders; a denied role
  sees `components/ui/AccessDenied.tsx`, never a crash.
- Action guards (`db/auth.ts`'s `requirePermission`/`requireOwner`) re-derive
  the actor's role from SQLite — never from the session store — and run
  FIRST, before any query or transaction opens, so a denied direct-navigation
  write leaves zero rows and zero outbox entries. Proven in
  `db/permissions.sqlite.test.ts` by calling the `db/` actions directly, with
  no screen involved.

Fail-closed for manager/unknown extends to login itself: `verifyPin`
resolves the matched user's role through `toRole` and skips a manager/unknown
match entirely — such a PIN mints no session at all, rather than a session
whose role every downstream guard would then have to keep rejecting.

Current P0 permission keys, all owner-only except `sales`/`inventory_view`:
`staff_management`, `cash_management`, `settings_manage`, `credit_management`,
`inventory_write`. This covers cash/expenses/EOD, staff management and PIN
reset, Settings (including an owner's own PIN change — staff self-service PIN
change is NOT allowed; only an owner-driven `resetStaffPin`), and the
early-shipped supplier/purchase surface (still gated via `requireOwner`,
having no P0 permission key of its own) plus standalone customer-credit
management (`credit_management` is deliberately separate from `sales` — a
Staff-made credit SALE at checkout still works, because `createSaleTransaction`
writes the credit row itself). Cash-sensitive and Settings reads are gated at
the API (`getCashSummary`, `listExpenses`, `getEndOfDaySummary`,
`getShopProfile`), not just behind a hidden route — hiding a tile is
convenience, the API call is the enforcement.

Owner-configurable per-staff permissions and the full Manager matrix remain
P1 and are not implemented — `toRole` denying `'manager'` outright is the
explicit placeholder until that matrix ships.

**Verification on record:** automated coverage (`domain/permissions.test.ts`,
`db/permissions.sqlite.test.ts`, plus the permission assertions folded into
`db/cash.sqlite.test.ts` and `db/closed-day-guard.sqlite.test.ts`) proves
owner-allowed / staff-denied / manager-denied / unknown-role-denied for every
P0 permission, with zero side effects on denial, across direct db/-action
calls (the direct-navigation-bypass case) — 289 tests green as of this entry.
As with Day 10 above, Volume 0's required real-device human verification pass
is not evidenced in this repo and is not claimed here.

---

## 2026-08-17 (Day 14) — Basic Admin Panel ships as a server-only Next.js app

`apps/admin` implements Volume 0 Day 14 / Volume 5's P0 scope and nothing more:
**exactly two read-only pages**, both server components.

| Route         | Shows                                                      |
| ------------- | ---------------------------------------------------------- |
| `/`           | Total shops, total sales today (all shops, Asia/Dhaka day) |
| `/pharmacies` | Shop name, phone, registration date, plan                  |

Next.js 15 App Router, TypeScript strict, Tailwind v3. **Zero `'use client'`
files exist in the app** — that is the architecture, not a coincidence: a page
that cannot run in the browser cannot leak a server credential through a hook,
a prop, or a serialized RSC payload. Brand colors/radii come from
`@muthoy/constants` JSON tokens, money renders through `@muthoy/utils`'
`formatMoney` on branded `Paisa` values, and fonts bind through `next/font` CSS
variables (CLAUDE.md rule 6) rather than hardcoded family names.

Deliberately absent, per Volume 5's P1 line: charts/Recharts, maps/Leaflet,
subscription management, MRR/revenue, analytics, audit-log views, reports,
search/filter, per-shop drill-down, admin Users/role management, admin
settings. Note that TECH_STACK.md's Admin Panel section lists shadcn/ui,
Recharts and Leaflet — those are the P1 end state; none are installed today.

### The credential model

Volume 5's one governing rule is that the service-role key lives in server-side
code only. Four independent mechanisms enforce it rather than one:

1. `lib/env.ts` is the **only** module naming `SUPABASE_SERVICE_ROLE_KEY`, and
   the variable is deliberately not `NEXT_PUBLIC_`-prefixed, so Next never
   inlines it into client JavaScript.
2. `lib/env.ts`, `lib/supabaseAdmin.ts` and `lib/queries.ts` each open with
   `import 'server-only'` — importing any of them from a client component is a
   **build failure**, not a runtime surprise.
3. No client components exist to import them from.
4. `lib/errors.ts` sanitises failures: the browser gets a fixed sentence, the
   detail goes to the server log, so a Postgres error can never carry schema or
   connection detail into the page.

`lib/serviceRoleExposure.test.ts` asserts 1-3 on every test run by scanning the
app's own source, so the guarantee degrades loudly rather than silently.

### Basic Auth is a temporary P0 gate, not the P1 auth feature

`middleware.ts` puts HTTP Basic auth (constant-time comparison) in front of
every route and **fails closed** — with `ADMIN_BASIC_AUTH_USER` /
`ADMIN_BASIC_AUTH_PASSWORD` unset, every route returns 503 rather than serving.

This was added because Volume 0 Day 14 specifies no authentication at all for
the admin panel, and a deployed admin URL with no gate publishes every
pharmacy's name and phone number to anyone who finds it. A single shared
credential is the minimum that closes that hole inside P0 scope.

**It is explicitly not production admin authentication.** Real admin identity
(individual accounts), RBAC (Volume 5's P1 super-admin vs support-read-only
split), MFA, session management, and audit of admin access all remain **future
hardening** — none is implemented, and Basic Auth should be replaced rather
than extended when they land.

### Live Supabase verification: FAILED FIRST, fix written, NOT yet re-verified

Run against the live Supabase project, both pages failed:
`permission denied for table shops` (SQLSTATE 42501), and the dashboard's
shop-count query failed the same way.

**Root cause:** `service_role` carries `BYPASSRLS`, which skips row-level
*policies* but confers **no table privileges**. PostgREST still runs
`set role service_role`, so every statement is checked against the table ACL
first — and `20260813000000_initial_schema.sql` creates all 21 business tables
while issuing no table-level `GRANT` for any of them. Only `shop_claims` and
the four sync functions ever received explicit grants. Sync was unaffected
precisely because it goes through the `SECURITY DEFINER` functions
`sync_apply_row` / `sync_pull_changes`, which execute with the definer's
privileges.

**This is corrected by two new additive migrations. Neither edits the applied
initial schema.**

`20260817000000_admin_read_grants.sql`
```sql
grant select on table public.shops to service_role;
grant select on table public.sales to service_role;
```
Why: `shops` backs the pharmacy list and the shop count; `sales` backs today's
platform total. Those are the only two tables `lib/queries.ts` touches, and it
joins nothing. Least-privilege scope: `SELECT` only (the panel never writes),
those two tables only, `service_role` only — `anon` and `authenticated` gain
nothing. `ALTER DEFAULT PRIVILEGES` was deliberately **not** used: it would
silently grant `service_role` access to every future table. New tables must opt
in explicitly.

`20260817000100_sync_roles_read_grant.sql`
```sql
grant select on table public.roles to service_role;
```
Why: auditing the same failure class across the repo found a second instance
outside the admin panel. `functions/sync/push.ts` authorizes an incoming
`permissions` row by reading the owning role's shop **directly** through
PostgREST (`.from("roles").select("shop_id")`) — the one sync database access
that does not go through a `SECURITY DEFINER` function, so it runs as
`service_role` and hits the same empty ACL. Its failure mode is worse than a
visible error: `authorizeRow` maps the error to a *transient* rejection and
`push` then sets `halted = true`, so the permissions row never applies and
every later row in the batch is skipped — the batch retries forever instead of
failing loudly. Least-privilege scope: `SELECT` only, `roles` only,
`service_role` only. A column-level `grant select (id, shop_id)` was considered
and rejected — `roles` holds no sensitive column and `service_role` can already
read every column of it via `sync_apply_row`, so it would buy no
confidentiality while breaking silently the moment that SELECT list changes. A
new `SECURITY DEFINER` lookup function was also rejected as larger, not
smaller: it adds a privileged function to review and requires editing `push.ts`.

Neither migration adds, drops, or alters any policy; RLS stays exactly as the
initial migration left it, as do the `shop_claims` revoke and the sync RPC
`EXECUTE` lockdown. Neither grants any write privilege.

**Status, stated plainly: the migrations are written but NOT deployed.** The
live "permission denied" failure has therefore not been re-tested and the admin
panel is not yet known to work against live Supabase. Deploy with
`supabase db push --dry-run` then `supabase db push` from `backend/`, then
re-run the pages before treating Day 14 as verified.

### Verification actually performed — and what was not

Performed:
- 48 automated tests across `lib/platformStats.test.ts` (14),
  `lib/basicAuth.test.ts` (15), `lib/serviceRoleExposure.test.ts` (8) and
  `lib/adminGrants.test.ts` (11), plus `backend/.../sync/grants.test.ts` (12)
  guarding the sync grant. The two grant guards were checked against the
  pre-fix migration set to confirm they actually fail without the fix, rather
  than passing vacuously.
- `next build`, typecheck and lint clean; production server started and both
  pages loaded.
- Key-exposure check with a **sentinel (fake) credential**: its value appears
  nowhere in `.next/static`, anywhere else in the `.next` output, or in any
  HTTP response body, on both pages, authenticated and unauthenticated.
- Basic Auth fail-closed confirmed (503 with the variables unset).

**NOT performed — do not read this entry as claiming any of it:**
- Volume 0 Day 14's own Human Review item: the founder checking devtools'
  network tab personally, **with the real production key**. The sentinel check
  proves the mechanism, not the deployed secret.
- Day 14's Testing Checklist item: register a test shop on the mobile app, sync
  it, confirm it appears in the admin panel within one sync cycle.
- Any run against live Supabase after the grant migrations (see above).
- Any deployment of `apps/admin` to Vercel.

One unrelated pre-existing test is red and was left alone as out of scope:
`db/permissions.sqlite.test.ts`'s "refuses to log a manager in at all" times
out at 5000ms under full-suite parallel load (it passes alone at ~2.5s, already
half its budget). Confirmed pre-existing — it fails identically with the Day 14
test files excluded.

---

## 2026-08-18 — Multi-device inventory: stock becomes a derived ledger, not a synced column

**The bug this replaces:** `batches.stock` was a plain LWW-synced integer.
Two devices selling from the same batch offline each computed their own new
absolute stock and pushed it; sync then kept whichever write had the later
`updated_at` and silently discarded the other device's sale from the stock
figure. Not a rare edge case — the default outcome of any two-device shop.

**The fix, in both SQLite and Postgres:** `batches.stock` is now a derived
projection — `stock = SUM(inventory_movements.change_qty)` — enforced by a
trigger guard in each store (`batches_stock_guard` / SQLite,
`batches_stock_is_ledger_derived` / Postgres) that rejects any write to
`stock` not equal to `OLD.stock` plus the ledger delta being applied. Every
stock change (sale, purchase, adjustment, opening quantity) is a signed
`inventory_movements.change_qty` row; the apply trigger
(`inventory_movement_applies_delta` / `apply_inventory_movement`) is the only
writer of `stock`, and it **adds**, so two devices' concurrent deltas combine
instead of one clobbering the other.

**New batches start at `stock: 0`, then take an opening movement** through the
same `addStock` path every later sale/purchase uses — never baked into the
insert as a special case. Every batch's history is therefore complete back to
row zero; there is no bootstrap exception for the guard to special-case.

**Movements are append-only.** The existing UPDATE-immutability trigger is
joined this round by a DELETE guard in both stores
(`inventory_movement_is_undeletable` / `inventory_movement_no_delete`,
Postgres errcode `MU007`) — a movement can never be physically removed, only
tombstoned (`is_deleted`), and a tombstoned movement's delta deliberately
stays in the ledger sum because it genuinely happened. No legitimate write
path needs physical deletion.

**Devices/cloud rows that predate the ledger** hold stock with no movement
history at all — the guard would reject every future write to them. Migration
`0006` (SQLite) and `20260818000000`/`20260818000100` (Postgres) backfill one
synthetic `adjustment` movement per gap, using an id **deterministically
derived from the batch's own UUID** (its version nibble set to `8`) so the
device and the cloud, backfilling the same historical gap independently, mint
the identical primary key and reconcile as a no-op instead of doubling the
quantity. Both backfills fail loudly (abort, never skip) on a stock gap in a
shop with no user row to attribute it to.

**Hydration ordering:** `HYDRATION_TABLE_ORDER` now applies to both full and
incremental pulls (previously only full hydration had it — an incremental-pull
gap found and fixed this round). Full hydration for a fresh device runs as one
transaction, so a device is never left observing a partially-applied ledger.

**Offline reconciliation keeps oversells, flagged, never silently drops or
clamps them** — an offline sale that oversells is written with `oversold_at`
set; `displayableStock()` clamps only what the UI renders, never what is
stored or summed.

**Realtime is a signal, not a data channel.** `sync/realtime.ts` subscribes
to `batches` (its `updated_at` moves on every applied delta, covering sales,
purchases, returns, and adjustments alike) per shop; the payload itself is
discarded, and receipt just triggers the existing incremental pull, so there
remains exactly one apply path with FK ordering, LWW, and ledger idempotency
all still enforced normally — no second, forked apply path for CDC payloads.

**Invoice numbers gained a 12-character UUID-tail suffix**:
`{INV|PUR}-{YYYY}-{6-digit-seq}-{12 uppercase hex}` (`domain/invoice.ts`). The
sequence is still counted per-device and two phones can still both reach, say,
document 11 — that is now expected and harmless, because the suffix (the
UUID's own 48-bit node field, taken from the tail, not the fixed-nibble head)
is what `sales_shop_invoice_unique` / `purchases_shop_invoice_unique`
actually rests on. Before this, a same-sequence collision from two offline
devices was silent, permanent data loss for the second sale at sync time.

**Deferred, explicitly:**
- The Dev/Test Postgres migration (both ledger migration files, plus the
  read-only `backend/supabase/checks/ledger_invariant.sql` verification
  query) is written and tested but **not yet pushed** to the linked Dev/Test
  Supabase project.
- Return/write-off UI does not exist yet. The ledger's `reason` vocabulary
  (already used by the backfill's `adjustment` reason) supports it
  structurally; no screen or dedicated reason code has been built.
- Separate-device Owner/Staff login — a Staff member authenticating from
  their own device rather than an Owner handing theirs over — is not yet
  supported by the session/auth flow. Planned as the next phase after this
  ledger/sync work lands.

---

## 2026-08-20 — PIN authentication latency state

Physical Android testing observed an approximately 15–16 second baseline after
PIN confirmation and phone + PIN login. The perceived freeze is fixed: all four
PIN bullets paint and an immediate loading state is shown while the existing
work completes. Actual latency reduction has not yet been proven.

**PHYSICAL TIMING VALIDATION: PENDING.** Development-only timing instrumentation
now separates input validation, local bcrypt work, Edge invocation, server
processing, identity work, session minting/validation, hydration, initial sync,
and navigation/render completion. Mobile timing logs are guarded by `__DEV__`;
server timing additionally requires explicit development environment flags. No
PIN values, phone/account identifiers, tokens, or other sensitive values are
logged.

No bcrypt cost, PIN validation, required server validation, hydration, or other
security guarantee was weakened. The temporary DEV OTP bypass must be removed
and anonymous sign-in disabled before production. Production Owner registration
requires a real OTP provider. Normal Owner and Staff login remains phone + PIN;
OTP is used only for registration and Owner PIN recovery.

---

## 2026-08-20 — Native Android PIN crypto and indexed local login

The physical 30–33 second Staff confirmation was two serial pure-JS bcryptjs
operations on Hermes: one uniqueness comparison against the Owner plus one
hash. Enrolled PIN login was also linear in user order, at approximately
15–16 seconds per comparison. Network sync was fire-and-forget, but could begin
before the destination rendered.

Android now uses a local Expo module wrapping `at.favre.lib:bcrypt` 0.10.2 at
unchanged cost 10. Its standard bcrypt hashes verify existing `$2a$`/`$2b$`/
`$2y$` credentials; no credential rewrite is required. The earlier bcryptjs
decision above remains historical context and is superseded for Android.

Migration 0008 is SQLite-only. It adds a local Android-Keystore HMAC-SHA256 PIN
lookup tag bound to `pin_set_at`. The non-exportable key and tag never sync;
plaintext/recoverable PIN storage was not introduced. Current users get O(1)
device-wide lookup plus one bcrypt compare. Staff uniqueness is one lookup plus
one hash, including when multiple shops exist locally. Legacy
untagged hashes are native-verified and lazily tagged on successful login; that
one-time compatibility scan is the explicit exception.

Hard product rules: enrolled PIN login is local and navigates before any
network work; Staff creation navigates after the SQLite/permissions/outbox
transaction commits; background sync starts only after navigation interactions.
Fresh-device login still awaits Edge verification, session adoption, full
hydration, and one exact-user local bcrypt verification, but not initial sync.

Targets: enrolled login <=2 seconds (ideally <1 second), Staff creation <=2–3
seconds on target Android hardware. Development timings now separate lookup,
bcrypt compare/hash, SQLite/permissions/outbox, Edge/session, hydration,
navigation, and background-sync start. **PHYSICAL TIMING VALIDATION: PENDING.**

---

## 2026-08-21 — Phase B2 sales and inventory contracts

Phase B2 follows `docs/plans/phase-b2-sales-inventory.md`. Locked rules:

- Stock expired before the Asia/Dhaka business date is unsellable; null expiry
  remains sellable and FEFO-last. Checkout allocates and prices every consumed
  batch inside one SQLite transaction, using integer paisa and requiring
  reconfirmation after a changed quote.
- Per-batch percentage promotions apply before one sale-level amount/percentage
  checkout discount. Split tender is cash plus customer credit only. Holds do
  not reserve stock. Prescription metadata and image are optional/non-blocking.
- Refund is full-sale only, reason-required, deterministic/idempotent, and
  reverses the exact original payment components. Before any physical payout or
  local refund mutation, `sync/` must obtain the sale's sole active server claim.
  Offline Refund stays disabled with “Internet required for refund” and changes
  no sale, stock, cash, credit, or ledger state. Claims never auto-expire or
  reassign; only their bound operation/device can resume until server commit.
- Shop low-stock fallback is 10 with a nullable medicine override. Expiry bands
  are Near 0–30 and Far 31–60 days. Duplicate same-shop barcodes are allowed and
  require an ambiguity picker. Archive is soft and requires zero ledger stock,
  no unresolved oversell, and no active promotion. Owner CSV import is previewed,
  validated, and committed as one ledger/outbox operation.

The founder approved the B2 safety gate for local implementation only. Remote
migration push/execution, deployment, and commit remain separately prohibited.

---

## 2026-08-22 — Owner Dashboard functional parity

Follows `docs/plans/owner-dashboard-parity-recovery.md`. The prototype's
`MorningDashboard` is the functional source of truth; production SQLite, the
fixed cash formula, FEFO, the stock ledger, permissions, and sync remain the
implementation authority. Founder decisions, approved 2026-08-22:

1. **Alert previews.** Expiry and Low Stock each show at most 3 rows, and
   "+N more" is computed from the unbounded SQLite COUNT. This supersedes the
   prototype, which rendered 2 rows from a list already capped at 5 and could
   therefore never report more than "+3" however many batches were expiring.
2. **Credit period.** New synced `shop_b2_settings.credit_max_days`, default 7,
   mirroring `max_refund_days`. A credit is overdue once its local creation
   date is older than that many days — `credits` carries no due date — and the
   overdue figure counts distinct customers, not rows.
3. **Expected Cash card.** Shows the exact expected total from
   `domain/cashFormula.expectedCash` plus a Details link into Cash Summary.
   No partial "open + sales − expenses" subtitle: three of the seven fixed
   terms would disagree with Cash Summary the moment a refund, collection,
   supplier payment, or withdrawal existed (CLAUDE.md rule 4).
4. **Complete Day.** The dashboard card routes to the existing `/end-of-day`
   and its real `closeDay`. The prototype's three-step modal, whose success
   step wrote a fake `dailyHistory` archive, is superseded.
5. **New Sale button.** Removed from the Owner Dashboard. The prototype reaches
   Sale through the bottom navigation shell, which B1 already ships.

Two money-correctness defects were fixed ahead of any new surface:
`getStaffPerformance` valued a staff member's credit, split, and free sales at
zero (`CASE WHEN payment_type = 'cash'`) and listed non-selling staff under
"Today's Active Staff"; and the dashboard rendered a blank screen for a
non-owner and swallowed load failures as unhandled rejections.

Local implementation only. Remote migration push/execution, deployment, and
commit remain separately prohibited: `0013_owner_dashboard_credit_period.sql`
and `20260822000000_owner_dashboard_credit_period.sql` are written and tested
locally but unpushed.
