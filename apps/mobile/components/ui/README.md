# components/ui/

Generic, screen-agnostic building blocks (Header, PinPad, PlanBadge, buttons).

- `PinPad.tsx` (Days 4-5/11) — the 4-dot + numeric keypad, fully controlled
  by props. Also exports `usePinEntry` (buffers digits, fires a callback at
  4) and `useConfirmedPinEntry` (adds the enter-then-confirm step machine
  every PIN-setting flow needs) — co-located here rather than a new
  top-level hooks/ folder, since Volume 2 doesn't define one and both only
  ever pair with this component.

- `StandardHeader.tsx` (Day 5) — live. Rendered by most Day 6+
  transactional/detail screens (Sale's cart/checkout/confirmation,
  Inventory's tab/add-medicine/batches/expiry, Cash Summary/Expenses/End of
  Day, Credit, Suppliers, Notifications). MorningDashboard and Registration
  are documented in-code as deliberately exempt (Volume 4 Navigation).
  Settings, Staff Management, the PIN/OTP auth flow, and Reports do not yet
  call it — Volume 4's "every screen" framing is the intended end state, not
  verified current coverage.
- `AccessDenied.tsx` (Day 11) — live. What a guarded route renders for a
  denied role (see `domain/README.md`'s `permissions.ts` entry) — a calm,
  dead-ended screen with a way back, never a crash or a silent redirect.

Still signature-only stubs: `PlanBadge.tsx` + `PremiumGate.tsx` (P1,
post-beta — Subscription).
