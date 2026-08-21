# Plan: PIN Setup Page — Center-Aligned Mobile Redesign

## Context
The PIN setup page (`PINSetup.tsx`) and its `PinPad.tsx` component were recently redesigned but the content block (icon, badge, heading, body text) is left-aligned. The user wants a clean, centered, mobile-first layout with better visual hierarchy, balanced spacing, and a polished composition — while keeping all existing functionality and logic identical.

## What Changes

### `src/app/screens/PINSetup.tsx`
All layout and spacing changes only. No logic, state, effects, navigation, or prop changes.

**Structural changes:**
1. **Center everything** — add `text-center` and `items-center` to the main content block. Icon, badge, eyebrow label, heading, and body text all center-aligned.
2. **Icon placement** — center the icon box with `mx-auto` and give it slightly more vertical breathing room above the heading.
3. **Badge row** — remove the split row (`badge left / step counter right`). Replace with a single centered badge. The step progress bar already communicates step progress; the `step/2` counter is redundant noise.
4. **Heading + body** — use `mx-auto max-w-[280px]` on the body paragraph so it wraps cleanly centered, not edge-to-edge.
5. **Flex spacer** — reduce the `flex-1 min-h-5` spacer between content and PinPad so vertical rhythm feels tight and intentional on smaller phones (~667px); keep a min so it never collapses on tall screens.
6. **Status pill row** (strength/error/loading) — keep existing logic but center the container with `mx-auto`.
7. **Bottom section** — fingerprint toggle and disclaimer stay below PinPad, no layout changes needed there (they're already full-width).

**Typography touch-ups (no logic change):**
- Eyebrow label: bump letter-spacing slightly for better legibility centered.
- Heading: keep existing `text-[27px]` size; add `mx-auto` wrapper for reflow.

### `src/app/components/PinPad.tsx`
No changes needed — the PinPad is already centered within its container. The parent changes handle alignment.

## Files to Edit
- `src/app/screens/PINSetup.tsx` — layout restructure only (centering + spacing)

## Exact Layout Structure After Change

```
<main>                              ← full-height page
  <StandardHeader>                  ← back nav, unchanged
  <section flex-col>
    [progress bar]                  ← 3 segments, full-width, unchanged
    
    <div text-center items-center>  ← NEW: center block
      [Muthoy Secure badge]         ← mx-auto, centered (step counter removed)
      [Icon box]                    ← mx-auto, mt-5 mb-5
      [Eyebrow label]               ← centered
      [h1 heading]                  ← centered, mx-auto max-w-[260px]
      [body paragraph]              ← centered, mx-auto max-w-[260px]
    </div>
    
    [status area: strength/error/loading]  ← existing logic, centered container

    <div flex-1 min-h-4 />          ← reduced spacer

    <div PinPad container>
      <PinPad />                    ← unchanged
      [fingerprint toggle]          ← unchanged
      [disclaimer text]             ← unchanged
    </div>
  </section>
</main>
```

## What Does NOT Change
- All `useState`, `useEffect`, `useAuth`, `register`, `navigate` logic
- Auto-advance from step 1 → 2
- Shake + mismatch reset behavior  
- PIN strength calculation
- Fingerprint toggle (`enableBiometric` state)
- Skip action
- `PinPad` component (zero changes)
- `StandardHeader` usage
- All Bangla/English `t()` strings

## Verification
1. Visual: page renders with icon, badge, heading, body all center-aligned
2. Functional: entering 4 digits auto-advances to step 2
3. Functional: mismatched PIN triggers shake and resets to step 1
4. Functional: matching PIN triggers loading state and `register()` call
5. Functional: Skip navigates to `/app`
6. Functional: fingerprint toggle toggles `enableBiometric`
7. No TypeScript errors (JSX parses cleanly)
