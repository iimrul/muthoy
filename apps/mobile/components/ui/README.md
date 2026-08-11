# components/ui/

Generic, screen-agnostic building blocks (Header, PinPad, PlanBadge, buttons).

- `PinPad.tsx` (Days 4-5/11) — the 4-dot + numeric keypad, fully controlled
  by props. Also exports `usePinEntry` (buffers digits, fires a callback at
  4) and `useConfirmedPinEntry` (adds the enter-then-confirm step machine
  every PIN-setting flow needs) — co-located here rather than a new
  top-level hooks/ folder, since Volume 2 doesn't define one and both only
  ever pair with this component.

Still signature-only stubs: `StandardHeader.tsx` (Day 5), `PlanBadge.tsx` +
`PremiumGate.tsx` (P1, post-beta — Subscription).
