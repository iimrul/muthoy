# Muthoy (মুঠোয়) — Redesign PIN Setup Screen

Redesign PINSetup.tsx to a beautiful, modern mobile PIN screen. Keep ALL existing
logic (PIN validation, confirm-match, auto-submit, register call, skip, strength
check) — only change the UI to the dots + custom keypad pattern below.

## Brand tokens
Brand Green #059669, Deep Green #065F46, light accent #10B981, Soft Green bg #ECFDF5,
Rich Black #111827, Mid Gray #6B7280, mint #A7F3D0/#D1FAE5, Error #DC2626.
Fonts: Hind Siliguri (Bangla), Plus Jakarta Sans (Latin/numbers via var(--font-sans)).

## New layout (top to bottom, centered, on #ECFDF5)
1. Standard header: translucent soft-green, centered title "PIN সেট করুন / Set PIN",
   left back chevron (#065F46). No language toggle needed here if not present.
2. Three-segment step indicator (green pills) — keep as is.
3. Gradient circular lock badge (68px, linear-gradient #10B981 -> #065F46, white lock icon).
4. Title "নিরাপত্তা PIN তৈরি করুন" (Hind Siliguri 500, #111827) + subtitle
   "৪ ডিজিটের একটি PIN দিন" (#6B7280).
5. FOUR PIN DOTS replacing the text inputs: each 15px circle. Filled = solid #059669;
   empty = white with a 2px #059669 border for the next-to-fill, #A7F3D0 border for
   the rest. Dots fill left-to-right as digits are entered.
6. Strength label below the dots (only when 4 digits): "শক্তিশালী PIN" green, or
   "দুর্বল PIN" red — reuse the existing pinStrength() logic.
7. CUSTOM NUMERIC KEYPAD (3x4 grid): keys 1-9, then [Skip] · 0 · [backspace].
   - Number keys: white rounded-2xl (16px radius), 52px tall, digit in #111827,
     22px, var(--font-sans). Active state: scale 0.96 + bg #D1FAE5.
   - Bottom-left cell = "এড়িয়ে যান / Skip" (text button, #6B7280) -> triggers the
     existing skip flow.
   - Bottom-right cell = backspace icon (#6B7280) -> removes last digit.
8. Fingerprint option pill at the bottom: dashed #A7F3D0 border, translucent white,
   fingerprint icon + "ফিঙ্গারপ্রিন্ট দিয়ে লগইন করুন / Use fingerprint" (#065F46).
   Only show if biometric is available; wire to the existing biometric path
   (or no-op placeholder until Phase 2 native).

## Two-step entry (keep current behavior, just re-skin)
- Step 1: enter PIN -> dots fill. When 4 digits entered, show strength, then advance
  to confirm step (animate the title to "PIN আবার দিন / Re-enter PIN", clear dots).
- Step 2: re-enter -> on 4 digits, auto-submit via the existing register() call.
  If mismatch, shake the dots, show "PIN মিলছে না / PINs don't match" in #DC2626,
  and reset to step 1 (or clear confirm). Reuse the existing auto-submit useEffect.
- Keypad updates whichever PIN is active (pin or confirmPin) based on the step.

## Keep / don't change
- All logic: validatePin, pinStrength, the register() call, tempData guard, skip,
  navigation, error handling. Only the rendering changes.
- Money/number font rule: PIN digits use var(--font-sans) (not money).
- Accessibility: keypad buttons are real <button>s with aria-labels; 48dp+ targets.
- Remove the old text <input> fields, show/hide eye toggles, and the two-field form.

## Polish
- Subtle scale/opacity animation when a dot fills.
- Shake animation on mismatch (translateX keyframes).
- prefers-reduced-motion: disable the shake/scale.
- Everything reachable one-handed (thumb zone) — keypad in the lower half.

## Verify
- Enter 4 digits via keypad -> dots fill -> confirm step -> match -> proceeds.
- Mismatch shakes and resets. Skip works. Backspace works. Looks centered and
  balanced on a 360dp screen. Builds clean.
