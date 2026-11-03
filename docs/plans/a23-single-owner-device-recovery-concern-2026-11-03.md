# A2.3 production-readiness concern: recovery for a shop with one Owner device

Raised 2026-11-03, out of H-11 Part B. **This is a proposal for independent
review, not an implementation.** Nothing here has been built, and the fix it
describes touches the database and the device registry, so CLAUDE.md rule 10
applies: it needs an approved plan before any code is written.

No bypass is proposed. Every option below *satisfies* the enrolment hold
through a new, auditable path; none of them skips it, and none weakens
`a23_prepare_enrollment`, `a23_enroll_device` or `a23_approve_enrollment`.

## 1. The concern, stated precisely

A2.3 holds a revoked actor out of self-service re-enrolment. The hold is
cleared by exactly one function, and that function requires a *second*,
currently-bound administrator installation:

- `a23_enroll_device` raises `MU070` whenever an unconsumed hold row exists for
  `(shop_id, actor_user_id)` that is not already approved for this exact
  `device_public_id` — `20260923000000_a23_device_registry.sql`, and the
  corrected definition in `20260926000000_a23_persistent_enrollment_holds.sql`.
- `a23_approve_enrollment` is, in its own words, *"the only A2.3 path that can
  satisfy an enrolment hold. Manual account recovery remains deliberately out
  of scope."*
- It requires a caller who is a device admin **and** has a live row in
  `auth_session_devices` joined to an `active` device and an `active` binding.
  Role alone is refused with `MU071`.
- It also refuses when `v_hold.source_device_id = v_approver_device_id` — the
  approving installation must be a *different* one from the installation that
  caused the hold.

So the approval requires a second installation that is active, bound, and not
the one that triggered the hold.

## 2. What is NOT affected — this bounds the concern sharply

A hold row is created in exactly two places, both of them deliberate
administrative revocations: `a23_revoke_binding` and `a23_revoke_device`.
Nothing in registration, login, PIN recovery or app-data clearing creates one,
and `a23_prepare_enrollment` returns `allowed: true` when no hold row exists.

Therefore:

- **A brand-new Owner registering a brand-new shop is unaffected.** First
  enrolment never consults a hold that does not exist.
- **A single-owner shop that has never revoked a device is unaffected.** The
  owner can move to a new handset with phone + PIN.

The exposure is narrower, and sharper, than "single-owner shops cannot
recover".

## 3. The actual sharp edge

> A sole Owner loses their phone. They do the responsible thing and revoke the
> lost installation. That revocation writes the hold. They now cannot enrol
> their replacement handset, because satisfying the hold requires an active
> bound administrator installation — and the only one they ever had is the
> device they just revoked.

The owner is locked out by following the security advice. Their data is intact
on the server and unreachable from any new device. For a one-pharmacist shop
with no Manager, there is no in-product way back.

Severity: **HIGH for production**, LOW for Batch 3 acceptance (it blocks a test
drill, not a shipped user — see §6). It is a design gap, not a defect: every
individual control is behaving as specified.

## 4. Constraints any fix must respect

1. An attacker who has stolen the handset may also know the PIN. Phone + PIN
   alone must therefore **not** be sufficient to satisfy a hold — that is the
   whole reason the hold exists.
2. Recovery must be **auditable**: who asked, from which installation, when,
   what was approved, and by what authority — in `device_registry_events`, the
   table the rest of A2.3 already writes to.
3. Recovery must be **reversible or contestable** by a legitimate owner who did
   not initiate it.
4. No service-role or support path may call `a23_enroll_device` with the hold
   bypassed. A new satisfying path must be as explicit as
   `a23_approve_enrollment`.

## 5. Proposed options

### Option A — delayed self-approval with notification (recommended)

The owner proves phone (OTP) + PIN on the new installation. Instead of
enrolling, the request enters a pending state with a mandatory waiting period
(proposed: 72 hours). During the window:

- every known contact point for the shop is notified that a replacement device
  is pending, including the number on file;
- any active administrator installation, if one later appears, can cancel it
  immediately;
- the window and every transition are written to `device_registry_events`.

If the window closes uncancelled, the hold is satisfied for that exact
`device_public_id` only — reusing the existing `approved_device_public_id`
machinery, with a new `approved_by` provenance meaning "elapsed, uncontested"
rather than a user id.

Why this is not a bypass: it does not remove the second-party check, it
replaces a *synchronous* second party with a *time-plus-notification* one. A
thief holding phone and PIN gains access only after 72 hours of visible,
cancellable warning, which converts a silent takeover into a detectable one.
A genuine sole owner waits three days — bad, but not permanent.

Open question for review: 72 hours is a guess. The right number is a product
decision informed by how fast a Bangladeshi pharmacist would notice.

### Option B — support-assisted approval under dual control

An operator action in the Admin Panel that approves a specific pending
`device_public_id`, requiring two distinct operator identities and recorded
append-only with the evidence relied on.

Stronger against the thief case, far weaker operationally: it needs a staffed
support function, an identity-proofing policy, and it introduces an insider
path that does not exist today. Recommended only as a fallback behind Option A,
never as the primary route.

### Option C — pre-registered recovery contact at onboarding (prevention)

Capture a second trusted number at shop creation, so a sole owner has a second
party from day one. Cheap, and it removes the problem for new shops — but it
does nothing for shops already in the field, so it is a complement to A, not a
substitute.

### Recommendation

**C for prevention on new shops, A for recovery on all shops, B only if a
staffed support function exists and wants it.** A alone closes the gap; C alone
does not.

## 6. Relationship to H-11 Part B

This concern was found because Part B hit the gate while attempting a recovery
drill on a DEV identity that already carried a hold from earlier A2.3 testing.
That was the control working correctly on an unsuitable identity, not a defect,
and Part B remains BLOCKED rather than FAILED. See §9 of
`b3-device-check-reconciliation-2026-11-01.md`.

Part B itself does **not** need this fix: it can run on a genuinely new
synthetic shop, which never touches a hold.

## 7. What review is asked to decide

1. Is the §2 bounding correct — are `a23_revoke_binding` and `a23_revoke_device`
   genuinely the only writers of `device_enrollment_holds`?
2. Is Option A's delayed, notified, cancellable approval acceptable as a
   *satisfying* path, or does it count as weakening the control?
3. Is 72 hours the right order of magnitude?
4. Should Option C be treated as P0 for Batch 4 onboarding, given it is cheap
   and prevents new instances of the problem?
