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
