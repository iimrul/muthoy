# Redesign Owner Login & Staff Login (Muthoy)

## Context

The PIN Setup screen (`src/app/screens/PINSetup.tsx`) was recently redesigned into a modern, premium, mobile-first UI built around the reusable `PinPad` component (`src/app/components/PinPad.tsx`, `variant="setup"`) and a distinct green design language. The two login screens — **Owner Login** (`src/app/screens/PINLogin.tsx`) and **Staff Login** (`src/app/screens/StaffLogin.tsx`) — still use the older flat-emerald design (inline `#059669` gradients, custom hand-rolled keypads, `Crown`/`User` badges). They now look inconsistent with PIN Setup.

Goal: redesign both login screens to share PIN Setup's design system (tokens, spacing, radius, blurred blobs, "Muthoy Secure" pill, deep-green icon tile, `PinPad`) so all three authentication screens feel like one cohesive, secure experience — while **preserving all existing auth logic** (`login`, `staffLogin`, phone validation, lockout, biometric stub, staff avatar grid, manual fallback).

## Shared design language to adopt (from `PINSetup.tsx`)

Reuse these exact patterns in both screens:
- Root shell: `<main className="h-[100dvh] overflow-hidden bg-[#f3faf7] text-[#163a31]">` → inner `max-w-md` card `bg-[#f8fcfa]` with `shadow-[0_0_80px_rgba(6,95,70,0.08)]`, two decorative blurred blobs (`bg-[#b7e7d4]/45`, `bg-[#d9f2e5]/70`, `blur-3xl`).
- `StandardHeader` (unchanged component) with dynamic `onBack`.
- "Muthoy Secure" pill badge, deep-green `rounded-[22px] bg-[#0b604a]` icon tile, uppercase eyebrow + `font-[var(--font-bangla)]` h1 + `text-[#668478]` body copy.
- Error card style: `rounded-2xl bg-[#fff7f7] border-[#f2cfcd] text-[#bf3f3d]`. Loading card: `bg-[#effbf5] border-[#b9e4d0]`.
- PIN entry via the existing **`PinPad` component with `variant="setup"`** (do NOT hand-roll keypads anymore).
- Color scale: bg `#f3faf7`/`#f8fcfa`; greens `#0b604a`/`#0d765a`/`#09845e`/`#16a06f`; muted `#668478`/`#4d7e6d`; borders `#c7e7d8`/`#d9ebe2`.
- No new theme tokens needed; keep hardcoded hex to match PINSetup exactly.

## 1. Owner Login — `src/app/screens/PINLogin.tsx` (rewrite JSX, keep logic)

Progressive single-page flow (per user choice): phone entry first, PinPad reveals after a valid phone — both rendered inside the same redesigned shell.

- **Preserve all existing logic/state**: `phone`, `pin`, `attempts`, `isLoading`, `error`, `showPhoneInput`, `isLocked`, `lockTimer`, `biometricEnabled`; `useMobileNumberSanitizer`, `validateMobileNumber`, `formatMobileForStorage`; `handlePhoneSubmit`, `handleNumberPress`→ refactor to a `handlePinChange(value)` that feeds `PinPad` and triggers `login()` when `value.length === 4`; `handleDelete` handled by PinPad; `handleChangePhone`, `handleBiometricLogin`; lockout countdown effect; already-authenticated redirect.
- **Phone view** (`showPhoneInput`): shell + blobs + `StandardHeader` (title `মালিক লগইন / Owner Login`, `onBack → navigate("/")`). Brand block "Muthoy (মুঠোয়)" (keep the two-tone wordmark as the logo), welcome copy, "Muthoy Secure" pill, deep-green icon tile (use a `Crown` or `Store`/`User` icon inside the tile instead of the old floating badge). Redesigned `+880`-prefixed phone input (rounded-2xl, border `#c7e7d8`, focus green). Redesigned error card. Gradient "Continue" button restyled to solid deep-green (`bg-[#0b604a]`). Keep "Staff Login" and "Create new account" quick links, restyled as subtle links/secondary button.
- **PIN view** (`!showPhoneInput`): same shell; header title `PIN দিন / Enter PIN`, `onBack → handleChangePhone`. Show identity chip (avatar tile + `+880 {phone}` + "Change number" link). Render `<PinPad value={pin} onChange={handlePinChange} variant="setup" disabled={isLocked || isLoading} shake={...} />`. Reuse PINSetup error/lock card and loading card styles. Keep biometric button styled like the PINSetup biometric toggle button (only when `biometricEnabled` && `!isLocked`). Keep "Forgot PIN?" link at bottom.
- Add a `shake` state so wrong PIN shakes the PinPad (PinPad already supports `shake`), replacing/augmenting the current pin-clear behavior.
- Icons: import from `lucide-react` as needed (`Crown`/`Store`, `Fingerprint`, `Loader2`/`CheckCircle2`).

## 2. Staff Login — `src/app/screens/StaffLogin.tsx` (rewrite JSX, keep logic)

- **Preserve all existing logic/state**: `activeStaff` from `shopStorage.getItem("staffMembers")` filtered by `active`; `selectedStaff`, `pin`, `error`, `shake`, `isLoading`, `attempts`; `manualMode` + `phone`; `AVATAR_PALETTE`, `getInitials`, `paletteFor`; `tryLogin`, `handleNumberPress`→ refactor to `handlePinChange` feeding `PinPad`, `handleDelete` (via PinPad), `handleManualSubmit`; authenticated redirect to `/app/staff-home`.
- **Avatar-grid view**: same redesigned shell + blobs + `StandardHeader` (title `স্টাফ লগইন / Staff Login`, subtitle reflects select vs enter-PIN state, `onBack → navigate("/")`). Add "Muthoy Secure" pill + deep-green icon tile + eyebrow/heading like PINSetup. Restyle the 2-col staff cards to match new tokens (rounded-2xl, border `#c7e7d8`, selected `border-[#0b7658] bg-[#eff7f2]`), keep colored initial-avatars and role pill. On selection, reveal `<PinPad variant="setup" shake={shake} .../>` (replaces hand-rolled keypad) with PINSetup-styled error/loading cards. Keep "Enter manually" secondary button restyled.
- **Empty state** (no active staff): restyle to new tokens; keep "Manual Sign In" CTA (solid deep-green).
- **Manual fallback view** (`manualMode`): same shell; redesigned `+880` phone input and 4-digit PIN input matching the owner phone-input styling; solid deep-green "Sign In" button with loading state; redesigned error card; `onBack` clears state and returns to grid.

## Constraints & non-goals

- Do **not** change routing (`router.tsx`, `routes.ts`), `AuthContext`, `shopStorage`, `mobileNumber` utils, `useMobileNumberSanitizer`, `PinPad`, or `StandardHeader`. Consume them as-is.
- Keep both files' default/named exports intact (router imports rely on them).
- Keep Bengali/English `t(...)` strings and `formatNumber` usage; keep `var(--font-bangla)` / `var(--font-sans)` font usage consistent with PINSetup.
- Ensure each screen fits within `h-[100dvh]` on mobile without unnecessary scrolling (grid view may scroll when many staff — acceptable, matching current).
- Every list item keeps a unique `key` (staff `s.id`).

## Files to modify

- `src/app/screens/PINLogin.tsx` — rewrite presentation, keep logic.
- `src/app/screens/StaffLogin.tsx` — rewrite presentation, keep logic.

(No new components required; `PinPad`, `StandardHeader`, `LanguageToggle` are reused.)

## Verification

- App dev server is already running; open the preview (do not use localhost).
- Owner Login (`/login`): brand + phone step renders in new style; entering an invalid phone shows the redesigned error; a valid registered phone reveals the PinPad step; entering the correct PIN navigates to `/app`; wrong PIN shakes + shows attempts-left, 5 wrong triggers 60s lockout; biometric button appears only when enabled; "Change number"/"Staff Login"/"Create new account" links work.
- Staff Login (`/staff-login`): avatar grid renders in new style; selecting staff reveals PinPad; correct PIN → `/app/staff-home`; wrong PIN shakes; empty-state + "Manual Sign In" and "Enter manually" → manual view logs in via phone+PIN.
- Toggle language (বাং/ENG) and confirm both screens render correctly in both languages and visually match `PINSetup.tsx`.
- Confirm no TypeScript/console errors and that both screens fit the mobile viewport without extra scrolling.
