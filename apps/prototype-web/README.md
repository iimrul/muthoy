# apps/prototype-web/ — Figma Make Output (REFERENCE ONLY)

## What this is
This folder contains the original Figma Make web prototype for Muthoy
(React + Vite + localStorage). It is the **design and flow specification** for
the real app — every screen layout, every business rule, and every bug already
found and fixed here should carry forward into `apps/mobile`.

## The rule — precisely
**USE this prototype for:** UI/UX, screen layouts, navigation, visual
hierarchy, components, and interaction patterns. That's the full list of what
transfers.

**Do NOT copy:** its React Web architecture, its CSS, its business logic, its
state management, or its data layer into React Native. None of these
transfer — this is a web app on `localStorage`; the real product is React
Native on SQLite with a completely different architecture (see Volume 2's
8-layer model). When a prompt says "match prototype-web's SaleEntry screen,"
it means: read that file for LAYOUT and FLOW, then rebuild the experience
natively — never copy-paste the code, and never let its state-management or
data-access patterns leak into the native implementation.

## How to use this folder in a prompt
> "Read apps/prototype-web/SCREENS.md's entry for [ScreenName], and the
> matching source file in this folder, for exact layout and behavior. Rebuild
> it in React Native using our Drizzle/SQLite data layer, per DEVELOPMENT_RULES.md
> and TECH_STACK.md."

## Files in this folder
- `README.md` — this file
- `SCREENS.md` — every screen the prototype defines, with a one-line spec each
- `ANALYSIS.md` — every gap, bug, and missing feature already identified against
  this prototype — read this BEFORE rebuilding a screen, so a known issue isn't
  silently reintroduced
- everything else — the original exported Figma Make source, untouched

## This folder can be deleted without breaking anything
It doesn't build, doesn't ship, and isn't a workspace package. It exists purely
as a permanent, versioned design reference sitting next to the real code.
