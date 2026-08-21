# Phase B1 — Prototype-Exact Navigation, Roles, Permissions, Settings, and Notifications

Date: 2026-08-21  
Mode: plan only; no production implementation.  
Product source: latest runtime prototype under `apps/prototype-web/Muthoy (prototype)/src/app`.  
Correctness source: current mobile SQLite/auth/sync/domain/native code, PostgreSQL migrations/RLS, repository rules, and Volume 12 V3.

The prototype defines WHAT B1 must show and do. Production architecture defines HOW it is made offline-safe, shop-isolated, permission-enforced, and sync-safe. Web/localStorage implementation details are not copied.

## B1 prototype coverage

| Prototype surface | Exact B1 product contract |
|---|---|
| Owner landing | Owner routes to the production equivalent of prototype `MorningDashboard`, never `StaffHome`. B1 supplies its exact role routing, header controls, navigation shell, Quick Links destinations, notification entry, language control, and logout/lock behavior. Completion of its business widgets is phase-assigned below. |
| Cashier/Staff landing | `StaffHome` Cashier branch with own shift context, own three metrics, own five recent transactions, exact actions, notification/language controls, and End Shift. |
| Manager landing | The `ManagerDashboard` branch selected inside `StaffHome` when persisted role is Manager. It is not the Owner dashboard and is not a generic Staff screen with hidden Owner buttons. |
| Role model | Persist and recognize `owner | manager | staff`; production `staff` is displayed as prototype Cashier/Staff. Unknown roles fail closed. |
| Permissions | Exact 12-key prototype matrix, exact Cashier/Manager/Custom presets, per-user overrides, permission-aware routes/actions, and matching SQLite/sync/RLS enforcement. |
| Staff management | Prototype List, Today, Permissions tabs; Add Staff; detail sheet; today/week/all-time stats; grouped permission controls; reset PIN; activate/deactivate; remove/archive. Founder security boundaries apply. |
| Main navigation | Exact prototype Owner/Cashier/Manager bottom-nav slot behavior, elevated center Scan, More panel contents, Owner Quick Links sidebar, and explicit direct-route guards. |
| Scan | Dedicated `/scan` destination reusing production camera/OCR/search/cart/FEFO behavior. Center Scan remains visually present. It cannot bypass `sale_entry`. |
| Language | Global Bangla/English control with Bangla default, `বাং` / `ENG` choices, persistence, translated current production surfaces, and localized non-money numbers/dates/times. |
| Notification Center | Exact inbox categories, unread behavior, mark one/all read, grouped relative dates, action navigation, per-item dismissal, empty/error/loading states, and per-user state. |
| Settings | Exact B1 subset of the visible prototype Settings rows/modals. Every other visible Settings item is assigned to B2/B3/B4/security below. |

## Exact role-to-dashboard mapping

| Persisted production role | Prototype product branch | Root destination |
|---|---|---|
| `owner` | `MorningDashboard` | Owner dashboard route |
| `staff` | Cashier branch of `StaffHome` | Staff Home route |
| `manager` | `ManagerDashboard` rendered by `StaffHome` | Staff Home route, then Manager branch |
| unknown/missing/deactivated | No prototype dashboard | Fail closed to auth/access-denied flow |

Root routing, direct deep links, session restoration, fresh-device login, enrolled offline login, and Switch User must all use this mapping. A Manager never reaches `MorningDashboard`; an Owner never reaches `StaffHome`.

## Exact Cashier/Staff Home

### Header and shift context

- Welcome/greeting by time of day, signed-in staff name, Cashier/role badge, and persisted “Shift started HH:MM”.
- Notification button and global `বাং` / `ENG` toggle.
- Shift start means the current authenticated local session. Persist `startedAt` in the session snapshot; do not add a financial shifts table in B1.

### Metrics

All values are scoped by both `shop_id` and current seller/user ID, for the current Asia/Dhaka business day:

1. Today’s Sales — own completed/non-cancelled/non-held sales total in integer paisa.
2. Transactions — own qualifying transaction count.
3. Avg. Bill — own sales total divided by own transaction count, using the existing money formatting boundary.

### Actions

- New Sale: full-width primary action; visible only with `sale_entry`.
- Scan: routes to the dedicated Scan surface; center/global Scan permission rule below applies.
- Cash Drawer: shown in the prototype action grid but locked/denied without `cash_drawer`.
- Quick Access list, in prototype order and filtered by exact permission:
  1. Sales History — `sale_history`.
  2. Credit Sales — `credit_view`.
  3. Inventory — `inventory_view`.
  4. Report — `reports`.

### Recent activity

- “Today’s Transactions”: latest five own qualifying transactions, newest first.
- Each row shows up to two medicine names, time, payment method, and total.
- Empty state: first-sale prompt.
- No store-wide or other-staff activity appears in the Cashier branch.

### End Shift

- Prominent End Shift action opens the prototype Shift Summary bottom sheet.
- Sheet shows staff name, shift start, own Sales, Transactions, Avg., and the latest five own transaction time/total rows.
- Cancel closes the sheet.
- Logout continues to the existing confirmation, then production `switchUser()` clears the active session/cart and returns through the root gate while retaining device/shop enrollment and durable outbox data.

## Exact Manager Dashboard branch

Manager uses the same session/shift header pattern as Staff Home, with Manager badge, notification button, and language toggle.

### Store status

Priority matches the prototype:

1. expiry alert count and route;
2. otherwise low-stock count and route;
3. otherwise “All good”.

The alert is shown only when its underlying permission allows the data and destination: `expiry_manage` for expiry; `inventory_view` for low stock.

### Store Overview Today

| Prototype metric | Exact value | Required permission |
|---|---|---|
| Total Sales | Store-wide qualifying sales total for today | `reports` |
| transactions | Store-wide qualifying transaction count for today | `reports` |
| Cash Drawer | Existing fixed expected-cash result; opening-cash edit affordance | `cash_drawer` |
| Credit Due | Total current outstanding balance | `credit_view` |
| customers | Count with positive outstanding balance | `credit_view` |
| Staff Active | Staff who logged in today, excluding signed-in Manager | `staff_manage` |

The prototype Manager preset grants all of these except `staff_manage`. A Custom Manager without a permission must not receive its protected query result; unavailable cells/sections are omitted rather than filled with leaked or fake zero values.

### Manager actions and activity

- New Sale — `sale_entry`.
- A Manager with `cash_drawer` gets the existing opening-cash prompt on first eligible open when today has no opening value; opening cash defaults to 0 and never inherits yesterday.
- Expiry alert card with count, “within 30 days”, and View action — `expiry_manage`.
- Low-stock card with count and Order action — `inventory_view`.
- Staff Sales Today strip — `reports`; active staff cards show first name, sales total, and bill count. “View all” to Staff Management additionally requires `staff_manage`.
- Quick Access, exact order:
  1. Inventory — `inventory_view`.
  2. Credit Sales — `credit_view`.
  3. Sales History — `sale_history`.
  4. Day Summary — `cash_drawer`.
- Recent Transactions — latest eight store-wide qualifying transactions, newest first; each shows up to two medicine names, time, seller first name, total, and Cash/Credit badge. Requires `reports`; View All additionally requires `sale_history`.
- Empty states match the prototype meaning: no staff sales yet; start first sale of day.

### Manager End Shift

- End Shift opens the same bottom-sheet/confirmation sequence.
- Sheet shows shift start and the Manager prototype’s store Sales, Transactions, and Cash cells, each subject to `reports`/`cash_drawer` as above.
- Confirm uses production `switchUser()`; it does not close the financial day or mutate cash records.

## Exact 12-permission contract

### Prototype-to-production mapping

| Prototype key | Prototype label | Production key/enforcement |
|---|---|---|
| `sale_entry` | Process Sales | Existing `sales` |
| `sale_discount` | Apply Discounts | New key; B1 establishes contract, B2 consumes it |
| `sale_return` | Process Returns | New key; B1 establishes contract, B2 consumes it |
| `sale_history` | View Sales History | New key; B2 destination consumes it |
| `inventory_view` | View Stock | Existing `inventory_view` |
| `inventory_edit` | Update Stock | Existing `inventory_write` |
| `expiry_manage` | Manage Expiry | New key; B2 actions consume it |
| `credit_view` | View Credit | New read key; B3 completes destination |
| `credit_manage` | Manage Credit | Existing `credit_management` mutation key |
| `cash_drawer` | Cash Drawer | Existing `cash_management` |
| `reports` | View Reports | New key; B3 destinations consume it |
| `staff_manage` | Manage Staff | Existing `staff_management`, with Founder security sub-guards |

Production storage keys remain stable where mapped above. UI labels may use prototype names; migrations must not rewrite valid existing overrides unnecessarily.

### Exact groups and presets

| Group | Permissions |
|---|---|
| Sales | `sale_entry`, `sale_discount`, `sale_return`, `sale_history` |
| Inventory | `inventory_view`, `inventory_edit`, `expiry_manage` |
| Credit & Cash | `credit_view`, `credit_manage`, `cash_drawer` |
| Management | `reports`, `staff_manage` |

Cashier preset:

- ON: `sale_entry`, `inventory_view`.
- OFF: the other ten permissions.

Manager preset:

- ON: all permissions except `staff_manage`.
- OFF: `staff_manage`; Owner may grant it explicitly.

Custom preset:

- Starts with all twelve OFF.
- Any manual permission or group toggle selects Custom.

New Add Staff state must actually initialize to the displayed Cashier preset. This corrects the prototype code inconsistency where the Cashier button appears selected while the in-memory permission object starts all false.

### Enforcement

- Owner has all operational permissions as a rule; per-user override rows never lock out Owner.
- Manager and Staff resolve role preset then individual overrides.
- Only Owner changes roles, grants/revokes permissions, or creates/promotes a Manager.
- Every protected route is guarded, but hiding/locking navigation is never the enforcement boundary.
- SQLite reads/writes validate actor, active session epoch, role, permission, and `shop_id` before data access or side effects.
- Sync authorization, auth claims/version invalidation, Edge device login, PostgREST/RLS, and direct DB calls enforce the same keys.
- Unknown roles/keys deny. No screen reads Supabase directly.

## Exact Staff Management flows

### Screen and tabs

- Access route requires `staff_manage`; mutation sub-guards below still apply.
- Header with refresh/sync action.
- Summary: Total Staff and Active counts.
- Three exact tabs:
  1. List.
  2. Today / Today’s Performance.
  3. Permissions.

### List and Add Staff

- List rows show initials, name, Active/Off status, role, phone, and open the detail sheet.
- Empty state and Add New Staff action.
- Add flow has the prototype’s three steps:
  1. Name, normalized unique phone, Cashier/Manager role.
  2. Four-digit PIN and confirmation.
  3. Cashier/Manager/Custom preset plus four grouped permission cards, group enable/disable, and individual toggles.
- Owner may choose Cashier or Manager and any preset/custom matrix.
- Manager with `staff_manage` may add Cashier only, using the Cashier preset. Manager cannot create/promote Manager or customize permissions because those are role/permission escalation.
- Production keeps bcrypt hashing, native PIN lookup tag, PIN uniqueness, transaction/outbox/audit behavior, and no plaintext storage/logging.

### Today performance

- Rows sorted by the prototype performance query.
- Cash sales only, as labelled by the prototype.
- Each row: staff identity, top-performer badge on first row, total sales, bill count, average sale.
- Tapping opens detail.

### Permissions tab

- Owner only; a Manager with `staff_manage` does not receive permission-edit controls.
- Expand each staff member, then show the exact four groups/twelve toggles.
- Group “Enable All/Disable All” and individual toggles update the same per-user override model and increment permission version/revoke stale claims.

### Detail sheet

- Identity header and Today / This Week / All Time tabs.
- Exact stats: Sales, Bills, Avg. for that staff member and date range.
- Owner sees grouped permission editing, Reset PIN, Activate/Deactivate, and Remove Staff.
- Manager with `staff_manage` sees roster/performance/detail facts only plus Add Cashier; no role, permission, recovery/PIN, activation, deactivation, or removal controls.
- Reset PIN uses the prototype two-step new/confirm keypad, mismatch and duplicate handling, progress, success/error, bcrypt, audit, and immediate stale-session invalidation.
- Deactivate blocks login and current/stale writes. Activate restores eligibility without restoring a revoked session.
- Remove Staff is implemented as confirmed production-safe soft removal/archive with auth invalidation and retained attributed history; never prototype hard deletion.

## Exact Owner navigation

Owner lands on `MorningDashboard` and keeps its distinct header.

Header actions in B1:

- menu opens Quick Links sidebar;
- sync trigger uses existing production sync and never blocks navigation;
- notification bell with localized unread badge capped visually at `10+`;
- global `বাং` / `ENG` toggle.

Quick Links sidebar order is exact:

1. Sale Entry.
2. Inventory.
3. Credit Sales.
4. Expense Tracking.
5. Sales History.
6. Expiry Management.
7. Supplier Invoices.
8. Suppliers.
9. Report.
10. Staff Management.
11. Staff Sales & Audit Log.
12. Data Export.
13. Printer.
14. Settings.
15. Plans & Upgrade.
16. Logout/Lock action after the links.

Sidebar closes on backdrop press and destination selection. Destination functionality follows the phase ledger below.

B1 also wires the prototype Owner active-staff-today strip from the shared staff performance read model: shop-scoped staff identity, sales, and bill count.

## Exact bottom navigation and More panel

### Bottom slots

- Five slots with the elevated Scan fixed in the center (column 3).
- Owner when More is present: Dashboard/Home in column 1, Sale in 2, Inventory in 4, More in 5.
- Default Cashier has no eligible More tiles: Staff Home in 1, Sale in 2, Inventory in 4, locked Credit Sales in 5.
- Manager preset has More tiles: Staff Home in 1, Sale in 2, Inventory in 4, More in 5. Credit remains available from Manager Dashboard Quick Access.
- For custom staff/manager access, primary tabs retain the prototype locked state rather than silently disappearing. When More is present, only Home/Sale/Inventory occupy non-center primary slots; Credit falls out of the bar exactly as in the prototype.
- Locked primary tab press shows localized access denied and stays on the current role home.
- Active destination and More-group state are reflected functionally; final animation/styling parity is Phase C.

### Elevated Scan

- Always rendered in the center as the prototype’s prominent global affordance.
- The current prototype special-cases `/app/scan` as globally allowed even though the screen adds to cart and proceeds to checkout. Production resolves that internal contradiction by requiring `sale_entry` before entering or mutating the sale scanner. Without it, press returns localized access denied; no cart/DB mutation occurs.
- With `sale_entry`, `/scan` reuses current native camera/OCR, normalized exact match, SQLite sale search, FEFO batch/price selection, repeated scan quantity increments, cart counter, Done handoff, manual-search handoff, permission/error/retry/no-result states, and existing cart.
- No invented lookup-only scanner mode is part of B1.

### More tiles

Exact prototype order:

| Tile | Access | Target phase for destination completion |
|---|---|---|
| Sales History | `sale_history` | B2 |
| Expiry | `expiry_manage` | B2 |
| Cash Drawer | `cash_drawer` | B3 |
| End of Day | `cash_drawer` | B3 |
| Report | `reports` | B3 |
| Expense | Owner only | B3 |
| Supplier Invoices | Owner only | B3 |
| Suppliers | Owner only | B3 |
| Staff | `staff_manage` | B1 |
| Staff Sales | Owner only | B3 |
| Multi-Shop | Owner only and only when multiple shops exist | B4 |

- Owner sees every applicable tile.
- Manager/Staff see permission-bearing tiles they hold; Owner-only tiles are hidden.
- More button exists only when at least one tile is visible.
- Panel closes on backdrop, destination selection, route change, Android Back, Switch User, or session invalidation.
- Ordinary navigation never clears an unfinished cart.

## Exact direct-route guards

| Route/surface | B1 guard |
|---|---|
| Owner Dashboard | Owner only |
| Staff Home / Manager branch | Staff or Manager only |
| Sale, Cart, Checkout, confirmation, dedicated Scan sale flow | `sale_entry` |
| Inventory | `inventory_view` |
| Add Medicine / inventory writes | `inventory_edit` |
| Expiry | `expiry_manage` |
| Credit list/detail read | `credit_view` |
| Credit sale/collection mutation | `credit_manage` |
| Cash Summary / End of Day | `cash_drawer` |
| Report / Monthly Report | `reports` |
| Sales History | `sale_history` |
| Staff Management | `staff_manage`, plus Owner-only security/escalation sub-actions |
| Expense, Supplier Invoices, Suppliers, Staff Sales, Data Export | Owner only, matching prototype navigation |
| Settings | Owner only in B1 |
| Plans/Payment | Owner only; destination work B4 |
| Printer | Owner only; destination work B3 |
| Multi-Shop | Owner only; destination work B4 |
| Notification Center | Any live authenticated user; sensitive items filtered |

Nested/detail routes inherit the parent capability. Denied deep links return AccessDenied or the correct role home and perform no protected read/write.

## Global Bangla / English

- One production locale state: `bn | en`, Bangla default.
- Persist locally across restart and user handover; language is device UI preference, not shop business data.
- Exact two-choice control labels: `বাং` and `ENG`; include it in Owner, Cashier, Manager headers and Settings.
- Translate all user-visible copy in every currently implemented mobile route/shared component, including errors, empty/loading states, sheets, modals, access denial, notifications, and navigation labels. Deferred screens must ship both languages in their assigned phase.
- Localize non-money digits, dates, relative dates, and times. Keep integer-paisa money and the production `formatMoney` boundary unchanged.
- Known generated notification payloads are structured so title/message render in the active language. Unknown/server-authored literal text remains literal.
- Use typed catalog keys with Bangla/English parity and interpolation tests; do not copy prototype inline web state.

## Exact Notification Center behavior

### Inbox and item behavior

- Newest first; production retention policy exposes at most the latest 200 active items per shop/user inbox.
- Per-user unread and dismissed state. One user reading/dismissing an alert never hides it for another user.
- Unread card state and dot; category icon/style; title; two-line message; localized time and relative-date label.
- Group headings: Today, Yesterday, N days ago, N weeks ago, then localized short date.
- Tap marks that item read, then follows only an allowlisted action route if the current actor still has access.
- “Mark all read” is disabled at zero unread and marks all currently visible items for the acting user.
- Mobile long-press exposes per-item Delete/Dismiss; dismissal is recoverable as receipt state and does not delete the shop notification row.
- Empty state uses the prototype meaning. First load, refresh, load failure/retry, and mutation failure remain explicit production shared states.
- Header bell unread count is per-user and localized; display `10+` above ten.

### Exact categories and routes

| Prototype category | B1 Center support | Action route / generator phase |
|---|---|---|
| Cash Summary | Render/read/dismiss in B1 | Cash Summary; existing/B3 completion; Owner only |
| Low Stock | Render/read/dismiss in B1 | Inventory; existing/B2 completion; `inventory_view` |
| Expiry | Render/read/dismiss in B1 | Expiry; existing/B2 completion; `expiry_manage` |
| Overdue Credit | Render/read/dismiss in B1 | Credit; B3 generator; `credit_view` |
| Sync Completed | Render/read/dismiss in B1 | No arbitrary route; existing sync event |
| Backup Reminder | Render/read/dismiss in B1 | No route until security recovery work |
| Refund | Render/read/dismiss in B1 | B2 refund destination/generator; `sale_return` |

- Daily dedupe key behavior is preserved: a repeated same-day scan updates the existing alert content without changing ID, created time, or read state.
- Existing production `daily_summary`, `low_stock`, `expiry`, and `sync` types map into the prototype categories without losing historical rows.
- Action routes are derived from trusted type/ref data, never accepted as arbitrary stored navigation strings.

### Notification Settings in B1

The prototype Notifications modal is included exactly as a functional Settings behavior:

- All Notifications master switch.
- Stock Alerts.
- Expiry Alerts.
- Credit Alerts.
- Daily Cash Summary / OS notification permission switch.
- Child switches disabled while master is off.
- Save commits; Cancel discards unsaved changes.
- Denied OS permission shows a localized explanation. In-app alerts may remain enabled independently.
- Preferences are local/device settings and are shop-keyed where notification jobs depend on active shop. They do not alter business rows or bypass permission filtering.

## Explicit B1 Settings behavior

Settings is Owner-only in B1 because its reachable prototype surface combines Owner account, billing entry, and destructive security entries. B1 implements only these visible prototype behaviors:

1. Personal Data row and modal:
   - Owner name editable.
   - Owner phone displayed read-only per Founder override.
   - Address editable.
   - Email editable.
   - Save/Cancel and success/error states.
   - Production uses synced nullable profile fields through `db/`; phone never writes through this form.
2. Notifications row and exact modal described above.
3. Language row showing current language and exact `বাং` / `ENG` control.
4. Existing Owner Change PIN flow: current PIN, new PIN, confirmation, mismatch/error/progress, bcrypt, uniqueness, audit, revocation-safe commit.
5. Logout row and confirmation, implemented as production Lock/Switch User on the enrolled shared device.
6. App version/build footer sourced from production app metadata, never a hardcoded prototype version.
7. Visible Plan, Multi-Shop, Printer, Backup Key, Remote Wipe, inventory, sales/credit, closing, and tax rows remain accounted for by the phase table below; B1 may render disabled/forward navigation only where a real destination already exists. It must not persist inert controls.

The prototype’s dormant `openShopNameModal` code has no visible row and is not a product surface. Do not invent a separate Shop Name behavior in B1.

Founder overrides:

- Owner phone is read-only in B1. Verified auth-account phone change is security work.
- FIFO / Weighted Average is `SUPERSEDED`. Do not render, persist, sync, or branch on a runtime costing-mode toggle. Preserve current production stock, actual batch-cost COGS, and FEFO rules.

## Deferred prototype items and target phase

Nothing visible in the covered prototype surfaces disappears.

| Prototype item not completed in B1 | Target | Required outcome |
|---|---|---|
| Owner MorningDashboard sales/recent-sales completion | B3 | Store-wide SQLite summary/recent activity using integer paisa and correct day boundaries |
| Owner MorningDashboard inventory/expiry cards and actions | B2 | Complete inventory/expiry behavior and settings before final dashboard wiring |
| Owner MorningDashboard credit/cash/supplier/report widgets and Complete Day flow | B3 | Reuse completed credit/cash/supplier/report/EOD read and write contracts |
| Owner MorningDashboard plan badge/shop switcher | B4 | Authoritative plan/trial and active-shop model |
| Sales History/detail | B2 | `sale_history`-guarded list/detail/receipt path |
| Discounts | B2 | `sale_discount`-guarded validated money flow |
| Returns/refunds and Refund notifications | B2 | `sale_return`-guarded ledger/cash/stock transaction and notification |
| Inventory edits, expiry actions | B2 | `inventory_edit`/`expiry_manage` with ledger/FEFO safety |
| Low-Stock Threshold | B2 | Named, validated inventory threshold consumed by queries/notifications |
| Expiry Warning — Near/Far | B2 | Real-date windows consumed consistently by inventory and notifications |
| Max Refund Window | B2 | Enforced by the approved return domain contract |
| Credit Period and Overdue Credit generator | B3 | Enforced credit rule and permission-filtered notification |
| Cash Drawer, Closing-Time Prompt, End of Day | B3 | Existing fixed cash formula; prompt preference; closing workflow |
| Tax/VAT | B3 | Approved money/report contract before any sale calculation changes |
| Expense, Reports, Monthly Report, Data Export | B3 | Existing/new `reports` or exact Owner guard; export from SQLite read models |
| Suppliers and Supplier Invoices | B3 | Owner-only production purchase flows and details |
| Staff Sales & Audit Log | B3 | Owner-only scoped report/audit surface |
| Printer row and Printer Settings | B3 | Native printer wrapper, pair/re-pair/unpair/test print/error states |
| Plans & Upgrade, trial, premium gates, payment, success | B4 | Server-authoritative subscription/payment lifecycle; Owner only |
| Multi-Shop row/tile, management, summary, switcher | B4 | Active-shop session/sync teardown-start invariants and plan limits |
| Backup Key view/regenerate/restore | Security | Real recovery/key design; never prototype random local key |
| Remote Wipe | Security | Server-authorized, recoverable, audited destructive-data design; never `localStorage.clear()` equivalent |
| Verified Owner phone change | Security | OTP/verification, auth identity rebinding, device/session revocation, sync-safe update |
| FIFO / Weighted Average toggle | SUPERSEDED | Omitted permanently unless a separate founder-approved accounting migration replaces this decision |

Deferred destinations may be linked from B1 navigation only when the route exists and clearly communicates its phase state. No fake success, local-only business state, or dead press target.

## Already reusable production work

| Existing asset | Reuse rule |
|---|---|
| `state/sessionStore.ts`, `sessionGuard.ts` | Extend role and persisted `startedAt`; keep epoch invalidation |
| `state/switchUser.ts` | Exact safe End Shift/Logout/Lock implementation |
| `db/auth.ts`, native PIN crypto, PIN lookup tags | Extend Manager acceptance; do not weaken or duplicate |
| `user_permissions`, `permission_version`, auth hook/revocation | Extend exact 12-key mapping; no parallel permission store |
| `domain/permissions.ts`, `usePermission`, `AccessDenied` | One role/default/override contract for UI and DB |
| Existing Manager role rows | Assign existing per-shop role; never create duplicate Manager roles |
| Expo Router and current routes | Preserve route paths where possible; add registry/guards around them |
| `MedicineTextScanner`, sale search, FEFO, `cartStore` | Compose the dedicated Scan route |
| `db/staff.ts` and current Staff Management | Reuse secure add/reset/deactivate/override transactions and tests |
| `db/notifications.ts`, native notification jobs, unread hook | Add receipts/actions/categories; retain local-first jobs and severity |
| `db/settings.ts`, shops/users, `changeOwnPin` | Finish profile/settings surface through SQLite/outbox |

## Production implementation shape

### New/extended data contracts

- Add Manager to pure role narrowing/default resolution and all auth/session/sync/RLS role checks.
- Add only missing permission keys; map existing keys rather than renaming storage.
- Add additive SQLite/Postgres migrations for any missing synced nullable Owner profile fields and per-user notification receipts. Every FK has explicit `onDelete`.
- Notification receipt unique key: `(notification_id, user_id)` with `read_at` and nullable `dismissed_at`; backfill legacy read state without erasing other users’ unread state.
- Keep notification preferences in an explicit local/device table or store; never in screen state alone.
- Add Staff/Manager dashboard read models under `db/`, scoped by shop, actor, business day, and required permission.
- Add one typed route registry under mobile navigation code containing exact route, localized label, role rule, permission, bottom slot/lock behavior, More membership, Owner Quick Links membership, and notification action eligibility.

### Expected file impact

Existing files to extend:

- `apps/mobile/domain/permissions.ts` and `permissions.test.ts`.
- `apps/mobile/state/sessionStore.ts`, `switchUser.ts`, and their tests.
- `apps/mobile/db/schema.ts`, `auth.ts`, `staff.ts`, `settings.ts`, `notifications.ts`, permission/staff/notification SQLite tests, and Drizzle migration metadata.
- `apps/mobile/sync/deviceAuth.ts` and current sync/auth tests.
- `apps/mobile/app/_layout.tsx`, `(tabs)/_layout.tsx`, `(tabs)/dashboard.tsx`, operational route guards, `staff/management.tsx`, `notifications.tsx`, and `settings/settings.tsx`.
- `backend/supabase/functions/sync/deviceLogin.ts`, shared authorization/table mappings, and device-login/hardening tests.
- A new additive PostgreSQL migration plus `backend/supabase/pgtest/security.pgtest.ts` and migration/grant guards.

Expected new production files:

- typed route registry and navigation shell/More components under `apps/mobile/navigation/` or the repository’s established component boundary;
- `apps/mobile/app/(tabs)/staff-home.tsx` and `apps/mobile/app/scan.tsx`;
- Staff/Manager dashboard read model under `apps/mobile/db/` with SQLite tests;
- locale store, typed catalog, formatters, and tests under `apps/mobile/state/` plus a focused `i18n/` or `domain/` boundary;
- notification-preference and notification-receipt migration/query tests;
- the next generated Drizzle migration after `0008` and a new timestamped PostgreSQL migration. Generated names are recorded before either migration is applied; existing migrations are never renamed or edited.

### Principal risks

- Manager accidentally inheriting Owner authority or unknown-role fallback.
- UI/SQLite/sync/RLS permission drift across the 12 keys.
- Cross-shop or cross-user leakage in dashboard metrics and notification receipts.
- Legacy read notifications becoming unread for everyone or dismissed globally during upgrade.
- Store totals using wrong day boundaries, seller scope, held/cancelled rows, or floating-point money.
- End Shift clearing enrollment/outbox, or ordinary navigation clearing cart.
- A locked route flashing protected data before redirect.
- Profile migration mutating Owner phone/auth identity.
- Locale conversion touching stored money or persisted business data.

### Safety gate

Implementation changes auth role acceptance, permission enforcement, SQLite/Postgres schema, sync authorization, and RLS. Before code:

1. User explicitly approves this plan for implementation.
2. Implementation records exact additive migration names/files, rollback/recovery notes, and tests.
3. Never edit migrations `0000`–`0008` or any applied PostgreSQL migration.
4. Test fresh install and upgrade data containing legacy Staff overrides, Manager rows, and legacy notification read state.
5. Re-check `git status`; preserve unrelated/uncommitted work.

## Implementation order

1. Pure domain role + exact 12-key mapping/presets/tests.
2. Additive SQLite/Postgres/Edge/auth-hook/RLS/sync changes for Manager and permission enforcement; fresh/upgrade/negative tests.
3. Staff creation/role assignment, Owner/Manager security sub-guards, reactivation, safe removal, and exact Staff tabs/detail/reset flows.
4. Exact root mapping and typed route registry/direct-route boundary.
5. Cashier StaffHome and ManagerDashboard branch/read models/End Shift.
6. Exact bottom slots, elevated Scan gate/route, More tiles, Owner Quick Links, and dismiss behavior.
7. Global locale store/catalog/formatters; translate every current route and shared state.
8. Per-user notification receipts, exact Center behaviors/categories/actions, unread badges, and Settings notification preferences.
9. Exact B1 Settings Personal Data/language/change-PIN/logout rows; Founder overrides enforced.
10. Full automated suite, typecheck/lint, migration diff checks, then real-device offline role/language/camera/notification/shift validation.

## Verification required during implementation

Automated:

- Owner/Manager/Staff/unknown role defaults, all 12 keys, all three presets, overrides, stale versions, foreign shop, and direct DB denial with zero side effects.
- Fresh-device and enrolled offline Manager/Staff login, role routing, deactivation/reactivation/removal, and Switch User.
- StaffHome own-only three metrics/latest-five; Manager exact metrics/latest-eight and permission-based omission.
- Exact bottom slots for Owner, default Cashier, default Manager, and Custom combinations; exact More order/visibility; all deep-link guards.
- Scan press denial without `sale_entry`; repeated scans/cart handoff with it.
- Staff List/Today/Permissions/detail/reset/activation/removal and Manager security-control absence.
- Bangla default, English toggle, persistence, catalog parity/interpolation, localized non-money formatters.
- Notification per-user read/dismiss, mark all, category mapping, daily dedupe, action allowlist, sensitive filtering, max visible retention, and preferences.
- Settings profile update/outbox, phone non-mutation, notifications Save/Cancel, change PIN, and no costing-mode persistence.
- `pnpm test`.
- `pnpm --filter @muthoy/mobile typecheck`.
- `pnpm --filter @muthoy/mobile lint`.

Manual Android:

- Owner → MorningDashboard; Cashier → StaffHome; Manager → ManagerDashboard branch, online and enrolled offline.
- Default and Custom permission combinations, locked tabs, direct deep links, More contents, and no protected data flash.
- End Shift summaries and safe handover without enrollment/outbox loss.
- Bangla/English on every current screen; restart persistence.
- Camera denied/blocked/retry, repeated scan, manual search, Done/cart handoff.
- Notification unread badge, mark one/all, long-press dismiss, action denial/routing, OS permission denial.
- Settings phone read-only and costing toggle absent.
- 360dp safe-area/keyboard sanity only; final styling remains Phase C.

## Remaining conflicts

No unresolved founder/product conflict remains.

Resolved explicitly in this plan:

- Prototype `/scan` globally allows a sale/cart workflow; exact `sale_entry` semantics and production fail-closed security require the visible button to deny entry without `sale_entry`.
- Prototype Manager code renders several store-wide values without checking a Custom Manager’s overrides; the prototype permission definitions explicitly assign store overview/report/cash/credit/staff visibility, so production gates each value as mapped above.
- Prototype Manager `staff_manage` exposes permission/PIN/deactivation/removal controls; Founder override keeps escalation and destructive security actions Owner-only while retaining operational roster/performance/Add Cashier access.
- Prototype owner phone edit is replaced by read-only display per Founder override.
- Prototype costing selector is `SUPERSEDED` per Founder override.

## READY FOR IMPLEMENTATION

**YES — PLAN COMPLETE.** Actual code work still waits for explicit approval under the repository safety gate.
