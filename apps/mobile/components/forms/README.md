# components/forms/

React Hook Form + Zod form components. Zod schemas live in
`packages/validation`, never redefined here.

- `RegistrationForm.tsx` (Day 4) — shop name + phone, `registerSchema`.

PIN entry (setup, login, staff creation, PIN change) intentionally does NOT
use RHF — `components/ui/PinPad.tsx`'s custom keypad doesn't map onto RHF's
controlled-field model, and each screen validates the completed PIN directly
with Zod on submit instead.
