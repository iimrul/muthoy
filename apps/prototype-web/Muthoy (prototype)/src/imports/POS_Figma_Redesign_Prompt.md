# Portable POS — Complete UI/UX Redesign Prompt for Figma
**Role:** Senior Product Designer · Pharmacy POS System (Mobile-First, Bangladesh Market)
**Version:** Restructured System v2.0

---

## 1. AUDIT FINDINGS — What's Broken in the Current System

Before designing, understand these structural problems you are solving:

### 1.1 Authentication & Login Flow — Critical Issues
- **Two separate storage keys for staff** (`staffMembers` and `staff`) with inconsistent data — code reads from both in different places, causing silent mismatches.
- **Staff login redirects to `/app/sale`** but the landing page is not a proper "staff dashboard" — a cashier lands on a raw sale screen with zero context (no greeting, no shift info, no today's stats).
- **Owner login (`/login`) and staff login (`/staff-login`) are two completely separate screens** but look nearly identical — the UX doesn't clearly differentiate the two access tiers.
- **No role selector on the landing/login screen** — users must know which URL to visit. New staff get confused.
- **`StaffPINLogin` screen is in the router but the file barely exists** — the flow breaks if someone navigates there.

### 1.2 Staff Management (Owner View) — Critical Issues
- **Staff sales don't appear in Today's Sale on the dashboard.** The `getStaffPerformance()` utility reads `salesHistory` and filters by `soldBy.type === "staff"`, but the dashboard only aggregates owner sales — staff-attributed sales are invisible to the owner in real time.
- **Staff sales are NOT included in the cash drawer (ExpectedCashCard).** The `cashCalculation` service only sums `ownerSales`. Staff-made sales create a cash drawer discrepancy every single day.
- **No "Today's Activity" per staff member** in the Staff Management screen. You can see all-time totals but not today's sales, today's transactions, or current shift status.
- **Permission toggles have no confirmation** — a single tap immediately disables a permission while the staff member is mid-shift with a customer.
- **No shift concept** — there's no clock-in/clock-out, no "currently working" indicator, and no way for the owner to see who is actively logged in right now.
- **Deleting a staff member permanently removes sales attribution.** Archived staff sales become unattributed in reports.

### 1.3 Staff Landing Page — Critical Issues
- **Staff who log in land on the Sale Entry screen** with full app chrome (sidebar nav) visible, but most nav items are locked. They see a list of links they can't use — confusing and unprofessional.
- **No shift summary for staff** — staff can't see "you've made ৳X in Y transactions today" without navigating elsewhere.
- **Staff logout is buried** — no clear end-of-shift button on the landing screen.
- **No identity confirmation on login success** — after logging in, there's no "Welcome, Rahim" confirmation page.

### 1.4 Dashboard — Owner View Issues
- **`todaySales` state on MorningDashboard only counts owner-made sales.** Staff sales are missing from the "Today's Sale" KPI card — the single most important number the owner looks at.
- **Cash drawer mismatch** — because staff sales aren't counted, the "Expected Cash" card shows a lower number than the actual cash in the drawer, every day.
- **No "Who is working today?" widget** on the owner dashboard.
- **No per-staff breakdown** on the dashboard — the owner must navigate to a separate "Staff Sales View" screen to see individual performance.

---

## 2. DESIGN SYSTEM — Brand & Tokens

Use these consistently across every screen.

### Color Palette
```
Primary Green:       #059669   (buttons, active states, brand)
Primary Dark:        #047857   (hover states, headers)
Accent Light:        #ECFDF5   (backgrounds, chips)
Accent Mid:          #D1FAE5   (card fills, success states)
Text Primary:        #111827
Text Secondary:      #6B7280
Text Muted:          #9CA3AF
Border Default:      #E5E7EB
Border Strong:       #D1D5DB
Surface White:       #FFFFFF
Surface Off-white:   #F9FAFB
Surface Page:        #F4F4F7
Error Red:           #DC2626
Error Light:         #FEE2E2
Warning Amber:       #F59E0B
Warning Light:       #FEF3C7
Info Blue:           #3B82F6
Owner Badge:         #7C3AED   (purple — visually distinct from staff green)
Staff Badge:         #059669
```

### Typography
```
Bangla font:   var(--font-bangla)    — all Bengali text
Mono font:     var(--font-mono)      — numbers, prices, PINs
UI font:       var(--font-ui)        — English UI labels
```

### Spacing & Radius
```
Card radius:   12px–16px
Button height: 48px (standard), 56px (primary CTA)
Input height:  52px
Page padding:  16px horizontal
Card gap:      12px
```

### Component Patterns
- **Status Badge:** Pill shape, 6px radius, 10px font, uppercase, bold
- **KPI Card:** White bg, 1px border `#E5E7EB`, 12px radius, label in muted uppercase, value in bold 28–32px mono
- **Avatar:** Circle, initials, color-coded by role (purple = owner, green = staff)
- **Bottom Sheet:** 24px top radius, handle bar, shadow `0 -4px 24px rgba(0,0,0,0.08)`

---

## 3. SCREEN-BY-SCREEN REDESIGN SPECIFICATIONS

---

### SCREEN A: App Entry / Role Selection Screen
**Route:** `/` (new landing gate)
**Replaces:** Direct redirect to `/register` or `/login`

**Purpose:** A single, beautiful entry screen that lets the user choose their role before anything else. Solves the "which URL do I go to?" problem.

**Layout:**
- Full screen, gradient bg: `#059669` → `#047857`
- Centered logo (pharmacy icon + app name) in top 35% of screen
- Shop name displayed below logo (read from localStorage `pharmacyRegistration.shopName`) — if not set, show "POS System"
- Bottom 50% is a white card with `border-radius: 32px 32px 0 0`, sliding up on load

**Inside white card:**
- Section label: "লগইন করুন" / "Select Login Type" in `#6B7280`, 12px uppercase
- **Owner Button** — full width, height 64px, white bg, `#7C3AED` left accent border (4px), icon: `Crown` (lucide), label: "মালিক" / "Owner", subtitle: "সম্পূর্ণ অ্যাক্সেস" / "Full Access"
- **Staff Button** — full width, height 64px, white bg, `#059669` left accent border (4px), icon: `UserCircle2`, label: "স্টাফ" / "Staff", subtitle: "শুধু অনুমোদিত ফিচার" / "Permitted features only"
- Both buttons have a `ChevronRight` icon on the right
- Spacing: 12px gap between buttons
- Footer: App version + "Powered by [AppName]" in `#9CA3AF` 11px

**Behavior:** Tapping Owner → navigate to `/login`. Tapping Staff → navigate to `/staff-login`.

---

### SCREEN B: Owner PIN Login
**Route:** `/login`
**Existing screen — needs refinement, not full rebuild**

**Issues to fix:**
- Add "← Back" button that goes to `/` (role selection), not nowhere
- Purple accent (`#7C3AED`) on the PIN keypad active state to visually remind this is owner-tier access
- Add small "Owner Access" badge with `Crown` icon near the header
- PIN dots should be larger (20px circles) and animate on each press (scale 1 → 1.3 → 1)

**Keep:** Overall layout, phone + PIN flow, language toggle

---

### SCREEN C: Staff Login
**Route:** `/staff-login`
**Existing screen — needs redesign**

**Issues to fix:**
- Replace phone number + PIN text form with a **Staff Selector + PIN** flow:
  1. Step 1: Show a grid/list of active staff avatars with names (loaded from `staffMembers` where `active: true`). Each card shows: avatar circle (initials + color), name, role. Staff tap their own name.
  2. Step 2: PIN entry keypad appears below (or as bottom sheet). Staff enters 4-digit PIN.
  - Fallback: "Enter manually" link opens the original phone + PIN form for edge cases.
- This eliminates the need to type a phone number on a small screen every shift.

**Layout:**
- Header: Green gradient, "স্টাফ লগইন" / "Staff Login", back button → `/`
- Staff grid: 2 columns, scrollable, each card 80px tall, avatar (44px circle) + name + role chip
- Selected state: card gets `#ECFDF5` bg + `#059669` border 2px + checkmark overlay on avatar
- PIN section: appears below grid after selection, "Enter your PIN" label, 4 large dot indicators, numeric keypad (same style as owner login but green accent)
- Error state: dots shake animation, red tint, "Wrong PIN" message

---

### SCREEN D: Staff Landing Page (Post-Login)
**Route:** `/app/staff-home` *(NEW SCREEN — does not exist yet)*
**Replaces:** Direct redirect to `/app/sale`

**Purpose:** A focused, shift-oriented home screen for staff. Professional POS feel.

**Layout — Full screen, white, no sidebar nav shown for basic staff:**

**Top Section (green gradient header, 180px):**
- "আস-সালামু আলাইকুম, [Staff Name]!" or "Good morning, [Name]!" — large greeting
- Subtitle: Role chip (e.g., "ক্যাশিয়ার") + "শিফট শুরু: [login time]" / "Shift started: [time]"
- Top-right: Notification bell

**Today's Summary Strip (white card, below header, sticky):**
- 3 mini KPI chips in a row:
  - "আজকের বিক্রয়" / "Today's Sales" → ৳[amount] (filtered by this staff's `soldBy.id` from `salesHistory`)
  - "লেনদেন" / "Transactions" → [count]
  - "গড় বিল" / "Avg. Bill" → ৳[avg]
- This data must read from `salesHistory` filtered by today's date AND `soldBy.id === currentStaff.id`

**Action Buttons (2×2 grid, large tap targets, 80px height each):**
- 🛒 "নতুন বিক্রয়" / "New Sale" — primary green, full width top row
- 📋 "বিক্রয় ইতিহাস" / "Sales History" — white bg, green border
- 💳 "ক্রেডিট" / "Credit Sales" — white bg (only shown if `permissions.sales`)
- 🔍 "স্ক্যান" / "Scan" — white bg

**Permitted Nav Items (bottom section):**
- Only show navigation items the staff actually has permission for
- Each as a list row with icon, label, arrow
- No hamburger menu or sidebar — keep it simple

**Footer:**
- "শিফট শেষ করুন" / "End Shift" button — outline red, full width, 48px
- Tapping shows a confirmation bottom sheet: "শিফট সারসংক্ষেপ" / "Shift Summary" with today's transactions list, total, and a "Logout" confirm button

---

### SCREEN E: Owner Dashboard (MorningDashboard — Restructured)
**Route:** `/app` (index)
**Existing screen — needs structural fixes**

**Critical data fixes (communicate to developer via this prompt):**

The `todaySales` calculation must be:
```
todaySales = sum of ALL salesHistory where date === today
             (both soldBy.type === "owner" AND soldBy.type === "staff")
```

The `expectedCash` calculation must include staff sales:
```
expectedCash = openingCash + ownerSales + staffSales - expenses - credit_given
```

**New Widget: "Today's Active Staff" card:**

Position: After the KPI row, before the inventory alerts section.

Layout — Horizontal scroll card row (each card 140px wide):
- Card per active-today staff member (appears in `salesHistory` today with their `soldBy.id`)
- Each card: staff avatar + name (truncated) + "৳[amount]" in green bold + "[N] bills" in muted
- If no staff sold today: show "আজ কোনো স্টাফ বিক্রয় করেনি" / "No staff sales today" empty state
- Tapping a staff card → navigates to `/app/staff/:id` (staff detail view)
- "সব দেখুন" / "See All" → `/app/staff`

**KPI Cards row — fix the numbers:**
- "আজকের বিক্রয়" / "Today's Sale" — MUST include staff sales
- "নগদ ড্রয়ার" / "Cash Drawer" — MUST include staff sales in calculation
- Keep existing cards for credit, inventory alerts

**Owner identity header:**
- Show "মালিক" / "Owner" badge with `Crown` icon + purple chip to clearly differentiate from staff view

---

### SCREEN F: Staff Management (Owner View — Restructured)
**Route:** `/app/staff`
**Existing screen — needs major restructuring**

**Tab Structure (3 tabs at top):**

**Tab 1: "স্টাফ তালিকা" / "Staff List"**

Header summary row (2 cards):
- Total staff count / Active count

Staff cards (replace current expand/collapse pattern):

Each staff card (full-width, white, 12px radius, 1px border):
```
[Avatar circle 48px] [Name (bold) + Role chip]         [Status toggle]
                     [Phone number in mono]
────────────────────────────────────────────────────────
[Today's Sale: ৳X]   [Transactions: N]   [Last active: Xm ago]
```

- Status toggle: green pill = active, gray = inactive. Toggling shows a confirmation sheet: "আপনি কি [Name]-এর অ্যাকাউন্ট নিষ্ক্রিয় করতে চান?" with an impact warning if they have an open session.
- Tap card body → opens Staff Detail Sheet (see Screen G)
- Long-press or swipe-left → reveals Edit and Delete actions

"+ স্টাফ যোগ করুন" / "+ Add Staff" FAB button (bottom right, green circle, 56px)

**Tab 2: "আজকের পারফরমেন্স" / "Today's Performance"**

Date selector (today default, can pick other dates — calendar picker)

Leaderboard list:
```
#1  [Avatar]  Rahim         ৳ 8,450   18 bills   ████████████ 92%
#2  [Avatar]  Karim         ৳ 6,200   14 bills   █████████    68%
#3  [Avatar]  Salam         ৳ 3,100    7 bills   █████        34%
    [Owner]   Owner (you)   ৳ 2,800    5 bills   ████         31%
```

- Bar is proportional to the top performer
- Tap any row → Staff Detail Sheet
- Total row at bottom: "মোট বিক্রয়" / "Total Sales" + sum

**Tab 3: "অনুমতি" / "Permissions"**

Grid of staff members, each row shows:
```
[Name]    Sales [✓]   Inventory [✓]   Reports [✗]   Settings [✗]
```
Toggle switches inline. All permission changes show a toast confirmation.

---

### SCREEN G: Staff Detail Sheet (New — Bottom Sheet)
**Triggered by:** Tapping a staff card in Screen F

**Bottom sheet, 90% screen height, draggable:**

**Header:**
- Large avatar (64px circle with initials)
- Name (bold 20px) + Role chip
- Status badge: "সক্রিয়" (green) or "নিষ্ক্রিয়" (gray)
- Edit button (top right)

**Stats tabs (3 tabs inside sheet):**

Tab "আজকে" / "Today":
- Sale amount, transaction count, avg bill
- Last transaction time
- List of today's transactions (mini receipt rows): time + items summary + amount

Tab "এই সপ্তাহ" / "This Week":
- Bar chart (7 days), daily amounts
- Week total, best day

Tab "সব সময়" / "All Time":
- Total sales, total transactions, avg bill
- Member since date
- Activity heatmap (optional, 12-week grid)

**Footer actions:**
- "অনুমতি পরিবর্তন" / "Edit Permissions" (opens inline permission toggles)
- "PIN রিসেট" / "Reset PIN" (owner can set a new PIN for this staff)
- "অ্যাকাউন্ট নিষ্ক্রিয়" / "Deactivate" (red, confirmation required)

---

### SCREEN H: Cash Drawer / Cash Summary (Fix Required)
**Route:** `/app/cash-summary`

**Current bug:** The cash calculation doesn't include staff sales.

**Redesigned Cash Breakdown Card:**

```
নগদ ড্রয়ার সারসংক্ষেপ
──────────────────────────────
শুরুর নগদ          ৳  2,000
+ মালিকের বিক্রয়   ৳  8,450    (owner sales today, cash only)
+ স্টাফের বিক্রয়   ৳ 14,200    (all staff sales today, cash only)  ← THIS IS NEW
- ক্রেডিট বিক্রয়   ৳  1,500    (credit given today)
- খরচ              ৳    450    (expenses logged today)
──────────────────────────────
প্রত্যাশিত নগদ     ৳ 22,700    ← This number was wrong before
```

Each line item tappable → drill-down list of transactions.

**Staff sales sub-breakdown (expandable):**
```
▼ স্টাফের বিক্রয়: ৳14,200
   Rahim     ৳ 8,450  (18 bills)
   Karim     ৳ 5,750  (14 bills)
```

---

### SCREEN I: Add Staff Modal (Redesign)
**Triggered from:** FAB on Screen F Tab 1

**Multi-step bottom sheet (3 steps):**

**Step 1 — Basic Info:**
- Name (Bangla) — text input
- Name (English) — text input  
- Phone number — tel input with +880 prefix
- Role — dropdown: ক্যাশিয়ার / ম্যানেজার / ফার্মাসিস্ট / কাস্টম
- Progress dots: ● ○ ○

**Step 2 — Set PIN:**
- "স্টাফের জন্য একটি ৪ ডিজিটের PIN সেট করুন"
- 4-dot PIN indicator
- Numeric keypad
- Confirm PIN step
- Progress dots: ● ● ○

**Step 3 — Permissions:**
- Toggle list with descriptions:
  - "বিক্রয়" / Sales — "নতুন বিক্রয় করতে পারবেন" — default ON
  - "ইনভেন্টরি" / Inventory — "ওষুধ যোগ/সম্পাদনা" — default OFF
  - "রিপোর্ট" / Reports — "রিপোর্ট দেখতে পারবেন" — default OFF
  - "স্টাফ" / Staff — "অন্য স্টাফ ম্যানেজ করতে পারবেন" — default OFF (manager role only)
  - "সেটিংস" / Settings — "সিস্টেম সেটিংস পরিবর্তন" — default OFF
- Progress dots: ● ● ●
- "স্টাফ যোগ করুন" / "Add Staff" green CTA button

---

## 4. NAVIGATION ARCHITECTURE — Restructured

### Owner Navigation (Sidebar / Bottom Nav)
```
Home (Dashboard)          /app
Sale Entry               /app/sale
Inventory                /app/inventory
Reports                  /app/report
Staff Management         /app/staff          ← Owner only
Cash Summary             /app/cash-summary
Credit Sales             /app/credit
Settings                 /app/settings
```

### Staff Navigation (Simplified — No Sidebar)
Staff see a custom home screen (Screen D) with only permitted action buttons. No sidebar. Navigation is task-focused:
```
Staff Home               /app/staff-home     ← NEW
New Sale                 /app/sale           (if sales permission)
Sales History            /app/sales-history  (if sales permission)
Inventory                /app/inventory      (if inventory permission)
Reports                  /app/report         (if reports permission)
```

### Auth Flow Map
```
App Load
  └─ Check localStorage for valid session
       ├─ Owner session → /app (Dashboard)
       ├─ Staff session → /app/staff-home
       └─ No session → / (Role Selection Screen A)
                          ├─ Owner → /login → /app
                          └─ Staff → /staff-login → /app/staff-home
```

---

## 5. DATA MODEL FIXES (For Developer Reference — Communicate in Figma Annotations)

### Unified Staff Data Key
**Problem:** Code uses both `staffMembers` and `staff` localStorage keys inconsistently.  
**Fix:** Standardize on `staffMembers`. Remove all reads from `staff` key.

### Sales Attribution (soldBy field)
Every sale in `salesHistory` must have:
```typescript
soldBy: {
  type: "owner" | "staff",
  id: string | number,
  name: string,
  phone: string
}
```
The `SaleEntry` screen must write this field. If logged in as owner, `type = "owner"`. If logged in as staff, `type = "staff"` with the current staff's ID.

### Today's Sales Aggregation (Dashboard Fix)
```typescript
// WRONG (current):
const todaySales = salesHistory
  .filter(s => isToday(s.timestamp) && s.soldBy?.type === "owner")
  .reduce((sum, s) => sum + s.total, 0);

// CORRECT (fixed):
const todaySales = salesHistory
  .filter(s => isToday(s.timestamp))  // ALL sales, regardless of who made them
  .reduce((sum, s) => sum + s.total, 0);
```

### Expected Cash Calculation Fix
```typescript
// cashCalculation.ts — add staffSales parameter:
export function calculateExpectedCash(
  openingCash: number,
  ownerSales: number,
  staffSales: number,   // ← ADD THIS
  creditGiven: number,
  expenses: number
): number {
  return openingCash + ownerSales + staffSales - creditGiven - expenses;
}
```

---

## 6. COMPONENT LIBRARY — Figma Components to Create

Create these as reusable Figma components with variants:

| Component | Variants |
|---|---|
| `StaffCard` | default, expanded, selected, inactive |
| `KPICard` | small (3-col), medium (2-col), large (full) |
| `RoleBadge` | owner (purple), manager (blue), cashier (green), inactive (gray) |
| `PermissionToggle` | on, off, loading, disabled |
| `ShiftSummaryStrip` | with data, empty state |
| `StaffPerformanceRow` | rank 1/2/3, regular, owner row |
| `LoginRoleButton` | owner, staff, hover/pressed states |
| `PINDot` | empty, filled, error, success |
| `StaffAvatarGrid` | unselected, selected, inactive |
| `CashBreakdownRow` | positive, negative, total |
| `BottomSheet` | 50%, 75%, 90% height variants |

---

## 7. INTERACTION & ANIMATION NOTES

- **Staff card tap:** 100ms scale `0.98` → back, sheet slides up from bottom
- **Permission toggle:** 200ms smooth toggle, toast notification fades in from top
- **PIN dot fill:** 80ms bounce scale on each keypress
- **Login success:** Green checkmark animates in (scale 0 → 1.2 → 1), then navigate after 400ms
- **Staff selector grid:** Selected card border animates in over 150ms, others dim to `opacity: 0.6`
- **Leaderboard bar:** Animate width from 0 to value over 600ms with stagger (100ms per row)
- **Cash breakdown expand:** Smooth height animation, rows fade in staggered

---

## 8. EMPTY STATES

Design empty states for:
- No staff added yet → illustration of a person + "স্টাফ যোগ করুন" button
- No sales today → clock illustration + "আজকের প্রথম বিক্রয় শুরু করুন"
- Staff logged in but no permissions → lock illustration + "মালিকের সাথে যোগাযোগ করুন"
- Staff login page with no active staff → "কোনো সক্রিয় স্টাফ নেই, ম্যানুয়ালি লগইন করুন" link

---

## 9. ACCESSIBILITY & LOCALIZATION

- All text must support both Bangla (`--font-bangla`) and English — design with the longer Bangla strings as the default (they are wider)
- Tap targets minimum 44×44px for all interactive elements
- Error states must use both color AND icon (never color alone)
- PIN inputs must never auto-fill or paste from clipboard (security)
- All currency values: use `৳` prefix (Bangladeshi Taka), Bangla numerals in Bangla mode
- Number display in Bangla mode: ১২,৩৪৫ format; English mode: 12,345

---

## 10. SCREENS SUMMARY — Figma Page Structure

Organize Figma pages as:

```
Page 1:  Design System (colors, type, components)
Page 2:  Auth Flow (Screens A, B, C)
Page 3:  Staff Landing Page (Screen D)
Page 4:  Owner Dashboard — Fixed (Screen E)
Page 5:  Staff Management — Restructured (Screen F)
Page 6:  Staff Detail Sheet (Screen G)
Page 7:  Cash Summary — Fixed (Screen H)
Page 8:  Add Staff Modal — Redesigned (Screen I)
Page 9:  Navigation Architecture (flow diagram)
Page 10: Empty States & Error States
```

---

*This prompt was generated from a full code audit of Portable POS v4 (React + localStorage). All screen references, data keys, and component names match the existing codebase. Hand this document to the developer alongside the Figma file for implementation.*
