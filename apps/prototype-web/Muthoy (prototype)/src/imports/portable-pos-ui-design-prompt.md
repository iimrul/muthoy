# Portable POS — UI Design Prompt
### For Figma Make / Google Stitch / AI Design Tools
**Version:** 1.0 | **Prepared for:** UI generation tools | **Based on:** SDLC v1.0 + Brand Guidelines v1.0

---

## 1. PROJECT CONTEXT

You are designing the mobile UI for **Portable POS** (পোর্টেবল পস) — a pharmacy point-of-sale Android app built for small pharmacy owners in Bangladesh. The primary user is a pharmacy owner who has likely never used business software before. The app must feel as familiar and trustworthy as the best pharmacist in the neighbourhood — warm, plain, and always on their side.

**The product promise:** Make the pharmacy owner's life measurably easier within the first day of use.

**Design must work for:**
- One-handed operation on a 5.0–6.7 inch Android screen
- Portrait orientation only
- 2GB RAM devices, dim pharmacy environments
- Users switching between Bangla and English interfaces

---

## 2. BRAND IDENTITY (STRICT — DO NOT DEVIATE)

### Wordmark
- **"Portable"** — Plus Jakarta Sans, ExtraBold (800), color: #111827 (Gray-900)
- **"POS"** — Plus Jakarta Sans, ExtraBold (800), color: #059669 (Green-600)
- Tagline (English): "YOUR PHARMACY. SIMPLIFIED."
- Tagline (Bangla): "আপনার দোকানের বিশ্বস্ত সাথী"

### Colour Palette

| Name | Hex | Tailwind | Usage |
|---|---|---|---|
| Brand Green | #059669 | Green-600 | Primary buttons, active states, header backgrounds, key UI elements |
| Deep Green | #065F46 | Green-800 | Logo backgrounds, dark headers, icon gradient end, pressed states |
| Soft Green | #ECFDF5 | Green-50 | Screen backgrounds, card tints, success states, dashboard surfaces |
| Rich Black | #111827 | Gray-900 | Body text, high-contrast elements, primary labels |
| Mid Gray | #6B7280 | Gray-500 | Secondary text, captions, placeholder text, meta information |
| White | #FFFFFF | White | Card surfaces, input backgrounds, reversed text on green |
| Success | #059669 | — | Success states (same as Brand Green) |
| Error / Urgent | #DC2626 | Red-600 | 30-day expiry alerts, critical errors only |
| Warning / Expiry | #D97706 | Amber-600 | Expiry warnings, stock alerts (text on #FEF3C7 bg) |
| Info / Sync | #2563EB | Blue-600 | Sync status, informational states |

**Alert colour rule:** Warning-amber (#FEF3C7 background, #D97706 text) for expiry and stock alerts. **Never red for informational alerts.**

### Typography

| Role | Typeface | Size | Weight | Line Height |
|---|---|---|---|---|
| Display | Plus Jakarta Sans | 32sp | 800 | 1.1 |
| Headline | Plus Jakarta Sans | 24sp | 700 | 1.2 |
| Title | Plus Jakarta Sans | 18sp | 700 | 1.3 |
| Body | Plus Jakarta Sans | 14sp | 400 | 1.6 |
| Label | Plus Jakarta Sans | 12sp | 600 | 1.4 |
| Caption | Plus Jakarta Sans | 11sp | 400 | 1.5 |
| Currency/Mono | DM Mono | 13sp+ | 400/500 | — |
| Bangla Display | Hind Siliguri | 30sp | 700 | 1.3 |
| Bangla Headline | Hind Siliguri | 22sp | 700 | 1.4 |
| Bangla Body | Hind Siliguri | 15sp | 400 | 1.7 |
| Bangla Label | Hind Siliguri | 12sp | 600 | 1.4 |

**Critical rules:**
- All monetary values: DM Mono, minimum 18sp on dashboards and summaries
- Format: ৳ XX,XXX.XX (Taka symbol + space + amount with comma separators)
- Use English numerals (1, 2, 3) — NOT Bengali numerals (১, ২, ৩) — for monetary amounts
- Medicine names: always English, regardless of interface language
- UI copy: Bangla first (when Bangla mode is active)

### Spacing & Layout (8pt Grid System)

| Token | Value | Usage |
|---|---|---|
| Micro | 4pt | Internal icon gaps |
| XS | 8pt | Tight element spacing |
| SM | 12pt | Related element groups |
| MD | 16pt | Screen horizontal margin, card padding |
| LG | 24pt | Section gaps |
| XL | 32pt | Major section separation |
| 2XL | 40pt | Large spacing |
| 3XL | 48pt | Touch targets (minimum) |

- **Screen margin:** 16dp horizontal
- **Card padding:** 16dp all sides
- **Section gap:** 24dp between sections
- **Input height:** 48dp minimum
- **Button height:** Primary 48dp, Secondary 40dp
- **Touch target:** 48×48dp minimum (non-negotiable — app used standing, handling medicine)
- **Viewport base:** 360dp width
- **Border radius:** 8dp cards, 4dp inputs, 100dp pill buttons

### App Icon
- Bold "P" monogram
- Gradient: Green-500 (#10B981) top-left → Green-800 (#065F46) bottom-right
- Border radius: 22% of icon size (Android adaptive icon)

---

## 3. DESIGN PRINCIPLES

1. **Never make users feel stupid.** Every screen is designed for someone who has never used business software before.
2. **Bangla first, plainly.** All UI copy, error messages, alerts in Bangla. No jargon. No technical terms.
3. **Warm, not clinical.** This is a pharmacy. It keeps people well. Design with care.
4. **5 taps maximum** for any core workflow from home screen to completion.
5. **One-handed operation.** All primary actions in the thumb zone.
6. **Every error has a plain-language description and one clear action.** No error codes ever.
7. **Offline-first visual language.** Persistent, non-intrusive sync status indicator visible everywhere.

### Voice & Tone Examples
| ✓ DO | ✗ DON'T |
|---|---|
| আজকের বিক্রয় শেষ হয়েছে। ড্রয়ারে ৳১৬,২০০ থাকার কথা। | দৈনিক রিকনসিলিয়েশন প্রক্রিয়া সম্পন্ন হয়েছে। |
| ৪টি ওষুধের মেয়াদ ৩০ দিনের মধ্যে শেষ হবে। এখনই ব্যবস্থা নিন। | সতর্কতা! এক্সপায়ারি অ্যালার্ট! |
| কিছু একটা ভুল হয়েছে। আবার চেষ্টা করুন। | Error 503: Server connection timeout. |
| দারুণ! আজকের বিক্রয় ৳১৮,৪৫০ — গতকালের চেয়ে ১২% বেশি। | আজকের মোট রাজস্ব: ৳১৮,৪৫০। |

---

## 4. SCREENS TO DESIGN

Design the following **16 screens** as a complete UI kit. Each screen should reflect authentic pharmacy owner usage scenarios.

---

### SCREEN 1: Registration / Onboarding

**Purpose:** First-time setup. Captures only shop name and phone number.

**Layout:**
- Full-screen, white background
- Portable POS wordmark centered, top 30% of screen
- Tagline below wordmark: "আপনার দোকানের বিশ্বস্ত সাথী"
- Two input fields only:
  - "দোকানের নাম" (Shop Name)
  - "ফোন নম্বর" (Phone Number) — with +880 prefix auto-filled
- Primary CTA button: "শুরু করুন" (Get Started) — Brand Green, full width, 48dp height
- Footer: "রেজিস্ট্রেশন করে আপনি আমাদের শর্তাবলী এবং গোপনীয়তা নীতিতে সম্মত হচ্ছেন"

**Visual notes:**
- No address, no owner name, no shop type fields (these are optional and added later)
- Green header bar at top with wordmark on white
- Input fields: 48dp height, 4dp border radius, #6B7280 placeholder text
- Subtle illustration or icon conveying "pharmacy / trust" above the form — clean, not clipart

---

### SCREEN 2: OTP Verification

**Purpose:** Verifying phone number via 6-digit SMS code.

**Layout:**
- Header: Back arrow + "নম্বর যাচাই করুন" (Verify Number)
- Subtext: "আপনার +880 XXXXX XXXXX নম্বরে একটি কোড পাঠানো হয়েছে"
- 6 individual digit input boxes in a row — each 48×56dp, auto-advance
- Active box: Brand Green border (#059669), 2dp
- Filled box: Soft Green background (#ECFDF5)
- Resend link: "কোড পাননি? ৩০ সেকেন্ড পরে পুনরায় পাঠান" — with countdown timer
- Error state: Red border on all boxes + "ভুল কোড। আবার চেষ্টা করুন।"
- Lock state (after 3 attempts): "১০ মিনিট পর আবার চেষ্টা করুন।"

---

### SCREEN 3: PIN Setup

**Purpose:** Setting a 4 or 6 digit PIN after OTP verification.

**Layout:**
- Header: "PIN সেট করুন"
- Subtext: "প্রতিদিন দ্রুত লগইনের জন্য"
- Toggle: 4-digit vs 6-digit (pill toggle, Green-600 active state)
- PIN input: Large circular dots (filled/unfilled), centered
- Numeric keypad below — large touch targets (min 72×72dp per key)
- Skip option: "এখনের জন্য বাদ দিন" — mid-gray text, bottom center
- If device supports biometric: "ফিঙ্গারপ্রিন্ট দিয়ে লগইন চালু করুন" — toggle below PIN input
- Confirm PIN step: Re-enter for confirmation

**Keypad design:**
- Keys: Large numerals, Plus Jakarta Sans Bold
- Delete key: Backspace icon
- Background: White keys on Soft Green (#ECFDF5) surface

---

### SCREEN 4: Morning Dashboard (Primary Brand Moment)

**Purpose:** The most-seen screen. Must be absorbable in under 30 seconds. Owner sees this every morning.

**Header:**
- Brand Green (#059669) background, full width
- Greeting: "শুভ সকাল, রহিম ভাই 👋" — Hind Siliguri, Weight 300, 18sp, white
- Sub-header: "আজকের শুরু" — Hind Siliguri, Weight 700, 24sp, white
- Sync status indicator (top right): small dot — green = synced, gray = offline, blue = syncing

**Dashboard sections (cards on Soft Green #ECFDF5 background):**

**Card 1 — Yesterday's Summary**
- Label (12sp, #6B7280): "গতকালের বিক্রয়"
- Amount (DM Mono, 32sp, #111827): ৳ ১৮,৪৫০
- Trend line: "↑ গতকাল ভালো ছিল" — Brand Green text, 12sp

**Card 2 — Expected Cash in Drawer**
- Label: "ড্রয়ারে প্রত্যাশিত"
- Amount (DM Mono, 28sp): ৳ ১৬,২০০
- Sub-info: "বাকি ৳ ২,২৫০ · ৩ জন" — amber colored

**Card 3 — Expiry Alert** (amber card: #FEF3C7 background, #D97706 text)
- Warning icon (⚠ amber)
- Text: "৪টি ওষুধ · ৩০ দিনের মধ্যে"
- Tap to expand → shows medicine list

**Card 4 — Low Stock Alert** (amber card)
- Box icon
- Text: "৭টি ওষুধ · অর্ডার করুন"
- Tap to expand → reorder list

**Card 5 — Outstanding Credit** (if any)
- Person icon
- Text: "৩ জন বাকি আছেন · মোট ৳ ৪,৫০০"
- Overdue flag (red dot) for accounts past 30 days

**Visual rules for dashboard:**
- Each card: white surface, 8dp border radius, 16dp padding, subtle shadow
- Sections with no data: completely hidden (no empty headers)
- First-day state: Welcome message with setup prompts, not empty cards

**Bottom Navigation Bar:**
- 5 tabs: Home (dashboard) · বিক্রয় (Sale) · ইনভেন্টরি (Inventory) · ক্রেডিট (Credit) · রিপোর্ট (Report)
- Active tab: Brand Green icon + label
- Inactive: #6B7280

---

### SCREEN 5: Sale Entry — Search State

**Purpose:** The fastest possible medicine-to-cart flow. The primary daily workflow.

**Header:**
- Brand Green bar
- Title: "বিক্রয়" (Sale)
- Cart icon (top right) with item count badge

**Search bar:**
- Full-width, 48dp height, white background, 4dp border radius
- Placeholder: "ওষুধের নাম লিখুন বা স্ক্যান করুন..."
- Left icon: search magnifier
- Right icons: Camera (OCR scan) + Microphone (voice) — both 24dp touch areas

**Shortcut pills (before any search):**
- "সম্প্রতি বিক্রয়" (Recently Sold) — horizontal scroll pill row
- "বেশি বিক্রয়" (Frequently Sold) — second pill row
- Medicine name pills: white background, Brand Green border, 12sp text

**Search results list:**
- Each result row: 64dp height
  - Medicine name (English, 14sp Bold, #111827)
  - Generic name + Manufacturer (12sp, #6B7280)
  - Price (DM Mono, 14sp, #059669): ৳ XX.XX
  - Stock quantity badge (right): "৩৪ pcs" — Soft Green pill
- Out-of-stock medicine: grayed out + "স্টক নেই" badge + "চাহিদা রেকর্ড করুন" button
- "জেনেরিক দেখুন" (Show Generics) button on each result

**Manual entry prompt (at bottom of results):**
- "এই ওষুধটি পাওয়া যাচ্ছে না? নিজে যোগ করুন" — text link

---

### SCREEN 6: Sale Entry — Cart State

**Purpose:** Cart in progress, showing medicines added with quantities and running total.

**Header:**
- Same green header
- "কার্ট" (Cart) with item count

**Cart items list:**
- Each row:
  - Medicine name (14sp Bold)
  - Quantity stepper: − [2] + (each element 40×40dp minimum)
  - Price (DM Mono): ৳ ৪৫.০০
  - Trash icon (right, red, 24dp)
- Swipe left to delete (with red delete action)

**Running total bar (sticky bottom, above checkout button):**
- "মোট" label + DM Mono total
- Updates in real time

**Primary CTA: "চেকআউট করুন" (Checkout)**
- Brand Green, full width, 48dp, rounded 100dp (pill)
- Disabled state: Gray-300 when cart is empty

**Add more medicines:** Search bar remains accessible at top

---

### SCREEN 7: Checkout & Payment

**Purpose:** Final sale confirmation. Must be completable in 1–2 taps.

**Layout:**

**Itemised summary:**
- Each line: medicine name | qty | unit price | discount (if any) | line total
- Discount row (if applied): "-৳ X.XX" in green
- Subtotal, Discount, **Total** — clear hierarchy

**Payment type selector (pill toggle):**
- "নগদ" (Cash) | "বাকি" (Credit) | "আংশিক" (Split)

**Cash payment state:**
- Input: "দেওয়া হয়েছে" — amount tendered
- Auto-calculated: "ফেরত" (Change) — DM Mono, large, green

**Credit/Split state:**
- Customer selector: Search/select from directory, or "+ নতুন গ্রাহক" (New Customer) inline
- Credit amount field (for split)

**Discount section (collapsible):**
- Per-item discount toggle
- Cart-wide discount toggle
- Reason code dropdown: "লয়্যালটি / ডাক্তারের রেফারেল / বাল্ক / কাছাকাছি মেয়াদ / অন্যান্য"

**Confirm button:**
- "বিক্রয় নিশ্চিত করুন" — Brand Green, full width, 48dp
- Debounce: Cannot be double-tapped

---

### SCREEN 8: Inventory Management

**Purpose:** Owner views all stock, adds new stock, sees low-stock alerts.

**Header:** "ইনভেন্টরি" (Inventory) + Filter icon + Add Stock (+) FAB

**Filter/Sort bar (horizontal scroll):**
- Chips: All · Low Stock · Expiring · Out of Stock · Discontinued

**Medicine list:**
- Each row (72dp):
  - Medicine name (14sp Bold) + Generic name (12sp gray)
  - Stock quantity (right): large number, DM Mono
    - Green if above threshold
    - Amber if below threshold (low stock)
    - Red if zero (out of stock)
  - Expiry badge (if within 60 days): amber pill "৩০ দিন"
  - Tap to expand: batch details, expiry per batch, purchase price

**Reorder list section (collapsible card):**
- Header: "আজকে অর্ডার করুন" — X medicines
- Shows combined low stock + demand events + sales velocity

**Add Stock FAB (bottom right):**
- Brand Green circle, + icon
- Opens bottom sheet: Medicine name, Quantity (required), Batch #, Expiry date, Purchase price — all optional except quantity
- "স্টক আপডেট করুন" button

---

### SCREEN 9: Expiry Management

**Purpose:** Track near-expiry medicines, take action to discount or return.

**Header:** "মেয়াদ ব্যবস্থাপনা" (Expiry Management)

**Two sections:**

**Urgent (30 days) — Red-tinted card header:**
- Background: #FEF2F2, border: #DC2626
- "জরুরি — ৩০ দিনের মধ্যে মেয়াদ শেষ"
- Medicine rows: name, batch, expiry date, qty, "ছাড় দিন / সরবরাহকারীকে ফেরত" action buttons

**Early Warning (31–60 days) — Amber-tinted card header:**
- Background: #FEF3C7, border: #D97706
- "সতর্কতা — ৬০ দিনের মধ্যে মেয়াদ শেষ"

**Bulk action button (if 30-day items exist):**
- "সব মেয়াদোত্তীর্ণ আইটেমে ছাড় দিন" — shows affected list before applying

**FEFO note:** All sales automatically draw from nearest-expiry batch.

---

### SCREEN 10: Credit Sales & Customer List

**Purpose:** Outstanding credit overview. Who owes money, how much, for how long.

**Header:** "বাকি বিক্রয়" (Credit Sales)

**Summary strip (top):**
- Total outstanding (DM Mono, large): ৳ ১২,৩৫০
- "X জন গ্রাহক" — customer count

**Customer list:**
- Each row (72dp):
  - Customer name (14sp Bold)
  - Last transaction date (12sp gray)
  - Outstanding amount (DM Mono, right, #111827)
  - Overdue badge: "মেয়াদোত্তীর্ণ" — red pill (if >30 days unpaid)
- Tap row → Customer detail with full payment history

**Customer detail (separate screen):**
- Name + phone + total credit given + current outstanding
- Timeline of all transactions
- "আংশিক পেমেন্ট যোগ করুন" button — Brand Green
- "পুরোপুরি পরিশোধিত" button — when balance hits zero

---

### SCREEN 11: End of Day Summary

**Purpose:** The "reward screen." One tap at closing. Complete daily picture.

**Header:**
- Brand Green background
- "আজকের সারসংক্ষেপ" (Today's Summary) — or "এখন পর্যন্ত" if accessed mid-day
- Date + time

**Summary cards (scrollable):**

**Hero card — Total Sales:**
- DM Mono, 40sp: ৳ ১৮,৪৫০
- Trend: "↑ গতকালের চেয়ে ১২% বেশি" — small green

**Row metrics:**
- Transactions: XX টি
- Average sale: ৳ XXX
- Total discounts: ৳ XXX (separate line)

**Cash in Drawer:**
- Expected: ৳ ১৬,২০০ (DM Mono, 24sp)
- Formula note: "শুরুর নগদ + নগদ বিক্রয় − ছাড় − ফেরত"

**Credit extended today:**
- Today's credit + customer list (collapsed, tapable)

**Profit estimate:**
- "আনুমানিক লাভ: ৳ X,XXX"
- If COGS incomplete: amber note "কিছু ওষুধের ক্রয় মূল্য নেই — আনুমানিক"

**Alerts:**
- Expiry alerts (amber)
- Low stock alerts (amber)
- Reorder suggestions

**Print / Export / Share button strip (bottom):**
- Icons: Printer | CSV/Excel | WhatsApp share

---

### SCREEN 12: Staff Management

**Purpose:** Owner creates staff accounts, sets permissions.

**Header:** "স্টাফ ব্যবস্থাপনা" (Staff Management) + Add Staff (+)

**Staff list:**
- Each card: Avatar initials circle + Name + Role + Last active
- Active indicator dot (green)
- Tap → Permission matrix editor

**Permission Matrix (full-screen bottom sheet):**
- Role name input
- Table: Feature areas as rows, CRUD as columns
- Feature rows: বিক্রয় / ছাড় / ফেরত / বাকি বিক্রয় / গ্রাহক / ইনভেন্টরি / মেয়াদ / রিপোর্ট / স্টাফ / সেটিংস
- Each cell: toggle (Green = permitted, Gray = denied)
- Preset buttons: "ম্যানেজার" / "ক্যাশিয়ার" (quick-fills the matrix)

---

### SCREEN 13: Settings

**Purpose:** All owner-level configuration. One screen, organized sections.

**Header:** "সেটিংস" (Settings)

**Sections (each collapsible):**

1. **দোকানের তথ্য** (Shop Profile) — name, address, owner name, shop type (optional)
2. **বিজ্ঞপ্তি** (Notifications) — toggle per alert type
3. **স্টক সীমা** (Stock Thresholds) — default low-stock threshold (default: 10)
4. **মেয়াদ সতর্কতা** (Expiry Warnings) — 30-day and 60-day windows, both configurable
5. **বাকি সময়সীমা** (Credit Overdue Period) — days before overdue flag
6. **ফেরতের সময়সীমা** (Refund Window) — maximum days for returns
7. **মুদ্রাস্ফীতি পদ্ধতি** (Costing Method) — FIFO / Weighted Average picker
8. **ভাষা** (Language) — Bangla / English toggle
9. **প্রিন্টার** (Printer) — Bluetooth pairing
10. **ব্যাকআপ কী** (Backup Key) — display + regenerate (with confirmation)
11. **দূরবর্তী মুছে ফেলুন** (Remote Wipe) — red, with OTP confirmation gate
12. **বন্ধের সময় সারসংক্ষেপ** (Closing Summary Prompt) — time picker (default: 9:00 PM)

---

### SCREEN 14: Monthly P&L Report

**Purpose:** Full profit and loss statement. Premium feature.

**Header:** "মাসিক লাভ-ক্ষতি" (Monthly P&L) + Month picker (← April 2026 →)

**P&L Statement (structured card):**

```
মোট বিক্রয় রাজস্ব          ৳ XX,XXX
− মোট ছাড়                   ৳  X,XXX
= নিট বিক্রয় রাজস্ব         ৳ XX,XXX
− বিক্রিত পণ্যের খরচ (COGS)  ৳ XX,XXX
= মোট লাভ                   ৳ XX,XXX
− পরিচালন ব্যয়
   ভাড়া                     ৳  X,XXX
   বেতন                     ৳  X,XXX
   ইউটিলিটি                 ৳    XXX
   অন্যান্য                  ৳    XXX
= নিট মুনাফা                ৳ XX,XXX
```

- Positive profit: Brand Green highlight on net profit line
- Negative profit: #DC2626 — no visual masking
- COGS incomplete warning: amber card below statement

**Month-over-month trend chart:**
- Simple bar chart per expense category: this month vs last month
- Uses Brand Green + Gray-200

**Export button:** "CSV / Excel রপ্তানি করুন"

---

### SCREEN 15: OCR Medicine Scan

**Purpose:** Point camera at medicine packaging to add to cart.

**Layout:**
- Full-screen camera viewfinder
- Green corner brackets as targeting overlay (not a full frame — just corners)
- Status text (bottom overlay, white): "প্যাকেজিং-এ ক্যামেরা ধরুন"

**Result states:**

**High confidence:**
- Bottom sheet slides up (60% of screen)
- Medicine name (large, Bold): Napa 500mg
- Generic, Manufacturer, Price
- Stock quantity
- "কার্টে যোগ করুন" — Brand Green button
- "বাদ দিন" — secondary button

**Low confidence:**
- Bottom sheet: "কোনটি সঠিক?" — 3 candidate list
- Each with name + price + stock

**Failure state:**
- Toast: "চিনতে পারা যাচ্ছে না। ম্যানুয়ালি খুঁজুন।"
- Manual search pre-filled with extracted text

**Privacy note (first use only):** "সব স্ক্যান আপনার ফোনেই হয়। কোনো ছবি সার্ভারে পাঠানো হয় না।"

---

### SCREEN 16: PIN Login (Daily)

**Purpose:** Fast daily login screen. Shown when app is reopened.

**Layout:**
- If multiple users on device: user selector cards first (name + initials avatar)
- PIN entry:
  - User avatar + name at top
  - Large PIN dots (filled/empty circles, 20dp each, 16dp gap)
  - Numeric keypad (same as PIN setup)
  - "অন্য অ্যাকাউন্ট" (Switch Account) — link bottom left
  - Biometric prompt (if enabled): fingerprint icon — "ফিঙ্গারপ্রিন্ট দিয়ে লগইন করুন"
  - Forgot PIN: "PIN ভুলে গেছেন?" — link bottom right

**Failed attempt feedback:**
- Dots shake animation
- "ভুল PIN। আরও X বার সুযোগ আছে।"
- After 5 failures: "OTP দিয়ে যাচাই করুন"

---

## 5. COMPONENT LIBRARY REQUIREMENTS

Generate reusable components for:

### Inputs
- Text input (default, focused, error, disabled states)
- Phone number input (with +880 prefix)
- PIN dot display (4-digit and 6-digit variants)
- Numeric keypad
- Date picker (calendar, Bangla labels)
- Quantity stepper (− N +)
- Currency input (৳ prefix, DM Mono)

### Buttons
- Primary (Brand Green, 48dp, pill or rounded-8)
- Secondary (outlined, Brand Green border)
- Destructive (red, for delete/wipe actions)
- Text link (mid-gray or Brand Green)
- FAB (Floating Action Button, Brand Green circle, + icon)
- Disabled state (Gray-300)

### Cards
- Dashboard summary card (white surface, 16dp padding, 8dp radius)
- Alert card — warning (amber: #FEF3C7 bg, #D97706 border)
- Alert card — urgent (red: #FEF2F2 bg, #DC2626 border)
- Success card (Soft Green #ECFDF5 bg, Brand Green border)
- Medicine list row (72dp height, name + price + stock)
- Staff card (avatar initials + name + role)

### Pills & Badges
- Stock level badge: Green (healthy) / Amber (low) / Red (zero)
- Expiry badge: Amber pill "X দিন"
- Overdue badge: Red pill "মেয়াদোত্তীর্ণ"
- Sync status dot: Green (synced) / Blue (syncing) / Gray (offline)
- Category chip (filter): active Brand Green fill, inactive outline

### Navigation
- Bottom navigation bar (5 tabs)
- Top app bar (Green header, back arrow, title, action icons)
- Bottom sheet (rounded top, drag handle, 16dp padding)

### Data Display
- P&L line item row (label + DM Mono amount, right-aligned)
- Transaction row (date + medicine + amount + staff)
- Permission toggle row (label + CRUD toggles)

### Status & Feedback
- Sync status indicator (persistent, small, top-right)
- Toast notification (bottom, auto-dismiss, 3 variants: success/warning/error)
- Loading skeleton (for medicine search list)
- Empty state (icon + Bangla message + action)
- First-day welcome state

---

## 6. INTERACTION PATTERNS

### Navigation
- **Owner login → Morning Dashboard** (always)
- **Staff login → Sale Entry screen** (always)
- **All primary workflows accessible in 5 taps or fewer from Home**

### Key Micro-interactions
- PIN entry: each dot fills with a bounce as number is pressed
- Cart checkout: success animation (checkmark) before clearing cart
- Search: results appear from first character, no submit tap
- OCR scan: green corners pulse while scanning
- Sync indicator: subtle pulse animation while syncing

### Offline State
- Persistent offline banner: non-intrusive, below top bar
- Bangla text: "অফলাইন মোড — সব ফিচার সচল"
- No feature silently fails — online-only features show "ইন্টারনেট প্রয়োজন" before attempting

### Error States
- Form validation: red border + Bangla error message inline (not a toast)
- Network failure: plain Bangla message + "আবার চেষ্টা করুন" button
- Permission denied: "আপনার এই ফিচারটি ব্যবহারের অনুমতি নেই। দোকানের মালিককে জিজ্ঞেস করুন।"

---

## 7. ACCESSIBILITY REQUIREMENTS

- **Touch targets:** Minimum 48×48dp for every interactive element
- **Text contrast:** Minimum 4.5:1 ratio (WCAG AA). Prefer Green-700 (#047857) for text on light surfaces in bright conditions
- **Typography:** Minimum body 14sp. Critical info (totals, alerts) minimum 18sp
- **Bangla rendering:** Hind Siliguri, renders correctly on Android 10+
- **One-handed operation:** All primary sale entry actions reachable in thumb zone
- **No error codes:** All errors in plain Bangla with a single recovery action

---

## 8. SCREEN FLOW SUMMARY

```
App Launch
    ↓
[First time?]
    ├─ YES → Registration → OTP → PIN Setup → Morning Dashboard
    └─ NO  → PIN Login (daily)
                  ↓
         [Owner?]─────[Staff?]
              ↓              ↓
      Morning         Sale Entry
      Dashboard       (direct)
         ↓
  ┌──────┼──────────┬──────────┬────────┐
  ↓      ↓          ↓          ↓        ↓
Sale   Inventory   Credit    Report  Settings
Entry  Management  Sales     (P&L)
  ↓
Cart → Checkout → Confirm → Success
```

---

## 9. FIGMA / STITCH SPECIFIC INSTRUCTIONS

1. **Set up 360dp frame width** as the base frame (Android phone, portrait)
2. **Create a local color styles library** using all hex values from Section 2
3. **Create text styles** for all type scale entries
4. **Use Auto Layout** throughout — components must be responsive within 360–414dp width range
5. **Create component variants** for all states: default, hover/pressed, disabled, error, loading
6. **Name layers in English**, following BEM-style convention: `component/variant/state`
7. **Group screens** by Epic (Authentication, Dashboard, Sale, Inventory, Credit, Reports, Staff, Settings)
8. **Prototype connections:**
   - Registration → OTP → PIN Setup → Morning Dashboard
   - Morning Dashboard → Sale Entry → Cart → Checkout → Success
   - Any screen → Settings
9. **Design both language states:** For key screens, create Bangla and English variants
10. **Annotate** any component that has a specific functional rule (e.g. "debounce on checkout button", "FEFO batch selection", "offline-capable")

---

## 10. PREMIUM / GATED FEATURES VISUAL TREATMENT

Some features are **Premium** (paid tier) or **V2** (future version). These screens still need to be designed but with a visual lock/upgrade treatment:

**Premium features to design with lock treatment:**
- Monthly P&L Report (Screen 14)
- Supplier Invoice Management
- Expense Tracking
- Multi-shop Management
- Data Export (CSV/Excel)
- Bluetooth Thermal Printer

**Visual treatment for Premium:**
- Feature card or screen still shown (not hidden)
- Soft overlay with lock icon
- "প্রিমিয়াম ফিচার — আপগ্রেড করুন" pill — Brand Green
- No broken or empty states — the feature is previewed, not blocked

**V2 features (show as "শীঘ্রই আসছে"):**
- Voice-to-text cart entry (F-008)
- System-suggested stock thresholds (US-029)
- Remote read-only web access links (F-022)
- Conflict notification for offline edits (US-065)

---

*End of UI Design Prompt — Portable POS v1.0*
*Based on: User Stories (Epic 1–14), Feature Definitions (F-001–F-035), Functional Requirements (FR-001–FR-224), Non-Functional Requirements (NFR-001–NFR-067), Brand Guidelines v1.0*
