# Muthoy (মুঠোয়) — Premium Screens
## Figma Make Prompts (design only — logic comes later in the real app)

Brand tokens to paste into Figma Make with every prompt:
- Brand Green #059669, Deep Green #065F46, gradient #10B981 → #065F46
- Soft Green bg #ECFDF5, Rich Black #111827, Mid Gray #6B7280, White #FFFFFF
- Warning amber #D97706 (bg #FEF3C7), Error #DC2626
- Fonts: Hind Siliguri (Bangla UI), Plus Jakarta Sans (English/numbers), DM Mono (currency ৳)
- 8pt grid, rounded-2xl/3xl cards, 48dp touch targets, 360dp width, Bangla-first voice

The three tiers:
- FREE: Sales, Inventory, Scan, 1 staff, 1 shop
- PRO ৳399/mo: + up to 3 shops, up to 4 staff per shop, supplier invoices, expenses,
  P&L, reports, data export, printer
- ULTRA ৳499/mo: unlimited shops, unlimited staff, priority support, everything

---

## SCREEN 1 — Pricing / Plans screen (the main upgrade page)

> Design a mobile pricing screen for a pharmacy POS app called "মুঠোয় / Muthoy".
> Full screen, soft green (#ECFDF5) background, Bangla-first.
>
> TOP: a small header "প্ল্যান বেছে নিন" / "Choose your plan" in Hind Siliguri bold,
> #111827. A short subtitle in Mid Gray: "আপনার দোকানের জন্য সঠিক প্ল্যান".
>
> A monthly/yearly toggle pill (yearly shows "২০% সাশ্রয়").
>
> THREE pricing cards stacked vertically (mobile), each rounded-3xl with generous
> padding:
>
> CARD 1 — FREE: white card, thin gray border. Title "ফ্রি / Free", price "৳০" in
> DM Mono large. Feature list with green check icons: বিক্রয় (Sales), ইনভেন্টরি
> (Inventory), স্ক্যান (Scan), ১ জন স্টাফ (1 staff), ১টি দোকান (1 shop). Button:
> outlined green "বর্তমান প্ল্যান / Current Plan" (disabled style if active).
>
> CARD 2 — PRO (make this the visually dominant / recommended card): gradient border
> or a subtle #ECFDF5→white fill, a "জনপ্রিয় / Popular" badge in brand green at the
> top-right. Title "প্রো / Pro", price "৳৩৯৯" DM Mono large + "/মাস". Features with
> green checks: ফ্রি-এর সবকিছু (everything in Free), ৩টি দোকান পর্যন্ত (up to 3
> shops), প্রতি দোকানে ৪ জন স্টাফ (4 staff per shop), সরবরাহকারী ইনভয়েস (supplier
> invoices), খরচ ট্র্যাকিং (expenses), মাসিক লাভ-ক্ষতি (monthly P&L), রিপোর্ট ও
> এক্সপোর্ট (reports & export), প্রিন্টার (printer). Button: filled gradient
> (#059669→#065F46) "প্রো নিন / Get Pro".
>
> CARD 3 — ULTRA: deep green (#065F46) card, white text, a small crown icon. Title
> "আল্ট্রা / Ultra", price "৳৪৯৯" DM Mono large + "/মাস". Features with white/light
> checks: প্রো-এর সবকিছু (everything in Pro), আনলিমিটেড দোকান (unlimited shops),
> আনলিমিটেড স্টাফ (unlimited staff), প্রায়োরিটি সাপোর্ট (priority support). Button:
> white filled with green text "আল্ট্রা নিন / Get Ultra".
>
> A small reassurance line at the bottom in Mid Gray: "যেকোনো সময় বাতিল করুন · ১৪
> দিনের ফ্রি ট্রায়াল" (cancel anytime · 14-day free trial).
>
> Style: clean, modern, premium feel. The Pro card should clearly draw the eye as
> the recommended choice. Use the green palette only — no other accent colors.

---

## SCREEN 2 — Feature comparison table

> Design a plan comparison screen for "মুঠোয় / Muthoy", mobile, soft green
> background. A clean comparison table with 4 columns: feature name (left, wide),
> then FREE, PRO, ULTRA. Rows for: বিক্রয় (Sales), ইনভেন্টরি (Inventory), স্ক্যান
> (Scan), দোকান সংখ্যা (Shops: 1 / 3 / আনলিমিটেড), স্টাফ সংখ্যা (Staff: 1 / 4 per
> shop / আনলিমিটেড), সরবরাহকারী ইনভয়েস (Supplier invoices: ✗ / ✓ / ✓), খরচ ও P&L
> (Expenses & P&L: ✗ / ✓ / ✓), রিপোর্ট ও এক্সপোর্ট (✗ / ✓ / ✓), প্রিন্টার (✗ / ✓ /
> ✓), সাপোর্ট (Support: সাধারণ / সাধারণ / প্রায়োরিটি). Use green check icons for
> included, light gray dash for not included. Header row in brand green. Pro column
> subtly highlighted. Sticky bottom bar with an "আপগ্রেড করুন / Upgrade" gradient
> button. DM Mono for the numbers.

---

## SCREEN 3 — Premium lock screen (shown when a free user taps a locked feature)

> Design a "premium feature locked" screen for "মুঠোয় / Muthoy", mobile, soft green
> background, centered content. A circular gradient (#059669→#065F46) icon badge with
> a white lock icon at top. Heading in Hind Siliguri bold #111827: "[ফিচারের নাম]
> প্রিমিয়াম ফিচার" (e.g. "খরচ ট্র্যাকিং প্রিমিয়াম ফিচার"). Sub-text in Mid Gray:
> "এই ফিচারটি ব্যবহার করতে প্রো বা আল্ট্রা প্ল্যানে আপগ্রেড করুন।" Two small inline
> plan chips showing "প্রো ৳৩৯৯" and "আল্ট্রা ৪৯৯" in DM Mono. A primary gradient
> button "প্ল্যান দেখুন / View Plans" and a text button below "ফিরে যান / Go Back".
> Calm, not aggressive — warm and encouraging tone.

---

## SCREEN 4 — Trial status banner + trial-ending state

> Design two small UI components for "মুঠোয় / Muthoy", on a soft green dashboard
> background:
> 1. TRIAL ACTIVE BANNER: a slim rounded card at the top of the dashboard, soft
>    amber (#FEF3C7 bg, #92400E text), text "ট্রায়াল চলছে — ৪ দিন বাকি" (trial
>    active, 4 days left) with a small "আপগ্রেড / Upgrade" link on the right.
> 2. TRIAL ENDED CARD: a full-width card, white with a green left border, heading
>    "আপনার ট্রায়াল শেষ হয়েছে" (your trial has ended), body "এখন আপনি বিক্রয়,
>    ইনভেন্টরি, স্ক্যান এবং ১ জন স্টাফ ব্যবহার করতে পারবেন। সম্পূর্ণ ফিচার ফিরে পেতে
>    আপগ্রেড করুন।" with a gradient "আপগ্রেড করুন" button. Friendly, non-punitive
>    tone — it lists what they CAN still do first, then offers upgrade.

---

## SCREEN 5 — Staff auto-deactivation notice (the staff downgrade rule)

> Design a Staff Management screen state for "মুঠোয় / Muthoy", mobile, soft green
> background. A list of staff members as cards. The FIRST staff card is normal/active
> (green "সক্রিয় / Active" badge). The remaining staff cards are visually dimmed
> (60% opacity) with an amber "নিষ্ক্রিয় / Inactive" badge and a small lock icon.
> At the top, an amber info card (#FEF3C7): "ফ্রি প্ল্যানে শুধু ১ জন স্টাফ সক্রিয়
> থাকে। বাকি স্টাফদের সক্রিয় করতে প্রো বা আল্ট্রা নিন।" (On Free, only 1 staff stays
> active. Upgrade to Pro or Ultra to reactivate the rest.) Each inactive card has a
> small "আপগ্রেড করে সক্রিয় করুন / Reactivate" link. A gradient "আপগ্রেড করুন"
> button fixed at the bottom. The first staff must look clearly usable; the rest
> clearly locked but not deleted.

---

## SCREEN 6 — Subscribe / payment method screen

> Design a checkout screen for "মুঠোয় / Muthoy", mobile, soft green background.
> Top: selected plan summary card (e.g. "প্রো — ৳৩৯৯/মাস") in a gradient card, white
> text, DM Mono price, with a small "পরিবর্তন / Change" link. Below, heading
> "পেমেন্ট মাধ্যম / Payment method". Two large tappable payment option cards:
> 1. "বিকাশ / bKash" — with space for the bKash logo, rounded card, selectable.
> 2. "কার্ড / মোবাইল ব্যাংকিং (SSLCommerz)" — bundles cards, Nagad, Rocket.
> A radio-style selection state (selected card gets a green border + check).
> Bottom: a summary line "মোট / Total: ৳৩৯৯" in DM Mono and a gradient "পেমেন্ট
> করুন / Pay Now" button. A small trust line: "নিরাপদ পেমেন্ট · যেকোনো সময় বাতিল".
> Clean, trustworthy, minimal.

---

## SCREEN 7 — Upgrade success screen

> Design a payment success screen for "মুঠোয় / Muthoy", mobile, soft green
> background, centered. A large green circular check badge (gradient
> #059669→#065F46) with a subtle celebratory feel (no confetti — keep it calm and
> premium). Heading "অভিনন্দন! আপনি এখন প্রো ব্যবহারকারী" (Congratulations, you're
> now a Pro user). Sub-text listing what just unlocked: "৩টি দোকান, ৪ জন স্টাফ,
> সরবরাহকারী ইনভয়েস, রিপোর্ট এবং আরও অনেক কিছু।" A primary gradient button "শুরু
> করুন / Get Started" returning to the dashboard. Warm, rewarding, on-brand.

---

## HOW TO USE THESE

1. Paste the brand tokens block + one screen prompt at a time into Figma Make.
2. Attach your existing app screenshots so it matches your established style.
3. Generate, refine, and keep these as your DESIGN reference.
4. IMPORTANT: these are screen DESIGNS only. The actual gating (who's on which plan,
   the 14-day trial countdown, auto-deactivating staff, real bKash/SSLCommerz
   payment) is built later in the React Native app + Supabase backend — Figma Make
   cannot make these function for real, only show how they look. The designs carry
   straight into the real build.

---

## THE PLAN LOGIC (for when you build it for real — reference)

- Trial: 14 days, ALL features (acts like Ultra).
- After trial with no upgrade → FREE: Sales, Inventory, Scan, 1 shop, 1 staff.
  The first-created staff stays active; all others auto-set inactive (not deleted)
  until upgrade.
- PRO ৳399/mo: up to 3 shops, up to 4 staff per shop, + supplier invoices, expenses,
  P&L, reports, export, printer.
- ULTRA ৳499/mo: unlimited shops, unlimited staff, priority support, everything.
- Downgrade Pro→Free or Ultra→Pro: same first-staff-stays rule applies per shop, and
  shops beyond the new limit become read-only archives (never deleted).
