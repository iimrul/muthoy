# MUTHOY POS — AI ENGINEERING PLAYBOOK
## VOLUME 2 — System Architecture
### Full detail also in muthoy-architecture-v3.md and muthoy-system-design.md — this
### volume adds the monorepo structure and diagrams those files didn't cover.

---

## COMPLETE MONOREPO STRUCTURE (canonical — pnpm + Turborepo)
```
MuthoyPOS/
├── apps/
│   ├── mobile/                    # Production React Native app (Expo)
│   │   ├── app/                   # Expo Router file-based routes
│   │   │   ├── (auth)/            # register, pin-setup, pin-login, role-select
│   │   │   ├── (tabs)/            # dashboard, sale, inventory, more
│   │   │   ├── sale/              # checkout, cart
│   │   │   ├── inventory/         # add-medicine, expiry, batches
│   │   │   ├── credit/            # credit-sales, customer-detail
│   │   │   ├── suppliers/         # list, detail, purchase-create
│   │   │   ├── staff/             # management, sales-view
│   │   │   ├── reports/           # report, monthly-report, sales-history
│   │   │   └── settings/          # settings, plans, plan-payment
│   │   ├── components/            # screen-local reusable components
│   │   │   ├── ui/                # Header, PinPad, PlanBadge, buttons...
│   │   │   └── forms/             # RHF+Zod form components
│   │   ├── db/                    # Drizzle schema instance, migrations, DB init
│   │   ├── state/                 # Zustand stores
│   │   ├── domain/                # pure logic: fefo.ts, cashFormula.ts,
│   │   │                          #   permissions.ts, discounts.ts
│   │   ├── sync/                  # sync_queue writer, TanStack Query sync layer
│   │   ├── native/                # scanning, biometrics, location, notifications
│   │   └── assets/                # app-specific: fonts, splash, icons
│   │
│   ├── admin/                     # Basic version built Day 14 (P0/Beta);
│   │                              #   Full version is P1, post-beta
│   │   ├── app/                   # pharmacy list, dashboard, map, subscriptions
│   │   ├── components/
│   │   └── lib/                   # server-only Supabase service-role client
│   │
│   └── prototype-web/             # Figma Make output — REFERENCE ONLY, never
│       ├── README.md              #   built or deployed, never imported by
│       ├── SCREENS.md             #   mobile/admin. Lives here (not outside the
│       ├── ANALYSIS.md            #   workspace) so Cursor can read it in the
│       └── (all original Figma Make files)  # same session as the real apps.
│
├── backend/
│   └── supabase/
│       ├── migrations/            # supabase-schema.sql and every migration after
│       └── functions/             # Edge Functions (sync, payment-webhook)
│
├── packages/
│   ├── ui/                        # Shared components used by BOTH mobile + admin
│   ├── types/                     # TypeScript types generated from the schema
│   ├── utils/                     # formatMoney/formatNumber, date helpers, etc.
│   ├── validation/                # Zod schemas — the single source every form
│   │                               #   (mobile) and every admin write uses
│   ├── constants/                  # brand tokens, plan limits, permission keys
│   └── config/                      # shared eslint/tsconfig/tailwind base configs
│
├── docs/
│   └── playbook/                     # Volumes 0-10 of this playbook live here
│
├── assets/                             # canonical brand source files (logo SVGs,
│                                        #   original font files) — apps/* consume
│                                        #   copies; this is the single source
├── .github/                              # GitHub Actions workflows
├── .vscode/                               # editor settings, recommended extensions
│
├── CLAUDE.md                                # AI-specific rules (Volume 1's Claude
│                                             #   Rules section) — always loaded
├── PROJECT_CONTEXT.md                        # vision, users, goals, non-goals
│                                              #   (Volume 1's first half)
├── TECH_STACK.md                              # the locked stack, one file
├── DEVELOPMENT_RULES.md                        # coding/naming/folder/git standards,
│                                                #   Definition of Done (Volume 1's
│                                                #   second half)
├── DECISIONS.md                                 # running decision log
├── turbo.json
├── pnpm-workspace.yaml
└── README.md
```

## FOLDER RESPONSIBILITIES (one-line rule per folder)
- `apps/mobile/app/` — layout and navigation ONLY. No business logic, no direct DB calls.
- `apps/mobile/components/` — presentation. Receives data via props, never fetches it.
- `apps/mobile/db/` — the ONLY code that imports Drizzle or touches SQLite directly.
- `apps/mobile/state/` — in-memory session/cart/UI state, not the source of truth.
- `apps/mobile/domain/` — pure functions, zero React/DB imports, 100% unit-testable.
- `apps/mobile/sync/` — the ONLY code that talks to Supabase from the mobile app.
- `apps/mobile/native/` — the ONLY code that imports native modules (camera, location, etc).
- `apps/admin/` — server components/API routes only touch Supabase; the service-role
  key never reaches `apps/admin`'s client-side bundle.
- `apps/prototype-web/` — read-only reference. Cursor may READ it for layout/flow
  when a prompt points at it; nothing in `apps/mobile` or `apps/admin` ever
  imports from it — it doesn't build, doesn't ship, and can be deleted without
  breaking anything.
- `backend/supabase/` — the cloud schema and Edge Functions; the only place that
  defines what Postgres/RLS actually is.
- `packages/*` — anything both apps need identically; changing it here changes it
  everywhere, which is the point. `validation/` in particular must be the ONLY
  place a Zod schema is defined — never redefined ad hoc inside a screen.
- `docs/playbook/` — this playbook (Volumes 0-10). Cursor is pointed here for
  the day's/feature's exact spec; it is not auto-loaded every session the way
  the four root files are.

## MOBILE ARCHITECTURE (the 8 layers — full detail in muthoy-architecture-v3.md)
```
Navigation (Expo Router) → Screens → Forms/Validation (RHF+Zod) → State (Zustand)
  → Domain logic (pure TS) → Data layer (Drizzle/SQLite) → Sync layer
  (TanStack Query + sync_queue) → Native capability layer (ML Kit, biometrics,
  location, notifications, MMKV, SQLCipher)
```

## ADMIN ARCHITECTURE (Basic = Day 14, P0/Beta; Full = P1, post-beta —
## full detail in muthoy-system-design.md §3 and Volume 5)
Next.js on Vercel, server components/API routes only touch Supabase (service-role
key never reaches the browser). Recharts for standard charts, Leaflet for the
shop-location map.

## SHARED PACKAGES — what goes where
- `packages/ui` — shared visual components (if any are truly identical between
  mobile and admin — most UI is app-specific; this stays small).
- `packages/types` — TypeScript types generated from `backend/supabase` schema,
  consumed by both `apps/mobile` and `apps/admin`.
- `packages/utils` — `formatMoney()` (DM Mono rule) / `formatNumber()` (Plus
  Jakarta Sans rule), date/expiry helpers — used identically on both sides.
- `packages/validation` — every Zod schema. A form in `apps/mobile` and any
  future admin-side write both import from here — never duplicated.
- `packages/constants` — brand tokens (colors/fonts/spacing), plan limits
  (Free/Pro/Ultra caps), permission keys — single source for values that must
  never drift between the two apps.
- `packages/config` — base ESLint/TypeScript/Tailwind configs both apps extend.

## PROTOTYPE RULES
`apps/prototype-web/` holds the original Figma Make output (React + localStorage).
It is REFERENCE-ONLY. Precisely what that means:

**USE it for:** UI/UX, screen layouts, navigation, visual hierarchy,
components, and interaction patterns. When a Cursor prompt says "match
apps/prototype-web's Sale Entry," it means look at how that screen is laid
out, what it shows, and how it flows — then rebuild that experience natively.

**Do NOT copy:** its React Web architecture, its CSS, its business logic, its
state management, or its data layer into React Native. None of these
transfer — the prototype is a web app on localStorage; the real app is
React Native on SQLite with a completely different architecture (Volume 2's
8-layer model). Copying logic across that boundary reintroduces exactly the
kind of bugs already found and fixed once (see ANALYSIS.md below) or produces
code that looks native but silently behaves like a web app.

Three files inside it make it usable as a build spec:
- `README.md` — the rule above, stated for anyone opening the folder cold.
- `SCREENS.md` — an inventory of every prototype screen and what it does.
- `ANALYSIS.md` — known issues/decisions already resolved during the
  prototype phase (FEFO fixes, isolation fixes, etc.) so a bug already found
  and fixed once is never silently reintroduced in the native rebuild.

It is never imported, never built, never deployed.

## LAYERED ARCHITECTURE
See Volume 1's Coding Standards and the 8-layer list above. The one rule that
matters most: data flows in ONE direction, screen → domain → data → sync. A PR
(or Cursor-generated diff) that has a screen importing from `sync/` or `db/`
directly should be rejected on sight.

## OFFLINE SYNC (full detail in muthoy-system-design.md §2.1, §4)
```
Local write → sync_queue row → (online) push to Edge Function in batches →
retry with backoff on failure → pull other devices' changes → reconcile
(stock as DELTAS, everything else last-write-wins by updated_at, true
conflicts → conflict_queue surfaced to the owner)
```

## SECURITY ARCHITECTURE
- RLS on every cloud table (see supabase-schema.sql, in backend/supabase/) —
  isolation enforced at the database, not just the app.
- PINs bcrypt-hashed on-device; SQLCipher encrypts the local DB file.
- Service-role key exists ONLY in apps/admin's server-side code, never shipped
  to any client.
- Every foreign key has an explicit `onDelete` policy (see Volume 3) so deletion
  behavior is never accidental.

## DATA FLOW (text diagram)
```
User taps → Screen calls a domain function → domain function validates (Zod
  from packages/validation) → calls the data layer (Drizzle write in
  apps/mobile/db/) → data layer also writes a sync_queue row → screen re-renders
  from a fresh SQLite read (via a hook, not from the write's return value
  directly, so the UI always reflects the DB's actual state)
```

## COMPONENT FLOW (a Sale, concretely)
```
SaleEntry screen (apps/mobile/app/sale) → search hook (reads FTS5 via db/) →
  tap result → cart store (state/, Zustand) updates → Cart screen renders from
  the store → Checkout screen reads the store, calls domain/fefo.ts +
  domain/cashFormula.ts → writes via db/ → clears the cart store → navigates to
  a receipt/confirmation state
```

## SEQUENCE DIAGRAMS (text — see also the rendered flow diagrams shared earlier
## in this conversation for the sale/sync and scan flows)
```
SEQUENCE: Checkout confirm
  Screen -> domain/cashFormula: calculate expected total
  Screen -> domain/fefo: resolve batch(es) to deduct for each cart line
  Screen -> db: write sales, sale_items, inventory_movements (one transaction)
  db -> sync: enqueue each written row
  db -> Screen: return the new sale id
  Screen -> state: clear cart
  Screen -> Screen: navigate to confirmation
```

## CLASS DIAGRAMS (text — key domain types, not DB tables)
```
class Cart {
  items: CartLine[]
  addItem(medicineId, batchId, qty)
  total(): Money
}
class CartLine {
  medicineId, batchId, qty, unitPrice, discount?
  lineTotal(): Money
}
class FEFOResolver {
  activeBatch(medicineId): Batch
  deduct(medicineId, qty): DeductionResult[]  // may span multiple batches
}
class CashDrawerCalculator {
  expected(openingCash, sales, collections, expenses, refunds,
           supplierPayments, withdrawals): Money
}
```

## NAVIGATION FLOW
```
(auth)/register → (auth)/pin-setup → (tabs)/dashboard
(tabs)/dashboard → (tabs)/sale → sale/checkout → back to (tabs)/dashboard
(tabs)/inventory → inventory/add-medicine → back to (tabs)/inventory
(tabs)/more → settings/*, staff/*, reports/*, credit/*, suppliers/*
```
Route groups `(auth)` and `(tabs)` cleanly separate pre-login and in-app screens,
per Expo Router convention.

## AI WORKFLOW — three tools, three distinct roles (do not collapse into one)

**Cursor Pro** — the primary IDE. Code navigation, editing, debugging, local
development, and day-to-day AI-assisted implementation. This is where most
hours are spent: opening files, iterating on a screen, fixing something you
just saw fail on the test device.

**Claude Code** — terminal/agent-based implementation. Used for
repository-wide tasks: architecture-aware coding that touches many files at
once, refactoring, testing, and automation. In Volume 0's 15-day plan, this is
specifically Day 2 (schema rollout across the whole db/ layer), Day 12
(Supabase schema + RLS deployment), and Day 13 (the sync engine, which spans
db/, sync/, and auth screens). Reach for Claude Code when a task is "implement
this across the repo," not "fix this one screen."

**Claude Chat** — planning, architecture, documentation, prompt generation,
and daily development guidance. Used every morning to plan the day and
generate/refine that day's exact Cursor Pro or Claude Code prompt before
opening either tool.

**One tool never replaces another.** Cursor Pro remains the primary
day-to-day IDE throughout — Claude Code is reached for specifically when a
task's shape calls for it (repo-wide, architecture-aware), not as a general
substitute. See Volume 0's per-day "WHICH AI TOOL" guidance and Volume 6's
prompt library for which tool fits which prompt.

The governing loop regardless of tool: full context once (CLAUDE.md +
PROJECT_CONTEXT.md + TECH_STACK.md + DEVELOPMENT_RULES.md) → one unit of work
at a time → plan → approve → build → test on device → commit → next.

## FOLDER CREATION ORDER (Day 1, exact sequence)
```
1. Root workspace (pnpm-workspace.yaml, turbo.json, README.md)
2. Root docs: CLAUDE.md, PROJECT_CONTEXT.md, TECH_STACK.md, DEVELOPMENT_RULES.md,
   DECISIONS.md
3. packages/config (base configs everything else extends)
4. packages/constants (brand tokens — everything visual depends on this)
5. packages/types + packages/validation (scaffolded, filled in as features build)
6. packages/utils
7. packages/ui (scaffolded, mostly filled in later)
8. backend/supabase (folder created; migrations/functions populated Day 12-13, P0)
9. apps/prototype-web (the Figma Make export copied in, + its README/SCREENS/ANALYSIS)
10. apps/mobile (Expo init, then app/, components/, db/, state/, domain/, sync/,
    native/, assets/ in that order)
11. apps/admin — Basic Admin (P0) built Day 14: two server-only read pages,
    dashboard + pharmacy list. The Full Admin build-out (P1) happens post-beta
    in the same folder
12. docs/playbook (this playbook's Volumes 0-10 copied in)
13. .github/, .vscode/
```
