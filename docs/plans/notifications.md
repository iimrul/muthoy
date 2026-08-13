Notification Center: Low-Stock, Expiry, 8PM Cash Summary (Volume 4 NOTIFICATION)

Context
Volume 4's NOTIFICATION spec (P1 — post-beta fast-follow) calls for low-stock alerts (threshold crossing, de-duplicated), expiry alerts, an 8 PM owner-only cash-in-drawer summary, and a Notification Center with unread count and severity styling (info/warning/critical). This isn't greenfield: the `notifications` table already shipped in migration 0000, and three stub files already exist for exactly this — `db/notifications.ts`, `native/notifications.ts` (the only file allowed to import expo-notifications/expo-background-task), and `app/notifications.tsx` (already routed at `/notifications`).

Scope note: Volume 0's roadmap lock classifies this whole feature as P1/post-beta — not in the 15-day Beta sprint. Per CLAUDE.md rule 13 this was flagged before planning began; the founder approved building it now as a deliberate scope exception, the same pattern already used for Purchases (DECISIONS.md, 2026-08-12 entry). A matching DECISIONS.md entry will be added when this ships (implementation-time, not now).

Decisions confirmed with the user:
1. True OS-level background scheduling via expo-background-task (not a foreground-only fallback), with a foreground AppState self-heal as the practical reliability backstop — do not present this to the user as guaranteeing exact 8PM delivery; Android Doze/OEM background-kill behavior can suppress wakes regardless of correct setup.
2. Expiry alert window: 0–30 days out fires an alert; severity is critical at ≤7 days, warning at 8–30 days. Per-shop configurability is deferred — no settings section exists for it yet.
3. Severity styling and the proposed notification copy (below) are approved as-is.
4. The unread bell + badge lives only in the shared `StandardHeader` component. Dashboard (`app/(tabs)/dashboard.tsx`) is still an unbuilt stub and stays out of scope.
5. Notification writes are local/device-scoped and are explicitly excluded from `sync_queue` — they do not enqueue outbox rows, unlike every other write site's Day-13 backfill debt.
6. The 8PM cash summary stays owner-only: a background wake or foreground check must never create/surface a `daily_summary` row when the persisted session's role is `staff` or absent.
7. A DECISIONS.md entry recording this P1 scope exception is added when the feature ships (implementation-time step, not part of this planning doc).
8. TECH_STACK.md's native-features list gets corrected to include `expo-task-manager` (a required peer for `expo-background-task`'s callback registration, currently missing from that list) when the dependency is actually added.
9. No `notification-icon.png` asset exists yet — do not invent one. The `expo-notifications` app.json plugin config omits the `icon`/`color` keys (falling back to Expo's default notification icon) until a real asset is provided; this is a flagged design-asset gap, not a blocker.

Design

domain/notificationRules.ts — new, pure (zero React/DB imports, mirrors domain/fefo.ts)
- `isLowStockCrossing(currentTotalStock, threshold, hasUnresolvedAlert): boolean` — true only when stock is below threshold AND no unresolved alert already exists (the actual "crossing" moment).
- `isStockRecovered(currentTotalStock, threshold, hasUnresolvedAlert): boolean` — true when stock is at/above threshold AND an unresolved alert exists (the silent re-arm moment; never itself creates a notification).
- `isBatchInExpiryWindow(daysUntilExpiry: number | null, windowDays = 30): boolean` — consumes `@muthoy/utils`'s existing `daysUntilExpiry()` return value only; never recomputes or stores a day-count itself (CLAUDE.md rule 3).
- `expirySeverity(daysUntilExpiry: number): 'critical' | 'warning'` — `<= 7` → critical, else warning.
- Exported constants `EXPIRY_WINDOW_DAYS_DEFAULT = 30`, `EXPIRY_CRITICAL_DAYS_DEFAULT = 7`.
- New `domain/notificationRules.test.ts` (mirrors domain/fefo.test.ts): table-driven crossing/recovery cases, window/severity boundary cases (exactly 7, exactly 30, negative/expired, null expiryDate).

db/schema.ts — one additive column on the already-shipped `notifications` table
```ts
resolvedAt: text("resolved_at"), // system-set only; low_stock hysteresis re-arm marker.
                                   // expiry/daily_summary rows never set this.
```
Generated via `pnpm --filter @muthoy/mobile db:generate` — never hand-edited — following the `0002_furry_celestials.sql` precedent (single additive ALTER TABLE, no backfill needed since nothing writes to `notifications` yet). No new table, no FK. Expiry and daily-summary dedup both reuse the already-shipped `refId` column; no other schema change.

db/notifications.ts — the only file touching Drizzle/SQLite for notifications
- `listNotifications(shopId): Promise<Notification[]>` — ordered `createdAt desc`.
- `getUnreadCount(shopId): Promise<number>` — new export (the original stub had none); uses the existing `notifications_shop_read_idx` (shopId, isRead).
- `markAsRead(id): Promise<void>`.
- `createNotification(shopId, type, severity, title, body, refId?): Promise<void>` — signature updated from the original stub's `(shopId, severity, message)` shape, which predates the real shipped schema's separate `type`/`title`/`body` columns.
- `findUnresolvedLowStockAlert(shopId, medicineId)`, `resolveLowStockAlert(id)`, `hasExpiryAlert(shopId, batchId)`, `hasDailySummaryToday(shopId, businessDate)` — dedup-check helpers used only by `native/notifications.ts`'s check function.
- `localBusinessDate(now: Date): string` — local copy, following the existing (already three-times-duplicated) convention in `db/customers.ts`/`db/purchases.ts`/`db/sales.ts`, not a new shared refactor.
- No `sync_queue` enqueue on any of these writes (decision 5).

db/auth.ts — shared owner-gating extraction
`requireOwner(shopId, actorUserId): Promise<void>` is currently copy-pasted in `db/purchases.ts:78-82` and `db/suppliers.ts`. Move it into `db/auth.ts` (which already owns its only dependency, `getActiveSessionRole`) — not a new `db/permissions.ts`, to avoid confusion with the unrelated, still-unimplemented `domain/permissions.ts` (`hasPermission`, a Day-11 stub unrelated to this feature). Update both existing call sites to import it; `db/notifications.ts`'s daily-summary write path becomes its third call site (decision 6).

native/notifications.ts — the only file importing expo-notifications/expo-background-task/expo-task-manager
- `scheduleLowStockCheck`/`scheduleExpiryCheck`/`scheduleDailySummary` become idempotent registration calls for one shared `TaskManager`/`expo-background-task` task (not three independent schedules — they'd fragment one shared OS execution budget for no benefit, since all three checks are cheap local SQLite reads against an already-open DB).
- `runNotificationChecks(shopId): Promise<void>` — the actual per-wake logic, called by both the background task callback and the foreground fallback:
  1. Read the persisted session via a new synchronous escape hatch (below). No session → skip the cycle.
  2. Low-stock scan: for each medicine, compute total stock by reusing `db/inventory.ts`'s existing `listMedicines` per-medicine `SUM(batches.stock)` aggregation (not a second hand-rolled query), then apply `isLowStockCrossing`/`isStockRecovered`.
  3. Expiry scan: enumerate batches via `domain/fefo.ts`'s `sortByExpiry()` (real-date order, null-last), pipe each through `daysUntilExpiry()` then `isBatchInExpiryWindow`/`expirySeverity`; skip any batch that already `hasExpiryAlert`.
  4. If local device hour >= 20: compute `businessDate`, and only if the persisted session's role is `owner`, check `hasDailySummaryToday` and if not, call `getCashSummary(shopId, businessDate)` → `expectedCash()` (zero intermediate arithmetic anywhere else — CLAUDE.md rule 4) and create the notification. A `staff`/absent session skips this step for that cycle entirely (decision 6).
  5. Each of the three steps is independently try/caught — one failing must not block the others.
- `requestNotificationPermissionsAsync()` + Android notification channel setup.

state/sessionStore.ts — headless-context read
Add `readPersistedSessionSync(): Session | null` — reads the same MMKV key (`'muthoy-session'` store, `'session'` persist key) directly and unwraps Zustand persist's `{state, version}` envelope, bypassing async rehydration. Documented inline as "headless-context read only; components must use the hook." Only `native/notifications.ts`'s background task calls it.

Known product limitation, stated explicitly per decision 6: on a shared device, if staff was the last to log in and the owner doesn't reopen the app as themselves that evening, the summary silently will not fire that day — there is no separate prompt forcing an owner session. This is the correct fail-closed behavior for "never surface to staff," not a bug, but is worth the founder's awareness.

app/_layout.tsx — foreground self-heal
Add an `AppState === 'active'` listener that calls `runNotificationChecks(shopId)` using the normally-hydrated `useSessionStore` session (no MMKV escape hatch needed here). Every check in `runNotificationChecks` re-evaluates current state rather than a delta since last run, so this is safe to call repeatedly and a missed background wake only delays an alert, never loses it. A light in-memory debounce (skip if last run was <60s ago) avoids redundant scans on rapid tab-switching — a performance nicety, not a correctness requirement.

components/ui/StandardHeader.tsx — bell + unread badge
Add optional `onBellPress?: () => void` and `unreadCount?: number` props, rendered as a `right-4` Pressable mirroring the existing `left-4` back-chevron block (same `accessibilityRole="button"` + `accessibilityLabel` pattern). Badge uses `font-mono` for the count (matching the existing cart-count badge in `app/(tabs)/sale.tsx:71`) with `bg-error`. No new shared `Badge` component — this codebase doesn't extract shared atoms ahead of a second use case. Callers (`app/(tabs)/sale.tsx`, `app/(tabs)/inventory.tsx`, and other StandardHeader call sites) wire `onBellPress={() => router.push('/notifications')}` and source `unreadCount` from `getUnreadCount(shopId)`.

app/notifications.tsx — Notification Center screen
StandardHeader with back button, FlatList over `listNotifications(shopId)` with EmptyState fallback (mirrors app/(tabs)/sale.tsx's list pattern). Row tap calls `markAsRead` then refreshes the unread count. Severity styling (decision 3, approved): `warning` → `bg-warningBg`/`text-warning`; `critical` → `bg-errorBg`/`text-error` (no dedicated `critical` token exists distinct from `error` — reusing it is the approved choice); `info` → `text-info` on the default white surface (no `infoBg` token exists in packages/constants/src/tokens/colors.json). Daily-summary body bakes the formatted amount in as plain text at creation time via `formatMoney` (notifications.body is a flat string column).

Approved notification copy (decision 3):
- Low-stock: title "Low stock: {medicineName}", body "{totalStock} left (threshold {threshold})".
- Expiry: title "Expiring soon: {medicineName}", body "Batch {batchNo} expires in {daysUntilExpiry} days ({expiryDate})".
- Daily summary: title "Cash summary — {businessDate}", body "Expected cash in drawer: {formatMoney(expectedCash)}".

Packages / config
Add via `npx expo install expo-notifications expo-background-task expo-task-manager` (all three confirmed absent from apps/mobile/package.json today). app.json changes: add `"expo-notifications"` to the plugins array WITHOUT an icon/color config block (decision 9 — no real asset exists yet, use Expo's default rather than inventing a path); Android POST_NOTIFICATIONS (API 33+) is handled automatically by the plugin, verify via `npx expo-doctor`; iOS needs `ios.infoPlist.UIBackgroundModes: ["processing"]` and `BGTaskSchedulerPermittedIdentifiers` containing the exact task-identifier string used in `TaskManager.defineTask`. Runtime permission prompt (`Notifications.requestPermissionsAsync()`) fires lazily on first Notification Center visit, not blocking app boot. Requires a new EAS dev-client build before device verification — one more native module in this project's already-accepted dev-build workflow (camera/ML Kit, local-auth, bcrypt), not a new risk category; `tsc`/lint cannot catch native-config mistakes.

Files
- apps/mobile/db/schema.ts — additive `resolvedAt` column
- apps/mobile/db/notifications.ts — real implementation
- apps/mobile/native/notifications.ts — background task + scheduling + check logic
- apps/mobile/domain/notificationRules.ts — new, pure crossing/window/severity logic
- apps/mobile/domain/notificationRules.test.ts — new unit tests
- apps/mobile/db/auth.ts — extracted shared requireOwner
- apps/mobile/db/purchases.ts, apps/mobile/db/suppliers.ts — switch to the shared requireOwner
- apps/mobile/components/ui/StandardHeader.tsx — bell + badge slot
- apps/mobile/app/notifications.tsx — Notification Center screen
- apps/mobile/app/_layout.tsx — AppState foreground fallback
- apps/mobile/state/sessionStore.ts — readPersistedSessionSync escape hatch
- apps/mobile/app.json — plugin/permission config
- apps/mobile/package.json — new dependencies
- TECH_STACK.md — add expo-task-manager to the native-features list (decision 8)
- DECISIONS.md — new entry recording the P1 scope exception (decision 7)

Verification
1. Low-stock crossing, not per-visit: unit tests on domain/notificationRules.ts (drop-below-with-no-prior-alert fires; repeated calls while still-low don't refire; recovery resolves silently with no notification; a second drop after recovery fires again). Real-SQLite integration check (mirroring the node:sqlite pattern from the 2026-08-10 db/auth.ts verification): insert a below-threshold medicine, call runNotificationChecks twice with no stock change, assert exactly one row. On-device: repeatedly open Inventory/Sale for a low-stock medicine, confirm exactly one Notification Center entry — the project's own stated validation criterion (Volume 6 prompt #11).
2. Expiry uses the real date, never a cached count: unit test confirms notificationRules.ts only ever consumes daysUntilExpiry()'s return value; confirm no new "days remaining" column is added anywhere. Vary `now` in a test against a fixed stored expiryDate and confirm window/severity recompute correctly.
3. 8PM summary never reaches a staff session: unit test runNotificationChecks with a mocked readPersistedSessionSync returning staff past 20:00 → zero rows created; owner → exactly one row, no duplicate on a second call same day. Device check: staff session past 8PM → nothing appears; switch to owner → appears on next check.
4. Cash summary matches the fixed formula exactly: the daily-summary write path calls getCashSummary then passes its result straight into expectedCash() with zero intermediate arithmetic anywhere else (code-review checklist item, CLAUDE.md rule 4). Test compares the notification's rendered formatMoney output against a direct expectedCash(getCashSummarySync(...)) call for byte-identical output.
5. `pnpm --filter @muthoy/mobile typecheck` and `pnpm --filter @muthoy/mobile lint` throughout; `npx expo-doctor` after the package/config changes land; multi-tenancy spot check that a second shop on the same device sees none of the first shop's notifications (CLAUDE.md rule 7).
