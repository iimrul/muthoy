# Plan: Effortless "Change PIN" during PIN setup

## Context
During PIN setup (`/src/app/screens/PINSetup.tsx`), the flow auto-advances from **Create PIN** (step 1) to **Confirm PIN** (step 2). Once on the confirm step there is **no explicit way to go back and change the original PIN** — the only path is to deliberately type a mismatching PIN, which shakes and silently resets to step 1. On a real mismatch the screen also auto-jumps back to step 1 and wipes both PINs, so a user who simply mistyped the *confirmation* is forced to re-enter the original PIN too.

This change gives users clear, intentional control: a **Change PIN** option on the confirm step, and on a mismatch a choice between **Try Again** (re-enter confirmation only) and **Change PIN** (start over). The PIN stays masked throughout.

## Current behavior (reference)
- `PINSetup.tsx:34-42` — auto-advance step 1 → 2 when `pin.length === 4`.
- `PINSetup.tsx:44-94` — auto-submit effect: on match, registers; on **mismatch**, sets error, shakes, then after 400ms resets to step 1 and clears both `pin` and `confirmPin`.
- `PINSetup.tsx:152-155` — `StandardHeader` `onBack` is static (`navigate("/otp")`).
- `StandardHeader` (`/src/app/components/StandardHeader.tsx`) accepts a dynamic `onBack?: () => void`; the back chevron is always rendered.
- `PinPad` (`/src/app/components/PinPad.tsx`) already masks digits as filled dots with a brief peek-then-mask reveal (never permanently displayed). **No change needed here** — this satisfies the "keep masked / dots" requirement.

## Changes — all in `/src/app/screens/PINSetup.tsx`

### 1. Helper handlers
Add two handlers near `handleSkip` (`:136`):
- `handleChangePin` — `setStep(1); setPin(""); setConfirmPin(""); setError("");` (return to Create PIN, clear both values).
- `handleTryAgain` — `setConfirmPin(""); setError("");` (clear only the confirmation).

### 2. Dynamic header back button
Change `StandardHeader` `onBack` (`:154`) to branch on step:
`onBack={step === 2 ? handleChangePin : () => navigate("/otp")}`
So the header chevron on the confirm step returns to Create PIN and clears both PINs (consistent with "Change PIN").

### 3. Mismatch: stay on confirm step, offer choices
In the auto-submit effect (`:79-89`), replace the "shake + reset to step 1 + clear both" branch with:
- `setError(t("PIN মিলছে না", "PINs don't match"))`
- `setShake(true)`
- after ~400ms: `setShake(false); setConfirmPin("");` — **remain on step 2**, clearing only the confirmation so the user can immediately Try Again.

### 4. Confirm-step action buttons
In the confirm step (`step === 2`), below the PinPad / near the helper text (`:224-256`):
- Always render a **"Change PIN"** secondary text button → `handleChangePin`.
- When `error` is present on step 2, also render a **"Try Again"** button → `handleTryAgain`, placed alongside "Change PIN".

Reuse the existing secondary-button style (from OTP "Resend", `OTPVerification.tsx:197-205`): centered, `text-[#059669] font-medium hover:underline`, `style={{ fontFamily: "var(--font-bangla)" }}`. Keep layout centered and mobile-friendly (e.g. a centered flex row with a divider between the two actions).
- Bangla/English labels: `t("PIN পরিবর্তন করুন", "Change PIN")` and `t("আবার চেষ্টা করুন", "Try Again")`.

### 5. Keep intact
- Auto-advance, auto-submit-on-match, registration + biometric stub, and the `isRegistering` guard are unchanged.
- The existing in-grid **Skip** affordance in `PinPad` stays as-is.
- No changes to `PinPad.tsx` — masking/dots/peek/backspace already meet the security & UX requirements.

## Verification
1. The Vite dev server is already running — use the preview surface (do not open localhost / do not run a build).
2. Flow: Register → OTP → PIN setup.
3. **Create → Confirm:** enter 4 digits; confirm it masks to dots and advances to the confirm step.
4. **Change PIN (no error):** on confirm step tap "Change PIN" → returns to Create PIN with both fields empty; also verify the header chevron does the same.
5. **Mismatch:** enter a non-matching confirmation → error shows, shake plays, **stays on confirm step**, confirmation cleared; verify "Try Again" (clears confirmation only, original PIN preserved) and "Change PIN" (returns to step 1, both cleared) both appear and work.
6. **Happy path:** matching confirmation still registers and navigates to `/app`.
7. Confirm backspace, centering, and responsiveness on a narrow mobile viewport.
