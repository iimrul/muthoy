# OpeningCashModal Redesign

## Context

`src/app/components/cash/OpeningCashModal.tsx` is the cash drawer opening popup shown on the Morning Dashboard, Manager Dashboard, and Cash Summary screen. The current design uses a flat emerald-green header band (`bg-[#059669]`) with a white wallet icon circle — a pattern typical of AI-generated UI. The rest of the app has since moved to a premium green design language (deep `#0b604a` tones, `#f8fcfa` surfaces, blurred blob decoration, `#c7e7d8` borders) established by PINSetup, PINLogin, and StaffLogin. The modal needs to match that system and always show a cancel button (currently gated to `editMode` only).

## What Changes

### File
`src/app/components/cash/OpeningCashModal.tsx` only. No caller files need changes.

### Backdrop
- Keep `fixed inset-0 z-[60]`
- Change overlay from `bg-black/50` → `bg-black/40 backdrop-blur-sm` (adds depth without full blackout)
- Backdrop tap always closes (remove the `editMode` gate — cancel button is now always present)

### Modal shell
- Background: `bg-[#f8fcfa]` (matches app surface)
- Shape: bottom sheet on mobile (`rounded-t-[28px]`), centered card on `sm+` (`rounded-[28px] max-w-[420px]`)
- Add a drag-handle pill at the very top (`w-10 h-1 rounded-full bg-[#c7e7d8] mx-auto mt-3 mb-1`)
- Two decorative blobs (same pattern as PINLogin/StaffLogin):
  - Top-right: `absolute -right-16 -top-16 h-48 w-48 rounded-full bg-[#b7e7d4]/40 blur-3xl pointer-events-none`
  - Bottom-left: `absolute -bottom-16 -left-16 h-48 w-48 rounded-full bg-[#d9f2e5]/60 blur-3xl pointer-events-none`

### Header section (replaces the green band)
Remove the `bg-[#059669]` header band entirely. Replace with a centered stack inside the modal body:

1. **Status pill** — `"Opening Cash" / "ড্রয়ার খোলার টাকা"` label with a green dot, matching the "Muthoy Secure" pill style:
   ```
   inline-flex items-center gap-2 rounded-full border border-[#c7e7d8] bg-white/80 px-3 py-1 shadow-sm backdrop-blur
   ```
2. **Icon tile** — 56×56px rounded-[20px] deep-green tile (`bg-[#0b604a]`), `shadow-[0_14px_30px_rgba(6,95,70,0.22)]`, `border border-white/70`:
   ```tsx
   <Wallet className="h-6 w-6 text-white" strokeWidth={1.7} />
   ```
3. **Heading** — `text-[#15382f] text-[20px] font-semibold font-[var(--font-bangla)]` (Bangla question)
4. **Subtitle** — `text-[#668478] text-[13px] font-[var(--font-bangla)]`

Remove the X close button from the header (replaced by always-visible cancel button below).

### Quick-pick chips
Replace flat border-2 chips with cards styled like the staff avatar card selected state:

- **Inactive**: `border border-[#d9ebe2] bg-white/80 text-[#15382f] rounded-2xl h-12`
- **Active**: `border border-[#0b7658] bg-[#eff7f2] text-[#0b604a] rounded-2xl h-12 shadow-[0_4px_12px_rgba(14,117,85,0.10)]`
- Font: keep `var(--font-sans)` for numerals, `font-bold`
- `active:scale-[0.97] transition-all`

### Amount input
- Container: `rounded-2xl border border-[#c7e7d8] bg-white h-14 px-4 focus-within:border-[#0b7658] focus-within:ring-4 focus-within:ring-[#dff2e9] transition-all`
- Currency symbol `৳`: `text-[#668478] text-xl`
- Input text: `text-[#15382f] text-xl font-bold`
- Label above: `text-[12px] font-semibold uppercase tracking-[0.14em] text-[#4d7e6d] font-[var(--font-bangla)]`

### Save button
```
w-full h-14 rounded-2xl bg-[#0b604a] text-white font-bold font-[var(--font-bangla)]
shadow-[0_14px_30px_rgba(6,95,70,0.22)] active:scale-[0.98] transition disabled:opacity-40
```

### Cancel button (always shown — key change)
Remove the `{editMode && ...}` gate. Always render:
```
w-full h-11 mt-2 rounded-2xl border border-[#c7e7d8] bg-white/60
text-[#668478] text-sm font-semibold font-[var(--font-bangla)]
active:scale-[0.98] transition
```
`onClick={onClose}` in all cases.

## Logic changes
- `handleSave`: unchanged — calls `setOpeningCash(numeric)` then `onClose()`
- `editMode` prop: retained for callers' own logic, but no longer gates cancel visibility or backdrop tap
- All imports (`setOpeningCash`, `getOpeningCash`, `OPENING_CHIPS`, `useLanguage`, `formatNumber`) unchanged

## Verification
Open the Morning Dashboard on a fresh day (or clear `cashOpening` from localStorage) → modal auto-opens → verify new design, working chip selection, manual input, save, and cancel button. Also verify manual edit path from Cash Summary screen (editMode=true) closes cleanly.
