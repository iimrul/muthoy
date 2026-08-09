# Portable POS — পোর্টেবল পস
### Mobile Pharmacy Point-of-Sale System

A comprehensive mobile POS application designed specifically for small pharmacy owners in Bangladesh. Built with React, TypeScript, Tailwind CSS, and React Router.

---

## 🎯 Project Overview

**Portable POS** is a mobile-first Android application that makes pharmacy management accessible to owners who have never used business software before. The app provides a warm, trustworthy experience with Bangla-first language support and simplified workflows.

**Product Promise:** Make the pharmacy owner's life measurably easier within the first day of use.

---

## 🎨 Brand Identity

### Wordmark
- **"Portable"** — Plus Jakarta Sans, ExtraBold (800), #111827 (Gray-900)
- **"POS"** — Plus Jakarta Sans, ExtraBold (800), #059669 (Green-600)

### Color Palette

| Color Name | Hex Code | Usage |
|------------|----------|-------|
| Brand Green | #059669 | Primary buttons, active states, headers |
| Deep Green | #065F46 | Pressed states, dark headers |
| Soft Green | #ECFDF5 | Screen backgrounds, card tints |
| Rich Black | #111827 | Body text, high-contrast elements |
| Mid Gray | #6B7280 | Secondary text, placeholders |
| White | #FFFFFF | Card surfaces, input backgrounds |
| Error | #DC2626 | 30-day expiry alerts, critical errors |
| Warning | #D97706 | Expiry warnings, stock alerts |
| Info | #2563EB | Sync status, informational states |

### Typography

**English Text:**
- Font: Plus Jakarta Sans (400, 600, 700, 800)
- Sizes: Display (32px), Headline (24px), Title (18px), Body (14px), Label (12px)

**Bangla Text:**
- Font: Hind Siliguri (400, 600, 700)
- Sizes: Display (30px), Headline (22px), Body (15px), Label (12px)

**Currency/Numbers:**
- Font: DM Mono (400, 500)
- Format: ৳ XX,XXX.XX (Bengali Taka symbol + space + English numerals)

---

## 📱 Screens Included

### Authentication Flow
1. **Registration** (`/`) — Shop name and phone number capture
2. **OTP Verification** (`/otp`) — 6-digit SMS verification
3. **PIN Setup** (`/pin-setup`) — 4 or 6 digit PIN creation with biometric option
4. **PIN Login** (`/login`) — Daily login screen

### Main Application (`/app/`)
5. **Morning Dashboard** (`/app`) — Primary home screen with daily summary
6. **Sale Entry** (`/app/sale`) — Medicine search and selection
7. **Cart** (`/app/cart`) — Shopping cart with quantity management
8. **Checkout** (`/app/checkout`) — Payment processing (cash/credit/split)
9. **Inventory Management** (`/app/inventory`) — Stock overview and management
10. **Expiry Management** (`/app/expiry`) — Urgent and early warning expiry tracking
11. **Credit Sales** (`/app/credit`) — Customer credit accounts overview
12. **End of Day Summary** (`/app/report`) — Daily sales report
13. **Monthly P&L Report** (`/app/monthly-report`) — Premium feature with lock screen
14. **Staff Management** (`/app/staff`) — Staff accounts and permissions
15. **Settings** (`/app/settings`) — Application configuration
16. **OCR Scan** (`/app/scan`) — Camera-based medicine scanning

---

## 🏗️ Technical Architecture

### Tech Stack
- **React 18.3.1** — UI framework
- **TypeScript** — Type safety
- **React Router 7.13.0** — Navigation (Data Mode pattern)
- **Tailwind CSS 4.1.12** — Styling
- **Lucide React** — Icons
- **Radix UI** — Accessible component primitives

### Project Structure
```
/src/app/
├── screens/           # All 16 screen components
│   ├── Registration.tsx
│   ├── OTPVerification.tsx
│   ├── PINSetup.tsx
│   ├── PINLogin.tsx
│   ├── MorningDashboard.tsx
│   ├── SaleEntry.tsx
│   ├── Cart.tsx
│   ├── Checkout.tsx
│   ├── Inventory.tsx
│   ├── ExpiryManagement.tsx
│   ├── CreditSales.tsx
│   ├── EndOfDay.tsx
│   ├── StaffManagement.tsx
│   ├── Settings.tsx
│   ├── MonthlyReport.tsx
│   └── OCRScan.tsx
├── components/
│   ├── MainLayout.tsx  # Bottom navigation wrapper
│   └── ui/             # Reusable UI components
├── routes.tsx          # React Router configuration
└── App.tsx             # Root component

/src/styles/
├── fonts.css           # Font imports
├── theme.css           # Brand colors and CSS variables
├── tailwind.css        # Tailwind directives
└── index.css           # Global styles
```

---

## 🎯 Design Principles

1. **Never make users feel stupid** — Designed for first-time business software users
2. **Bangla first, plainly** — No jargon, no technical terms
3. **Warm, not clinical** — Trustworthy pharmacy experience
4. **5 taps maximum** — Any core workflow from home to completion
5. **One-handed operation** — All primary actions in thumb zone
6. **Plain language errors** — Every error has a description and clear action
7. **Offline-first** — Persistent sync status indicator

---

## 📐 Layout Specifications

### Grid System
- 8pt grid system
- Base viewport: 360dp width (portrait only)
- Responsive range: 360–414dp width

### Spacing Tokens
- Micro: 4pt
- XS: 8pt
- SM: 12pt
- MD: 16pt (screen margins, card padding)
- LG: 24pt (section gaps)
- XL: 32pt
- 2XL: 40pt
- 3XL: 48pt (minimum touch target)

### Touch Targets
- Minimum: 48×48dp (non-negotiable)
- Primary buttons: 48dp height
- Secondary buttons: 40dp height
- Input fields: 48dp height

### Border Radius
- Cards: 8dp
- Inputs: 4dp
- Pill buttons: 100dp (fully rounded)

---

## 🔄 Navigation Flow

```
App Launch
    ↓
[First time?]
    ├─ YES → Registration → OTP → PIN Setup → Morning Dashboard
    └─ NO  → PIN Login
              ↓
         Morning Dashboard
              ↓
   ┌──────┼──────────┬──────────┬────────┐
   ↓      ↓          ↓          ↓        ↓
 Sale   Inventory  Credit    Report  Settings
 Entry
   ↓
 Cart → Checkout → Confirm → Success
```

---

## 🎨 Component Highlights

### Bottom Navigation
5-tab navigation with icons and Bangla labels:
- হোম (Home)
- বিক্রয় (Sale)
- ইনভেন্টরি (Inventory)
- ক্রেডিট (Credit)
- রিপোর্ট (Report)

### Dashboard Cards
- White background (#FFFFFF)
- 8dp border radius
- 16dp padding
- Subtle shadow
- Color-coded badges for stock levels and alerts

### Alert Cards
- **Warning** (Amber): #FEF3C7 background, #D97706 border/text
- **Urgent** (Red): #FEF2F2 background, #DC2626 border/text
- **Success** (Green): #ECFDF5 background, #059669 border/text

### Badges & Pills
- Stock level badges: Green (healthy), Amber (low), Red (zero)
- Expiry badges: Amber pill with days remaining
- Overdue badges: Red pill "মেয়াদোত্তীর্ণ"

---

## 💡 Key Features

### Sale Entry
- Quick search with real-time filtering
- Camera OCR scanning
- Voice input option
- Recent and frequent medicine shortcuts
- Out-of-stock demand recording

### Inventory Management
- Color-coded stock levels
- Expiry badges (30-day and 60-day warnings)
- Low stock alerts
- Batch tracking
- FEFO (First Expiry, First Out) automatic selection

### Credit Management
- Customer-wise credit tracking
- Overdue indicators (>30 days)
- Payment history timeline
- Partial payment support

### Expiry Management
- Urgent section (30 days)
- Early warning section (31-60 days)
- Bulk discount application
- Supplier return tracking

### End of Day Report
- Total sales with trend comparison
- Expected cash in drawer
- Credit extended today
- Profit estimate
- Export options (Print, CSV, WhatsApp)

---

## 🔒 Premium Features

The following features are designed with a "lock and upgrade" treatment:

- Monthly P&L Report
- Supplier Invoice Management
- Expense Tracking
- Multi-shop Management
- Data Export (CSV/Excel)
- Bluetooth Thermal Printer

**Visual Treatment:**
- Lock icon overlay
- "প্রিমিয়াম ফিচার — আপগ্রেড করুন" badge in Brand Green
- Preview available, not completely blocked

---

## 🌐 Language Support

### Bangla-First Interface
- All UI copy in Bangla (Hind Siliguri font)
- Medicine names always in English
- Monetary values use English numerals (1, 2, 3) NOT Bengali numerals (১, ২, ৩)
- Format: ৳ (Taka symbol) + space + amount with comma separators

### Voice & Tone Examples

✓ **DO:**
- আজকের বিক্রয় শেষ হয়েছে। ড্রয়ারে ৳১৬,২০০ থাকার কথা।
- ৪টি ওষুধের মেয়াদ ৩০ দিনের মধ্যে শেষ হবে। এখনই ব্যবস্থা নিন।

✗ **DON'T:**
- দৈনিক রিকনসিলিয়েশন প্রক্রিয়া সম্পন্ন হয়েছে।
- Error 503: Server connection timeout.

---

## 🚀 Getting Started

### Installation
```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

### Environment
- Mobile-first design (360dp base width)
- Portrait orientation only
- Optimized for 2GB RAM devices
- Works in dim pharmacy environments
- Offline-first architecture

---

## 📱 Device Requirements

- **Screen Size:** 5.0–6.7 inch Android screen
- **Orientation:** Portrait only
- **RAM:** Minimum 2GB
- **OS:** Android 10+
- **Network:** Offline-capable with sync when online

---

## 🎨 Design System

### CSS Variables
All brand colors are defined in `/src/styles/theme.css`:

```css
--brand-green: #059669
--deep-green: #065F46
--soft-green: #ECFDF5
--rich-black: #111827
--mid-gray: #6B7280
--error: #DC2626
--warning: #D97706
--info: #2563EB
```

### Font Families
```css
--font-sans: 'Plus Jakarta Sans', sans-serif
--font-bangla: 'Hind Siliguri', sans-serif
--font-mono: 'DM Mono', monospace
```

---

## 📊 User Workflows

### Daily Morning Routine
1. Open app → PIN Login
2. View Morning Dashboard
3. Check yesterday's sales
4. Review expiry alerts
5. Check low stock items
6. Start taking sales

### Sale Workflow (Maximum 5 taps)
1. Tap "বিক্রয়" in bottom nav
2. Search or select medicine
3. Add to cart
4. Tap cart icon
5. Tap "চেকআউট করুন"
6. Select payment type → Confirm

### End of Day Routine
1. Tap "রিপোর্ট" in bottom nav
2. Review End of Day Summary
3. Verify cash in drawer
4. Export/Share if needed

---

## 🎯 Target Users

**Primary User:** Small pharmacy owner in Bangladesh
- Likely never used business software before
- Handles medicine while standing
- Needs one-handed operation
- Prefers Bangla interface
- Works in dim lighting conditions
- May have intermittent internet connectivity

**Secondary Users:** Staff members (Cashiers, Managers)
- Limited permissions based on role
- Fast sale entry workflow
- No access to sensitive reports

---

## 🔐 Security Features

- 4 or 6 digit PIN protection
- Biometric login option (fingerprint)
- Failed attempt tracking (max 5 attempts)
- OTP verification on registration
- Backup key for data recovery
- Remote wipe capability (with OTP confirmation)

---

## 📈 Future Enhancements (V2)

- Voice-to-text cart entry
- System-suggested stock thresholds
- Remote read-only web access links
- Conflict notification for offline edits
- Multi-language support (English)
- Advanced analytics dashboard

---

## 📄 License

This is a design implementation based on the Portable POS UI Design Guidelines v1.0.

---

## 👥 Credits

**Design System:** Based on SDLC v1.0 + Brand Guidelines v1.0
**Implementation:** React + TypeScript + Tailwind CSS
**Icons:** Lucide React
**Fonts:** Google Fonts (Plus Jakarta Sans, DM Mono, Hind Siliguri)

---

## 📞 Support

For questions or issues related to this implementation, please refer to the original design guidelines document at `/src/imports/portable-pos-ui-design-prompt.md`.

---

**Version:** 1.0  
**Last Updated:** April 2, 2026  
**Built with ❤️ for Bangladesh pharmacy owners**
