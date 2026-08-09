# Muthoy (মুঠোয়) — Fix Daily Cash Reset, Opening Cash Default & Notifications

Three linked issues with the cash drawer day-cycle. Fix all three. The day boundary
is MIDNIGHT (12:00 AM) local time — a "pharmacy day" runs 12:00 AM to 11:59 PM.

## Brand tokens
Brand Green #059669, Deep Green #065F46, Soft Green #ECFDF5, #111827, #6B7280,
amber #D97706. Money in DM Mono (var(--font-money)); other numbers Plus Jakarta Sans.

---

## ISSUE 1 — Opening cash must DEFAULT TO 0, set by the user (never auto-set)

Current: getCashBreakdown does `getOpeningCash(target) ?? 0`, which is correct — it IS
0 until set. But the modal/quick-chips can make it LOOK preset, and any "use
yesterday's closing" behavior must be removed.

Fix:
- Confirm NOTHING auto-calls setOpeningCash. Opening cash is 0 until the user enters it.
- In OpeningCashModal: the amount field starts EMPTY (not prefilled with a chip,
  not prefilled with yesterday's closing). The quick chips (500/1000/2000/5000) are
  OPTIONAL helpers the user taps — never auto-selected.
- Remove any "Skip / use yesterday's closing" default that sets a value silently. If
  the user dismisses without entering, opening cash stays 0 (and the Expected Cash
  card shows opening = ৳0 with a subtle note "শুরুর নগদ সেট করা হয়নি / Opening cash
  not set").
- Each day's opening is stored per-date in cashOpening[YYYY-MM-DD], so a new day has
  no value = 0 until the owner sets it. (This already works — just ensure no fallback
  to the previous day's number.)

---

## ISSUE 2 — Auto-popup the PREVIOUS-DAY summary after midnight (day rollover)

Current: the yesterday-summary + opening-cash modal triggers on "first app open when
today's opening cash isn't set." That's a proxy, and it's the source of the error.
Make it a real day-rollover.

Fix — implement a proper rollover check:
1. Store the last-seen pharmacy day: localStorage `lastSeenCashDay` = YYYY-MM-DD
   (shop-scoped via shopStorage).
2. On app open / dashboard mount AND on regaining focus (visibilitychange), compute
   today's date key. If `lastSeenCashDay` exists AND is BEFORE today (i.e. midnight
   has passed since last use):
   - Show the PREVIOUS DAY's summary modal (sales, expected cash, credit, etc. for
     `lastSeenCashDay`) — this is the "yesterday status" popup.
   - Then prompt the opening-cash modal for the NEW day (starting empty = 0).
   - Update `lastSeenCashDay` = today AFTER the owner views/dismisses.
3. If `lastSeenCashDay` == today, do NOT re-pop (already handled today).
4. First-ever run (no lastSeenCashDay): just set it to today, show opening-cash once,
   no yesterday summary (there's no prior day).

Use the actual date rollover, not "opening cash unset", so the popup is reliable even
if the owner set opening cash late, and it shows the correct previous day's numbers.

Build the yesterday summary from getCashBreakdown(previousDayDate) and the day's
sales — pass the specific date, since cashCalculation already accepts a target Date.

---

## ISSUE 3 — 8 PM "cash in drawer now" notification

Current: scheduleDailyCashNotification fires at DEFAULT_HOUR = 20 (8 PM). Keep this,
but make the message show the CURRENT expected cash at that moment.

Fix:
- At 8 PM, the notification body = current getCashBreakdown().expected for today,
  e.g. "এখন ড্রয়ারে আছে: ৳{expected}" / "Cash in drawer now: ৳{expected}".
  Format the amount in DM Mono style (it's money).
- This is informational (owner-only), separate from the after-midnight rollover.
- Re-arm for the next day after firing (already done — keep it).
- Keep it in the in-app bell even without browser notification permission.

---

## THE DAY CYCLE (how it all fits)
- 12:00 AM: new pharmacy day. On next app open, show PREVIOUS day's summary, then
  prompt opening cash for the new day (defaults to empty/0).
- During the day: Expected Cash = Opening + Cash Sales + Credit Collections −
  Expenses − Withdrawals − Supplier Payments. Opening is whatever the owner set
  (0 if they didn't).
- 8:00 PM: notification tells the owner the current expected cash in the drawer.
- Repeat next midnight.

## VERIFY
1. Fresh day (simulate by setting lastSeenCashDay to yesterday): on app open, the
   previous day's summary pops, then opening-cash modal appears empty (0), user sets it.
2. Opening cash is NEVER pre-filled and NEVER inherits yesterday's closing.
3. Reopening the app the same day does NOT re-pop the modals.
4. At 8 PM the notification shows the correct current drawer amount.
5. Money shows in DM Mono; build is clean.

## What not to change
- The cash formula in cashCalculation.ts (correct).
- Shop-scoped storage (cashOpening via shopStorage).
- The per-date storage shape cashOpening[YYYY-MM-DD].
