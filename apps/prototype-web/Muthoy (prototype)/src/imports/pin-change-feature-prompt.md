# Muthoy (মুঠোয়) — Add Change/Reset PIN (Owner + Staff)

The app has no way to change a PIN after setup. Add it for BOTH the owner (their own
PIN) and staff (owner resets any staff member's PIN). Logic already stores pin on the
user (users[] in AuthContext) and on each staff member (staffMembers[]). Place each
control in its natural home.

## Brand tokens
Brand Green #059669, Deep Green #065F46, Soft Green #ECFDF5, #111827, #6B7280,
Error #DC2626. Fonts: Hind Siliguri (Bangla), Plus Jakarta Sans (numbers via var(--font-sans)).

---

## PART 1 — OWNER changes their OWN PIN (in Settings)

Position: Settings screen, in a "নিরাপত্তা / Security" section near the Backup Key
(same area where security-sensitive items live).

Add a row: "PIN পরিবর্তন করুন / Change PIN" with a lock icon and chevron. Tapping
opens a modal/sheet with three steps:
1. বর্তমান PIN / Current PIN — verify against the logged-in owner's stored pin.
   Wrong -> error "বর্তমান PIN ভুল / Current PIN is incorrect" (#DC2626).
2. নতুন PIN / New PIN — 4 digits, reuse the dots+keypad style from PINSetup.
3. নতুন PIN নিশ্চিত করুন / Confirm new PIN — must match.

On success: update the owner's record in the users[] array in localStorage (find by
the current user's id/phone, set pin = newPin), show "PIN পরিবর্তন হয়েছে / PIN
changed", close. Add an audit log entry "pin_changed" (no PIN value in the log).

Reuse the AuthContext: add a `changePin(currentPin, newPin)` method that verifies and
updates the current user, so the modal calls one clean function.

---

## PART 2 — OWNER resets a STAFF member's PIN (in Staff Management)

Position: open a staff member -> StaffDetailSheet (the existing per-staff sheet).
Add a row/button there: "PIN রিসেট করুন / Reset PIN" with a lock icon.

Owner does NOT need the staff's old PIN (they're the owner resetting it). Tapping
opens a simpler modal:
1. নতুন PIN / New PIN (dots+keypad, 4 digits)
2. নিশ্চিত করুন / Confirm

On success: update that staff member inside staffMembers[] (match by id, set
pin = newPin), via shopStorage so it stays shop-scoped. Enforce the existing rule that
no two staff on the same device share a PIN — if the new PIN collides with another
staff's PIN, show "এই PIN অন্য একজন ব্যবহার করছেন / This PIN is already in use" and
block. Show success toast, dispatch the staffMembers storage event so the list
refreshes. Audit log "staff_pin_reset" with the staff name (no PIN value).

Also: when ADDING a new staff (AddStaffModal), keep the existing PIN entry — this
feature is about CHANGING later, not replacing creation.

---

## SHARED — reuse the PIN entry component
Extract the dots + numeric keypad from the redesigned PINSetup into a small reusable
`<PinPad value onChange maxLength={4} />` component, and use it in:
- PINSetup (initial)
- Owner Change PIN modal (3 steps)
- Staff Reset PIN modal (2 steps)
So all PIN entry looks identical everywhere.

## Validation rules (reuse existing)
- 4 digits, numeric only.
- Weak-PIN warning (reuse pinStrength) — warn but allow, same as setup.
- New PIN must differ from nothing required for staff; for owner, optionally warn if
  new == current.
- Never store or log the plain PIN in audit entries — log only the action + who.

## Verify
1. Settings -> Change PIN: wrong current PIN blocks; correct flows to new+confirm;
   mismatch blocks; success updates owner login (log out, log in with NEW pin works).
2. Staff detail -> Reset PIN: sets a new staff PIN; that staff can log in with the new
   PIN; duplicate-PIN collision is blocked.
3. Both use the same dots+keypad UI. Build is clean.

## What not to change
- Staff creation flow, permissions, the active/inactive logic.
- Shop-scoped storage (staff PIN writes go through shopStorage).
- The login logic (it already matches phone+pin; we only change stored pin).
