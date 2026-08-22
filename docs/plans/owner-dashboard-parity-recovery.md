# Owner Dashboard Functional Parity — Recovery Plan

Date: 2026-08-22
Mode: read-only audit + plan. No B3/B4 implementation, no commit, no deploy, no migration execution.
Functional source of truth: `apps/prototype-web/Muthoy (prototype)/src/app/screens/MorningDashboard.tsx` and the components it mounts, read directly.
Implementation authority: current production SQLite read models, `domain/`, permissions, sync, paisa, FEFO, ledger.

Prototype files inspected:

- `src/app/screens/MorningDashboard.tsx` (1337 lines — the whole owner surface)
- `src/app/components/cash/ExpectedCashCard.tsx`
- `src/app/components/cash/OpeningCashModal.tsx`
- `src/app/components/cash/PreviousDaySummaryModal.tsx`
- `src/app/services/cash/dayRollover.ts`
- `src/app/utils/staffPerformance.ts`

Current app compared: `apps/mobile/app/(tabs)/dashboard.tsx` (57 lines, 5 rendered blocks).

Scope note: these are **functional** requirements. Final typography, spacing, colour, and animation parity stay Phase C. Plan badge, trial banner, and shop switcher stay B4 per `phase-b1-navigation-roles.md`.

---

## DASHBOARD AUDIT

41 elements. `DONE 8 · PARTIAL 4 · WRONG 3 · MISSING 25 · EXTRA 1`.

### Header

| # | Element | Status | Prototype behaviour | Current app |
|---:|---|---|---|---|
| 1 | Hamburger → Quick Links drawer | PARTIAL | Left overlay drawer, backdrop dismiss, closes on navigate | Full-height `Modal` drawer, backdrop dismiss, closes on navigate. Not fed by `navigation/routes.ts`, so it can drift from the More registry |
| 2 | Quick Links: 15 destinations | DONE | Sale, Inventory, Credit, Expense, Sales History, Expiry, Supplier Invoices, Suppliers, Report, Staff, Staff Sales, Export, Printer, Settings, Plans | Same 15 in `LINKS`, same targets |
| 3 | Quick Links icons + tint chips | MISSING | Per-route icon, tint, background | Text rows only — **Phase C** |
| 4 | Quick Links logout | PARTIAL | `LogoutConfirmationModal` with owner/staff copy | `Alert.alert` reusing `switchUser`/`shiftSummary` keys; copy is wrong for an owner and there is no reusable confirmation component |
| 5 | Header brand title | MISSING | `PHARMAPOS` wordmark | Absent — **Phase C** |
| 6 | Sync control | PARTIAL | Spinner, `Last synced: <time>` title, fires sync-completed notification | `triggerSyncNow` + reload, `…` while running. No last-synced timestamp, no failure surface, no completion notification |
| 7 | Notification bell + unread badge | DONE | Badge, tap → notifications | `useUnreadCount`, caps at `10+`, tap → `/notifications` |
| 8 | Language toggle | DONE | bn/en | `LanguageToggle`, persisted MMKV locale |

### Greeting / hero

| # | Element | Status | Prototype behaviour | Current app |
|---:|---|---|---|---|
| 9 | Greeting + name | **WRONG** | Bands 5–12 morning, 12–17 afternoon, 17–19 evening, else night; greets the **logged-in user** | Bands `<12 / <17 / <20 / else`; greets the **shop name**. Both the boundary set and the subject are wrong |
| 10 | Date line | MISSING | Localised weekday + month + day + year, Bangla numerals in bn | Absent |
| 11 | PlanBadge | MISSING | Plan/trial chip on the green hero | `components/ui/PlanBadge.tsx` is a TODO stub — **B4** |
| 12 | Shop pill + ShopSwitcherSheet | MISSING | Shown only when multiple shops exist | No active-shop model — **B4** |

### Horizontal KPI carousel

| # | Element | Status | Prototype behaviour | Current app |
|---:|---|---|---|---|
| 13 | Carousel container | MISSING | Horizontal scroll strip of 5 cards inside the green hero | No carousel |
| 14 | Card 1 — Today's Sales + LIVE dot | MISSING | Sum of today's transactions, live pulse | **No today's-sales figure anywhere on the owner dashboard** |
| 15 | Card 2 — Expected Cash | MISSING | `ExpectedCashCard`: expected total, `Details ›` → cash summary, `Open ৳x + Sales ৳y − Exp ৳z` line, inline `set` link when opening cash is 0 | Absent. `/cash-summary` exists but is only reachable via drawer/More |
| 16 | Card 3 — Yesterday's Sale | MISSING | Tap opens `PreviousDaySummaryModal` for yesterday's date key | Absent |
| 17 | Card 4 — Outstanding Credit | MISSING | Total credit + `N people` | Absent |
| 18 | Card 5 — Supplier Payable | MISSING | Total payable + supplier count, tap → Suppliers | Absent |

### Alerts stack

| # | Element | Status | Prototype behaviour | Current app |
|---:|---|---|---|---|
| 19 | Expiry Alert card | MISSING | Always visible. Rows of `name · N days`, `+N more`, empty copy `No expiry alerts`, whole card taps to Expiry, `View Details` link | Absent |
| 20 | Low Stock Alert card | MISSING | Always visible. Rows of `name · N pcs`, `+N more`, empty copy `Stock is good`, card taps to Inventory, `View List (N)` | Absent |
| 21 | Credit / dues card | MISSING | Headline `N people have credit` or `No credit`, total, red-dot `N overdue`, tap → Credit | Absent |
| 22 | Sales History card | MISSING | Gradient card, tap → Sales History | Absent (the route exists) |
| 23 | Complete Day card + 3-step modal | MISSING | Visible when today's sales > 0. Confirm → summary → success, then archives the day | Absent. Production equivalent is `/end-of-day` with the real `closeDay` |
| 24 | TrialBanner | MISSING | Trial/plan status strip below the hero | Stub — **B4** |

### Today's Active Staff

| # | Element | Status | Prototype behaviour | Current app |
|---:|---|---|---|---|
| 25 | Section header + `See All` | DONE | Header, See All → Staff | Header, View All → `/staff/management` |
| 26 | Staff cards (name, sales, bills) | **WRONG** | Only staff who actually **sold today**, totals over **all** their sales | `getStaffPerformance(...,'today')` sums `CASE WHEN payment_type='cash'` only — **credit and split sales are silently dropped from staff totals and bill counts** — and its `LEFT JOIN` returns every active staff member, so zero-sale staff appear under an "active staff" heading |
| 27 | Initials avatar | MISSING | 2-letter initials chip | Absent — **Phase C** |
| 28 | Empty state | DONE | `No staff sales today` | `noTransactions` copy in a white card |

### Recent Activity

| # | Element | Status | Prototype behaviour | Current app |
|---:|---|---|---|---|
| 29 | Section + `View All` | MISSING | Header + View All → Sales History | Absent |
| 30 | Last 3 sale line items | MISSING | Newest 3 **line items** (duplicates allowed): medicine name, `Quantity: N unit`, relative time (`just now`, `N mins ago`, `N hours ago`, `N days ago`) | Absent |
| 31 | Recent Activity empty state | MISSING | `No recent activity` | Absent |

### States and lifecycle

| # | Element | Status | Prototype behaviour | Current app |
|---:|---|---|---|---|
| 32 | Loading state | MISSING | Synchronous localStorage, so none needed | None. First paint shows an empty shell; `staff-home` already has `DashboardLoadState` and the owner screen does not use it |
| 33 | Error / retry state | MISSING | n/a | **`reload()` has no try/catch and is called as `void reload()`.** A throw from `getStaffPerformance`/`getShopName` becomes an unhandled rejection with no UI, no retry |
| 34 | Refresh triggers | PARTIAL | Focus + visibility + cross-tab storage + 10 s poll | `useFocusEffect` only. Adequate for RN, but nothing refreshes after a background sync pull applies rows |
| 35 | Day rollover → previous-day summary | MISSING | `checkDayRollover()` compares last-seen day key; on rollover shows yesterday's summary **and** the opening-cash sheet, marks today seen, schedules the cash notification, runs the daily alert scan | No rollover detection anywhere |
| 36 | Opening-cash first-run prompt | MISSING | `OpeningCashModal` with 4 quick chips, manual amount, Save, Cancel; dismissable only once today's cash is set | Opening cash exists **only** as a text field inside `/cash-summary`. The owner is never prompted, so expected cash silently starts from 0 |
| 37 | Non-owner access | **WRONG** | Redirects to `/app/staff-home` when not owner and lacking `reports` | `if (!session || session.role !== 'owner') return null` — renders a **blank screen inside the nav shell** instead of `AccessDenied` or a redirect |

### Navigation

| # | Element | Status | Prototype behaviour | Current app |
|---:|---|---|---|---|
| 38 | Bottom navigation | DONE | Home / Sale / Scan / Inventory / More | `AppNavigationShell`, permission-locked, role-aware home |
| 39 | Elevated centre Scan | DONE | Raised circular scan action | Raised green circle → `/scan`, gated on `sale_entry` |
| 40 | Content clears the bottom bar | DONE | `pb-24` | `pb-28` |
| 41 | `New Sale` primary button | EXTRA | **Not in the prototype dashboard** — sale is reached via bottom nav | Present, and it currently occupies the vertical space the KPI carousel belongs in |

---

## WHY THE CURRENT DASHBOARD FEELS SPARSE

Component-by-component, the prototype renders **7 vertical regions** and the current app renders **4** — and the three missing regions are the ones carrying every number.

| Prototype region | Elements it contributes | Present in app |
|---|---:|---|
| Header | 5 controls | 4 (no brand) |
| Hero: greeting + date + badges | 4 | 1 (wrong subject) |
| KPI carousel | 5 money cards | **0** |
| Alerts stack | 5 cards (expiry, stock, credit, history, complete day) + trial banner | **0** |
| Active staff | strip + header + empty state | 3 (with wrong totals) |
| Recent Activity | section + 3 rows + empty state | **0** |
| Bottom nav / Scan | 5 targets | 5 |

Concretely:

1. **Every money number is gone.** The prototype puts 5 money cards above the fold — today's sales, expected cash, yesterday, outstanding credit, supplier payable. The app shows **zero** currency values on the owner home. The owner's first screen answers none of the five questions the screen exists to answer.
2. **The whole alert layer is gone.** Expiry, low stock, dues, sales-history, and complete-day are five always-visible cards in the prototype — roughly 60% of its scroll length. The app renders nothing between the greeting and the staff strip.
3. **Recent Activity is gone.** The last visual proof that the shop is transacting.
4. **What remains is one CTA plus one strip.** After the greeting the app shows a `New Sale` button (which the prototype does not even have on this screen) and a staff strip. Two blocks where the prototype has thirteen.
5. **The greeting greets the wrong entity.** `Good morning` / shop name / `Owner` reads like a splash screen, not a dashboard, because there is no date and no data under it.
6. **The hero has no depth.** Prototype: green hero `pb-20` with the carousel inside, then the alerts pulled up `-mt-16` to overlap. The app has a flat `gap-5 p-4` column, so nothing anchors the top of the screen.
7. **It is 57 lines of JSX against 1337.** The current screen is a B1 navigation placeholder that was never intended to carry dashboard data — that is the actual root cause, not a styling deficit.

---

## MISSING FUNCTIONALITY

Ordered by owner impact. Every item is functional, none is styling.

1. Today's sales total (+ live indicator) — no today figure exists on the dashboard.
2. Expected cash in drawer card + `Details` route into `/cash-summary` + inline "set opening cash" affordance.
3. Opening-cash prompt on first open of a business date, and the `OpeningCashModal` component itself (quick chips + manual amount + save/cancel).
4. Day-rollover detection (last-seen business date) and the automatic previous-day summary that follows it.
5. Yesterday's sales card and `PreviousDaySummaryModal` (total, cash, credit, transactions, avg sale, top 3 items, trend vs day-before).
6. Outstanding credit card: total + distinct customer count.
7. Dues/credit alert card: headline count, total, overdue count.
8. Supplier payable card: total + supplier count, tap → suppliers.
9. Expiry Alert card: top rows, `+N more`, empty state, `View Details`, tap-through.
10. Low Stock Alert card: top rows, `+N more`, empty state, `View List (N)`, tap-through.
11. Sales History quick card.
12. Complete Day entry point on the dashboard (routing into the existing `/end-of-day`) with a today-has-sales condition and a sales/transactions preview.
13. Recent Activity: last 3 sale line items with relative timestamps, `View All`, empty state.
14. Localised date line under the greeting.
15. Dashboard loading state, error state, and retry (reuse `DashboardLoadState`).
16. Per-section empty states (no sales yet, no alerts, no dues, no payables, no staff, no activity) for a fresh shop with no seed data.
17. Sync feedback: last-synced timestamp and a visible failure state.
18. A reusable logout/lock confirmation with owner-correct copy.
19. Refresh after a sync pull applies rows (not only on screen focus).
20. Accessibility labels on every new card/tap target (`accessibilityRole`, `accessibilityLabel`) — icon-only and number-only tiles currently announce nothing.

Deferred by prior decision, listed so they are not re-discovered: PlanBadge, TrialBanner, shop pill + ShopSwitcherSheet (**B4**); quick-link icons, initials avatars, brand wordmark, final type/spacing (**Phase C**).

---

## WRONG BEHAVIOR

Four defects that exist in code today. Items 1 and 2 are money-correctness bugs and should be fixed before any new dashboard card is written.

1. **Staff sales totals silently exclude credit sales.**
   `db/staffDashboard.ts:124-126` — `getStaffPerformance` computes `sales`, `transactionCount`, and `averageBill` with `CASE WHEN s.payment_type = 'cash'`. Credit, split, and free sales are counted as zero. The dashboard strip, and any other consumer of this function, understates staff performance. `getStaffDashboard` (staff's own screen, line 61) has no such filter, so the same staff member sees a different number on their own home than the owner sees for them.
2. **The "active staff" strip is not an active-staff list.**
   Same function uses `LEFT JOIN sales`, so every active staff/manager row is returned with `sales = 0` whenever they did not sell. Under the heading "Today's Active Staff" that presents idle staff as active. The prototype's `getStaffPerformanceToday` returns only sellers.
3. **Non-owner access renders a blank screen.**
   `app/(tabs)/dashboard.tsx:41` — `return null` inside the navigation shell. Should redirect to `authenticatedHome(session)` or render `AccessDenied`, matching `staff-home.tsx:138`.
4. **Dashboard load failures are invisible and unhandled.**
   `app/(tabs)/dashboard.tsx:40` — `useFocusEffect(... void reload())` with no `try/catch` inside `reload`. A throw from `getStaffPerformance` (`"Not authorized"`) or `getShopName` produces an unhandled promise rejection, an empty strip, and no retry path.

Adjacent, lower severity:

5. Greeting hour bands differ from the prototype (`<20` vs `17–19`), and the greeting is addressed to the shop rather than the user (element 9).
6. Unread badge threshold is off by one relative to its own intent: `unread > 10 ? '10+'`, so exactly 10 renders `10`.

---

## DATA ALREADY AVAILABLE

Everything below already exists, is SQLite-only, permission-gated, paisa-safe, and needs **no** new query. This is most of the dashboard.

| Dashboard need | Existing production read | Gate |
|---|---|---|
| Expected cash + the fixed 7-term breakdown | `getCashSummary(shopId, actorUserId, businessDate)` → `expectedCash()` (`domain/cashFormula.ts`) | `cash_management` |
| Opening cash value, and whether a drawer row exists today | `getCashSummarySync().openingCash`, `hasCashDrawerForDate(shopId, businessDate)` | — / internal |
| Set opening cash (write) | `setOpeningCash({ shopId, staffId, isStillActive, businessDate, openingCash })` — already rule-5 safe, session-guarded, outbox-recorded | `cash_management` |
| Local business date, midnight reset | `currentBusinessDate()` | — |
| Today's total sales, cash/credit split, COGS, gross profit, expenses, new credit given, credit collected, counted cash, variance, `isClosed`, opened/closed by | `getEndOfDaySummary(shopId, actorUserId, businessDate)` | `cash_management` |
| Yesterday's and day-before-yesterday's same figures (for the yesterday card, its modal, and the trend %) | the same `getEndOfDaySummary`, called with any `businessDate` | `cash_management` |
| Closing the day | `closeDay(...)` via the existing `/end-of-day` screen | `cash_management` |
| Expiry list, nearest real expiry first, `daysUntilExpiry` + band recomputed at read time from the real date, shop-safe join | `listBatchesByExpiry(shopId, now)` (`db/inventory.ts:489`) | ungated today |
| Low-stock candidates: `sellableStock`, effective `threshold` (override → shop fallback) | `listMedicines(shopId)` (`db/inventory.ts:67`) | ungated today |
| Expiry Near/Far bands and low-stock fallback | `shop_b2_settings` (`low_stock_default`, `expiry_near_days`, `expiry_far_days`) | — |
| Outstanding credit per customer | `listCustomersWithBalance(shopId, actorUserId)` | `credit_view` |
| Supplier payables per supplier | `listSuppliers(shopId, actorUserId)` | owner |
| Sales history rows for `View All` and for a receipt list | `listSalesHistory(shopId, actorUserId, filter)`, `getSaleDetail(...)` | `sale_history` |
| Staff performance today | `getStaffPerformance(shopId, actorUserId, 'today')` — **after the two fixes above** | `staff_manage` / `reports` / owner |
| Unread notification count | `getUnreadCount` via `useUnreadCount` | scoped to shop+user |
| Shop name | `getShopName(shopId)` | — |
| Manual sync | `triggerSyncNow(shopId)` | — |
| Loading/error/retry shell | `components/staff/DashboardLoadState.tsx` | — |
| Denied-access shell | `components/ui/AccessDenied.tsx` | — |
| Session-handover safety for every read/write | `captureSessionFor` / `guard.isStale()` / `assertSessionLive` | — |
| Money and count formatting | `formatMoney` (paisa → `font-mono` DM Mono), `useI18n().formatNumber` (`font-sans`) | rule 6 |

Two consequences worth stating plainly:

- **Card 1, Card 2, Card 3, the yesterday modal, and the Complete Day preview are all derivable from `getEndOfDaySummary` + `getCashSummary`, which already exist and are already tested.** Only a transaction count and a top-items list are missing from them.
- **Nothing on this dashboard requires touching Supabase from a screen.** All of it is offline-first by construction.

---

## NEW READ MODELS NEEDED

One new module: `apps/mobile/db/ownerDashboard.ts`. It follows the `getManagerDashboard` shape — owner-gated at the top, then each section still goes through its own permission-gated read, so a later Manager reuse cannot leak.

| # | New read model | Why it is needed | Notes |
|---:|---|---|---|
| 1 | `getOwnerDashboard(shopId, actorUserId): OwnerDashboardData` | One composite call per focus instead of 8 round-trips; a single stale-session guard point | Owner-gated. Returns: `today`, `cash`, `yesterday`, `credit`, `supplierPayable`, `expiry`, `lowStock`, `activeStaff`, `recentActivity` |
| 2 | `getDaySummary(shopId, actorUserId, businessDate): DaySummary` | Powers the Today card, the Yesterday card, the previous-day modal, and the Complete Day preview from one definition | Wraps `getEndOfDaySummary` and adds `transactionCount`, `averageSale`, `topItems[3]`, and `trendVsPreviousDay` |
| 3 | `getDayTransactionCount(shopId, businessDate)` | `EndOfDaySummary` has every amount but no count; avg sale needs it | Internal to #2. Excludes `is_deleted`; drafts are already a separate table |
| 4 | `getDayTopItems(shopId, businessDate, limit=3)` | Prototype's yesterday modal "Top Sold" | `sale_items` JOIN `medicines`, `SUM(quantity)` desc |
| 5 | `getRecentSaleLines(shopId, actorUserId, limit=3)` | Recent Activity needs **line items**, not sale headers; `listSalesHistory` returns headers only | Gate `sale_history`. Reuse the `group_concat` join style already in `staffDashboard.ts`. Returns medicine name, quantity, unit, `createdAt` |
| 6 | `getLowStockSummary(shopId, limit=3)` | `listMedicines` loads every medicine **and every batch** for the shop on every dashboard focus | Return `{ total, top: [...] }` via `COUNT` + top-N SQL. Extend the `getManagerDashboard` low-stock SQL with the B2 expired-stock exclusion so "sellable" means the same thing everywhere |
| 7 | `getExpirySummary(shopId, limit=3)` | Same reason — `listBatchesByExpiry` maps the whole shop's batches in JS | `{ total, top: [...] }`, bands from `shop_b2_settings`, days recomputed from the real `expiry_date` (rule 3) |
| 8 | `getCreditSummary(shopId, actorUserId)` | `listCustomersWithBalance` is `LIMIT 50` and returns rows, not aggregates — it cannot produce a correct shop total | `credit_view`. `SUM(balance) WHERE balance > 0`, `COUNT(DISTINCT customer_id)`, plus `overdueCount` (see decision 2) |
| 9 | `getSupplierPayableSummary(shopId, actorUserId)` | Avoid loading the full supplier list to render two numbers | Owner-gated. `SUM(total - paid_amount)` and count of suppliers with payable > 0 |
| 10 | `getStaffPerformance` **fix** (existing function) | Defects 1 and 2 in WRONG BEHAVIOR | Drop the `payment_type='cash'` filter; add an explicit `soldOnly` option so the dashboard strip shows sellers while Staff Management keeps the full roster |
| 11 | `hasSeenBusinessDate` / `markBusinessDateSeen` | Day-rollover detection | Local device state (MMKV), **not** synced — it is a per-device UI memory, not shop data. Compared against `currentBusinessDate()` |

New UI components (no data of their own): `OpeningCashModal`, `PreviousDaySummaryModal`, `KpiCard`, `AlertCard`.

### Schema / settings impact

- **One additive column**, only if overdue dues are in scope: `shop_b2_settings.credit_max_days` (default 7), mirrored in a new PostgreSQL migration, added to the sync allowlist. Overdue is then derived as `credits.created_at + credit_max_days < today AND balance > 0`. There is no due-date column on `credits` today, and `phase-b1-navigation-roles.md` already assigns "Credit Period and Overdue Credit generator" to B3.
- **No other schema change.** Every other number is available from existing tables.
- Every new FK: none introduced. Every new read: same-shop filtered, `is_deleted = 0`, local-midnight day boundary via `date(created_at,'localtime')`.

### i18n

~35 new `catalog.ts` keys in **both** `en` and `bn` (parity is compile-time enforced): `todaysSalesLive`, `expectedInDrawer`, `details`, `setOpeningCash`, `openingCashQuestion`, `yesterdaysSale`, `tapToView`, `outstandingCredit`, `people`, `supplierPayable`, `suppliersCount`, `expiryAlert`, `noExpiryAlerts`, `viewDetails`, `lowStockAlert`, `stockIsGood`, `viewList`, `andMore`, `days`, `peopleHaveCredit`, `noCredit`, `overdue`, `allPaymentsComplete`, `readyToClose`, `completeDay`, `recentActivity`, `noRecentActivity`, `quantity`, `justNow`, `minsAgo`, `hoursAgo`, `daysAgoRelative`, `topSold`, `avgSale`, `noSalesThatDay`.

---

## IMPLEMENTATION ORDER

Each numbered step is a reviewable slice. Steps 4–5 touch money/DB and require the CLAUDE.md rule 10 approval that this document is requesting.

0. **Approve this plan** (rule 10: anything touching database, sync, or money). Log the resolved decisions in `DECISIONS.md` as the first change.
1. **Pure/domain tests first, no UI.** Greeting hour bands, relative-time formatting, `+N more` counting against a true total, trend-percent maths, overdue-age derivation, avg-sale integer-paisa division. No DB, no React.
2. **Fix `getStaffPerformance`** (drop the cash-only filter, add `soldOnly`) with SQLite tests covering cash/credit/split/free attribution and zero-sale staff. This is a live money-display bug and ships independently of any new card.
3. **Repair the existing screen's states** with no new data: `AccessDenied`/redirect instead of `return null`, `try/catch` in `reload`, `DashboardLoadState` for loading and error+retry. Removes the blank screen and the unhandled rejection.
4. **Build `db/ownerDashboard.ts`** (read models 1–9, 11) with SQLite integration tests: shop isolation, local-midnight boundaries, soft-deleted and held/cancelled exclusion, empty fresh shop, permission denial per section, and a large-shop row count for the two top-N queries.
5. **Settings:** add `credit_max_days` locally (SQLite + PostgreSQL migration file + sync allowlist + tests) **or** drop the overdue line per decision 2. Local migration files only — no remote push.
6. **Header + hero:** sync last-synced state and failure surface, owner-correct logout confirmation, greeting fix (bands + subject), localised date line.
7. **KPI carousel:** the 5 cards on real reads, horizontally scrollable, each with its own empty/zero state and tap target.
8. **Opening cash:** `OpeningCashModal` component (chips + manual + save/cancel) wired to `setOpeningCash`, plus the day-seen device memory and the first-open-of-the-day prompt.
9. **Previous day:** `PreviousDaySummaryModal` on `getDaySummary`, reachable both from the yesterday card and automatically on rollover.
10. **Alerts stack:** expiry, low stock, credit/dues, sales history cards with their tap-throughs, `+N more` counts, and empty copy.
11. **Complete Day card** → routes into the existing `/end-of-day`. Do not reimplement close logic on the dashboard.
12. **Active staff strip** on the fixed read, and **Recent Activity** on `getRecentSaleLines`.
13. **i18n keys, per-section empty states, accessibility labels**, and refresh-after-sync-pull.
14. **Verification gate:** `tsc --noEmit`, lint, unit + SQLite suites green; physical Android run; owner / staff / manager access matrix; fresh shop with zero data shows every empty state and no crash; a shop with >1000 medicines renders within budget; offline airplane-mode run; two-device handover mid-load.

Explicitly out of this plan: PlanBadge, TrialBanner, shop switcher, multi-shop (B4); prototype `localStorage`, floating-point money, the 10-second poll, the fake `archiveDailyData` day-archive, and the prototype's stored expiry day-count (rule 3) — all superseded.

---

## OPEN DECISIONS

These change the work. Recommendations given.

1. **Expiry/Stock alert row count.** Your brief says max 3. The prototype code renders `slice(0, 2)` from a list already capped at 5, so its `+N more` can never exceed `+3` even when 40 batches are expiring. **Recommend: render 3 rows and compute `+N more` from the true total count**, superseding the prototype's cap.
2. **Overdue dues.** Requires the new `credit_max_days` setting and a schema addition. **Recommend: add it** (7-day default, consistent with `max_refund_days`). If deferred, the credit card ships without the overdue line and nothing else changes.
3. **Expected-cash card subtitle.** The prototype shows `Open + Sales − Exp`, which is 3 of the fixed 7 terms and will disagree with `/cash-summary` whenever refunds, collections, supplier payments, or withdrawals are non-zero. **Recommend: show the expected total plus `Details ›` only**, and keep the full breakdown on the cash summary screen. Rule 4 forbids a second, partial formula in the UI.
4. **Complete Day.** **Recommend: the dashboard card routes to the existing `/end-of-day`** rather than duplicating the prototype's 3-step modal, whose success step writes a fake archive.
5. **`New Sale` button.** Not in the prototype dashboard. **Recommend: keep it, moved below the KPI carousel** — it is a real improvement, it just must not sit where the money cards go.

---

## READY FOR IMPLEMENTATION: NO

Blocked on:

- Founder approval of this plan under CLAUDE.md rule 10 (the dashboard reads money, cash, and credit, and step 5 adds a synced column).
- Decisions 1–5 above, specifically decision 2, which is the only one with a schema consequence.

Everything else is ready: the prototype behaviour is fully enumerated, the production reads that cover most of it already exist and are tested, only one additive column is required, and the implementation order is sliced so the two money-correctness defects (staff totals, blank/unhandled dashboard states) can ship before any new surface is built.

Flip to YES once decisions 1–5 are answered and local implementation is approved. Remote migration push, deployment, and commit remain separately gated.
