# Muthoy (মুঠোয়) — Show the User's Plan (Free / Pro / Ultra)

Display the user's current plan as a small badge so they always know what they're on.
The plan store already exists (utils/planStore.ts) — use it. Do NOT build new state.

## Source of truth (already built — use as-is)
- `effectiveTier()` -> "free" | "pro" | "ultra" (returns "ultra" during the 14-day trial)
- `getPlanState().tier` -> the raw subscribed tier
- `isTrialActive()` / `getTrialDaysLeft()` -> trial status
- The store fires a `plan-updated` event on change.

Rule for what to SHOW:
- If `isTrialActive()` -> show "ট্রায়াল / Trial" badge (since trial unlocks everything;
  do NOT show "Ultra" during trial — show it as Trial so it's honest).
- Else show the raw tier from `getPlanState().tier`: "ফ্রি / Free", "প্রো / Pro",
  or "আল্ট্রা / Ultra".

## Brand tokens
Brand Green #059669, Deep Green #065F46, light #10B981, Soft Green #ECFDF5,
amber #D97706 / bg #FEF3C7, #6B7280, white. Fonts: Hind Siliguri (Bangla),
Plus Jakarta Sans (English).

## Badge styles per tier
- FREE: subtle — bg rgba(white,0.15) on the green header (or #F1EFE8 on light),
  text white/#6B7280, no icon. Understated (it's the base plan).
- PRO: brand green fill #059669 (or on the green header, white fill with #065F46
  text), small check/badge icon. Clearly "paid".
- ULTRA: gradient #10B981 -> #065F46 fill, white text, a small crown icon. Premium.
- TRIAL: amber pill (#FEF3C7 bg, #92400E text), text "ট্রায়াল • {n} দিন বাকি"
  (Trial • n days left) using getTrialDaysLeft().

Small pill: rounded-full, ~11-12px text, 2px/8px padding, 48dp-safe if tappable.

## POSITION (primary)
In the MorningDashboard header (the #047857 bar, ~line 514), next to the shop name /
greeting. Layout: shop name on the left, the plan badge immediately after it. On the
green header use the white-fill variants so it stays legible.

Tapping the badge navigates to /app/plans (so it doubles as an upgrade entry point).

## SECONDARY placements (nice to have, optional)
- Settings screen: a row "আপনার প্ল্যান / Your Plan" showing the same badge + an
  "আপগ্রেড / Upgrade" link (hidden if already Ultra).
- Plans screen: mark the user's current tier with a "বর্তমান / Current" tag on its
  card (the Plans screen already has currentTier state — wire it to
  getPlanState().tier so it reflects reality).

## Make it a reusable component
Create `components/PlanBadge.tsx`:

  import { effectiveTier, getPlanState, isTrialActive, getTrialDaysLeft } from "../utils/planStore";

  export function PlanBadge({ onLight = false }: { onLight?: boolean }) {
    // read trial/tier, pick label + style, render a pill.
    // re-render on "plan-updated" and "activeShopChanged" via a small useEffect+useState.
  }

Use <PlanBadge /> in the dashboard header, Settings, etc. It listens for `plan-updated`
so it refreshes instantly when the user upgrades.

## VERIFY
1. New user in trial -> badge shows "ট্রায়াল • 14 দিন বাকি" (amber).
2. Trial ended, no upgrade -> badge shows "ফ্রি / Free".
3. After upgrading to Pro (upgradePlan("pro")) -> badge instantly shows "প্রো / Pro"
   (green) without reload (plan-updated event).
4. Ultra -> gradient badge with crown.
5. Tapping the badge opens /app/plans.
6. Money/number font rules unaffected; build clean.

## What not to change
- planStore.ts logic (just consume it).
- The gating logic (this is display only).
- Header layout beyond adding the badge.
