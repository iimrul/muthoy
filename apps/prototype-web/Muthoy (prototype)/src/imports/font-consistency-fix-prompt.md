# Muthoy (মুঠোয়) — Fix Font Inconsistency
## Rule: DM Mono for money, Plus Jakarta Sans for all other numbers

## The problem
Fonts are applied two different ways across the app, causing visible drift:
- Some places use CSS variables: var(--font-mono), var(--font-bangla)
- Other places hardcode strings inline: "'Plus Jakarta Sans', sans-serif",
  "'DM Mono', monospace", "'Hind Siliguri', sans-serif"

Counts found: 16 files hardcode "Plus Jakarta Sans", 6 hardcode "Hind Siliguri",
5 hardcode "DM Mono", mixed with var(--font-*) usage. Unify all of it through
variables, and apply the money-vs-other-number rule below.

---

## THE NUMBER RULE (per brand guidelines)

- Monetary values (anything with ৳ — prices, totals, cash, P&L, discounts,
  credit balances, payments) -> DM Mono, via var(--font-money).
- All other numbers (quantities, stock counts, batch counts, days-to-expiry,
  percentages, phone numbers, dates, transaction counts, page counters) ->
  Plus Jakarta Sans, via var(--font-sans) (same as English UI).

So money looks distinct and column-aligned (monospace), while incidental numbers
sit naturally in the body font.

---

## STEP 1 — Define the font roles in ONE place (theme.css)

  :root {
    /* English / Latin UI text AND non-money numbers */
    --font-sans: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;

    /* Bangla UI text */
    --font-bangla: 'Hind Siliguri', 'Noto Sans Bengali', 'SolaimanLipi', sans-serif;

    /* MONETARY values only (৳) */
    --font-money: 'DM Mono', 'Courier New', monospace;
  }

IMPORTANT compatibility note: the app currently uses var(--font-mono) in ~36 places,
and historically --font-mono was the "money" font. Many of those ARE money, but
some may be non-money numbers. So do NOT blanket-alias --font-mono to money. Instead:
- Keep --font-money for money.
- Audit each existing var(--font-mono) usage (Step 3) and switch it to either
  var(--font-money) (if it renders a ৳ amount) or var(--font-sans) (if it's a
  quantity/count/other number).

---

## STEP 2 — Font loader (fonts.css)

Keep all three families. Ensure these imports:

  @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap');
  @import url('https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@300;400;600;700&display=swap');
  @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&display=swap');

(DM Mono stays — it's needed for money. Added Hind Siliguri 300 for the light
greeting, and Jakarta 300/500 for the full type scale.)

---

## STEP 3 — Replace hardcoded strings AND sort numbers correctly

### 3a. Straight replacements (text, not numbers)
- fontFamily: "'Plus Jakarta Sans', sans-serif"  ->  fontFamily: "var(--font-sans)"
- fontFamily: "'Hind Siliguri', sans-serif"      ->  fontFamily: "var(--font-bangla)"

### 3b. Money strings -> money variable
- fontFamily: "'DM Mono', monospace" on a ৳ value -> fontFamily: "var(--font-money)"
- e.g. TrialBanner.tsx daysLeft is NOT money (it's a day count) -> that one becomes
  var(--font-sans), not money. (Days remaining is a plain number.)

### 3c. Audit every existing var(--font-mono) and reclassify
For each of the ~36 var(--font-mono) usages, decide by what it renders:
- Renders a ৳ amount (price, total, cash, profit, discount amount, credit balance,
  payment) -> change to var(--font-money).
- Renders a non-money number (stock qty, batch count, expiry days, %, phone, date,
  transaction count) -> change to var(--font-sans).

Examples to guide the AI:
- Inventory: the PRICE per unit / sale price -> var(--font-money); the STOCK
  quantity and BATCH count and "98d" expiry -> var(--font-sans).
- EndOfDay / Report / MonthlyReport: all ৳ figures -> var(--font-money); the
  transaction COUNT and average-items numbers -> var(--font-sans).
- Checkout / Cart: line totals, cart total, change -> var(--font-money); item
  quantity steppers -> var(--font-sans).
- CreditSales / CustomerCreditDetail: outstanding ৳ balances -> var(--font-money);
  number of customers, days overdue -> var(--font-sans).
- EditMedicineModal: the price fields -> var(--font-money); quantity/batch fields
  -> var(--font-sans).

After this, NO inline font string should remain anywhere — only var(--font-sans),
var(--font-bangla), var(--font-money).

---

## STEP 4 — Tailwind classes

If Tailwind font-mono is used on money, map it; otherwise remove it in favor of the
money variable:

  fontFamily: {
    sans: ['var(--font-sans)'],
    bangla: ['var(--font-bangla)'],
    money: ['var(--font-money)'],
  }

Replace any font-mono class on a ৳ value with font-money (or inline
var(--font-money)); replace font-mono on non-money numbers with the default sans.

---

## STEP 5 — The rule going forward

Four roles, four variables, no inline strings:
- Bangla UI text -> var(--font-bangla) (Hind Siliguri)
- English UI text -> var(--font-sans) (Plus Jakarta Sans)
- Non-money numbers (qty, counts, days, %, phone, dates) -> var(--font-sans)
- Monetary values (৳) -> var(--font-money) (DM Mono)

Currency format stays: ৳ XX,XXX with English numerals, comma separators, minimum
18sp on dashboards and summaries.

---

## VERIFICATION
1. Grep src/app/ for inline 'Plus Jakarta Sans', 'DM Mono', 'Hind Siliguri'
   — ZERO hits (all via variables).
2. Every ৳ amount renders in DM Mono and columns of prices/totals align.
3. Stock quantities, expiry-day counts, percentages, phone numbers, transaction
   counts render in Plus Jakarta Sans — NOT DM Mono.
4. Bangla text everywhere uses Hind Siliguri, no system-serif fallback.
5. App builds clean and looks consistent.

## WHAT NOT TO CHANGE
- Currency format (৳, English numerals, comma separators, 18sp min).
- Hind Siliguri for Bangla.
- Font sizes/weights in the type scale — only the family wiring changes.
