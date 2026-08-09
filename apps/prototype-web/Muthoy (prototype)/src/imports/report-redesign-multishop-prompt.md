# Portable POS — Report Screen Redesign + Multi-Shop Comparison

Redesign `/app/report` (`Report.tsx`) to look polished and add a beautiful
multi-shop sales comparison. Keep all existing data calculations and the CSV/share
logic — only the layout, visuals, and the new comparison section change.

---

## DESIGN SYSTEM (use exactly)

- Brand Green `#059669`, Deep Green `#065F46`, Soft Green `#ECFDF5`
- Rich Black `#111827`, Mid Gray `#6B7280`, White `#FFFFFF`
- Error/Red `#DC2626`, Amber `#D97706`, Info Blue `#2563EB`
- Fonts: Hind Siliguri (Bangla UI), Plus Jakarta Sans (English UI),
  DM Mono for ALL currency (format ৳ XX,XXX, English numerals)
- 8pt spacing grid, rounded-3xl cards, soft shadows, 16dp screen margins

---

## PART 1 — POLISH THE EXISTING REPORT

### 1a. Hero summary band (replaces the plain summary cards)

At the top, below the date period card, add a hero band:

```
A single full-width card, gradient bg from #059669 to #065F46, rounded-3xl,
padding 20px, white text.

Top row:
  Left:  "মোট বিক্রয়" / "Total Sales" — 11px uppercase, white/70
         ৳ {totalSales} — DM Mono, 30px, bold, white
  Right: a trend pill — "↑ ১২%" vs previous equivalent period
         (green-ish white/20 bg if up, red-ish if down)

Bottom row (3 inline stats divided by faint white/20 vertical lines):
  লেনদেন / Transactions — {count} — DM Mono 16px
  গড় বিক্রয় / Avg Sale — ৳{avg} — DM Mono 16px
  মুনাফা / Profit — ৳{profit} — DM Mono 16px
```

### 1b. Replace the custom SVG sparkline with a proper area chart

Use Recharts (already available). An `AreaChart` of daily sales over the selected
range:
- Green gradient fill (#059669 → transparent), 2px green stroke line
- Rounded, smooth (`type="monotone"`)
- X-axis: dates (short format), Y-axis hidden, subtle gridlines
- Tooltip on tap: that day's date + ৳ sales + txn count, DM Mono numbers
- Card: white, rounded-3xl, title "বিক্রয় ট্রেন্ড / Sales Trend"

### 1c. Payment breakdown as a clean donut

A small Recharts donut: Cash vs Credit split.
- Cash slice green #059669, Credit slice amber #D97706
- Center label: total. Legend below with ৳ amounts in DM Mono.
- Card title: "পেমেন্ট ব্রেকডাউন / Payment Breakdown"

### 1d. Top selling medicines list

A clean ranked list (top 5) from the period's transactions:
- Rank number in a small green circle, medicine name, units sold, ৳ revenue
- Thin divider between rows, DM Mono for numbers

Keep the existing date presets (Today/Yesterday/Week/Month) and date pickers —
just restyle them to match (rounded-xl pills, green active state).

---

## PART 2 — MULTI-SHOP COMPARISON (the new headline feature)

Show this section ONLY when `hasMultipleShops()` is true AND the user is premium.
It lets the owner compare any day/period across all their shops.

### 2a. Section header
"দোকান তুলনা / Shop Comparison" with a small store icon.
A date control: "কোন দিন? / Which day?" defaulting to today, with the same
Today/Yesterday/Week/Month presets. The comparison respects this selected period.

### 2b. Read each shop's data without switching shops

Use the existing helper — do NOT change the active shop:

```ts
import { getActiveShops } from "../utils/shopManager";
import { readShopKey } from "../utils/shopStorage";

function getShopComparison(startDate: string, endDate: string) {
  return getActiveShops().map((shop) => {
    const txns = JSON.parse(readShopKey(shop.id, "transactions") || "[]");
    const inRange = txns.filter((t) => {
      const d = new Date(t.timestamp);
      return d >= new Date(startDate) && d <= new Date(endDate + "T23:59:59");
    });
    const totalSales = inRange.reduce((s, t) => s + (t.total || 0), 0);
    const txnCount = inRange.length;
    return { shop, totalSales, txnCount, avgSale: txnCount ? totalSales / txnCount : 0 };
  }).sort((a, b) => b.totalSales - a.totalSales);
}
```

### 2c. The comparison visualization — horizontal bar race

A beautiful horizontal bar chart, one bar per shop, sorted highest first:

```
Each shop row:
  - Shop name (left, Hind Siliguri 600, 14px) + its ৳ total (right, DM Mono, bold)
  - Below: a horizontal bar, height 28px, rounded-full
    width = (shop total / highest shop total) * 100%
    The #1 shop bar: gradient #059669 → #065F46
    Other bars: solid #10B981 at 70% opacity
  - A subtle count label inside/after the bar: "{txnCount} বিল"
  - Animate bar width from 0 to full on load (transition 600ms ease-out)

Above the bars: a combined total strip —
  "সব দোকান মিলে / All Shops Combined: ৳{grandTotal}" — DM Mono, prominent
```

### 2d. Side-by-side stat cards (below the bars)

A horizontal scroll row of compact per-shop cards, each:
```
White card, rounded-2xl, 140px wide, border-l-4 in a distinct color per shop:
  Shop name (truncated)
  ৳ {totalSales} — DM Mono 18px bold green
  {txnCount} লেনদেন — 11px gray
  গড় ৳{avgSale} — 11px gray
  A tiny "#1" / "#2" rank badge top-right; #1 gets a green crown-ish badge
```

### 2e. The winner callout

A small celebratory line under the chart:
"🏆 {topShop.name} আজ সবচেয়ে বেশি বিক্রি করেছে" /
"🏆 {topShop.name} sold the most" — warm, green, Hind Siliguri.

Use the brand voice — celebratory but calm, never flashy.

---

## DATA NOTES

- All currency uses DM Mono, ৳ symbol, English numerals, comma separators.
- The comparison reads each shop's `transactions` via `readShopKey` — it never calls
  `setActiveShopId`, so the owner's current shop context is untouched.
- "Previous period" for the trend pill = the equivalent prior range (last week vs
  this week, etc.) computed from the same transactions.
- If a shop has zero sales in the period, show its bar as a thin empty track with
  "৳0" — do not hide it; the owner wants to see which shop underperformed.

---

## WHAT NOT TO CHANGE

- The sales/profit/cash/credit calculations — reuse the existing `salesData` logic
- The CSV download and share handlers
- The shop storage / namespacing layer
- Auth/permission gating already on the screen
- The route or navigation

---

## LIBRARIES

Recharts is available. Import what you need:
`import { AreaChart, Area, XAxis, Tooltip, PieChart, Pie, Cell, ResponsiveContainer } from "recharts";`
For the shop comparison bars, plain styled divs with animated width are lighter than
a chart library and give you full control of the brand look — use divs, not Recharts,
for Part 2c.
