# A2.3 production-readiness concern: recovery for a shop with one Owner device

Raised 2026-11-03, out of H-11 Part B. **Revision 2, 2026-11-04**, after an
independent security/architecture review returned **REJECT** on revision 1's
recommended option. The underlying concern was confirmed valid; the proposed
fix was not. Revision 1's Option A is retained below only as a rejected option,
with the reasons, because the reasons are the useful part.

**This is a proposal for independent review, not an implementation.** Nothing
here has been built. It touches the database and the device registry, so
CLAUDE.md rule 10 applies, and the founder's standing instruction is explicit:
no recovery-policy change without a new scoped rule 10 approval.

No bypass is proposed. Any option must *satisfy* the enrolment hold through a
new, auditable authority; none may skip `a23_prepare_enrollment`,
`a23_enroll_device` or `a23_approve_enrollment`.

## 1. The control, stated precisely

A2.3 holds a revoked actor out of self-service re-enrolment:

- `a23_enroll_device` raises `MU070` unless an existing hold is already
  approved for this exact `device_public_id` **and not yet consumed** —
  `20260926000000_a23_persistent_enrollment_holds.sql:134`.
- `a23_approve_enrollment` is, in its own words, *"the only A2.3 path that can
  satisfy an enrolment hold. Manual account recovery remains deliberately out
  of scope."*
- It requires a caller who is a device admin **and** holds a live row in
  `auth_session_devices` joined to an `active` device and an `active` binding.
  Role alone is refused with `MU071`.
- It refuses when `v_hold.source_device_id = v_approver_device_id`: the
  approving installation must differ from the one that caused the hold.

**Approval is consumed, not cleared** (review finding 8). Enrolling consumes
the approval and the hold row remains, so a later enrolment — even reusing the
same replacement id — needs a fresh approval. Revision 1 said the hold was
"cleared". That was wrong.

Note also that the approving installation need not belong to a different
*person*: the same Owner may approve from a second installation of their own.
The control is a second **installation**, not a second human.

## 2. What is NOT affected — the bounding claim, confirmed

Hold rows are **created** in exactly two places, both deliberate administrative
revocations: `a23_revoke_binding` (`:1238`) and `a23_revoke_device` (`:1374`).
Nothing in registration, login, PIN recovery or app-data clearing creates one,
and `a23_prepare_enrollment` returns `allowed: true` when none exists.

Independent review confirmed this boundary against the SQL. Two corrections to
how revision 1 worded it:

- They are the only **creators**, not the only **writers**: prepare, enrol and
  approve all update an existing hold row.
- "Never revoked" must include *binding* revocation, and the boundary is per
  `(shop_id, actor_user_id)`, not per shop.

So a brand-new Owner registering a brand-new shop is unaffected, and so is any
shop/actor pair that has never been revoked. `a23-device-registry.pgtest.ts`
pins this directly: *"keeps normal non-revoked strong-auth enrolment
available"* asserts `allowed: true, held: false`.

## 3. The actual dead end — corrected

Revision 1 narrated: owner loses phone, revokes it, cannot enrol a replacement.
**That sequence is largely impossible, and the narrative was wrong** (review
finding 7). Revoking is a guarded action requiring a bound session, so an owner
whose only handset is gone cannot revoke anything. In the ordinary lost-phone
case they sign in on the replacement first — no hold exists, so it enrols —
and revoke the lost installation afterwards, from the replacement.

The genuinely unrecoverable states are narrower:

1. **Self-revocation of the last installation.** The owner revokes the very
   installation they are using, leaving a hold and no active installation.
2. **Loss of the last remaining installation while a hold is outstanding** from
   an earlier revocation.

Case 1 is already encoded in the test suite, by name:
`backend/supabase/pgtest/a23-device-registry.pgtest.ts:579`, *"leaves a
sole-admin revoked-device case blocked pending manual recovery"* — approval
refused `MU071`, enrolment refused `MU070`. The product knows about this state
and has no route out of it.

Severity: **HIGH for production availability**, LOW for Batch 3 acceptance,
where a fresh identity avoids it. Review agreed with both, with the caveat that
the Batch 3 rating is about fixture obstruction and is not evidence that the
blocked drill passed.

## 4. Constraints any fix must respect

1. An attacker holding the stolen handset may also know the PIN and may be able
   to receive its SMS. Phone + PIN + anything derived from that same phone must
   therefore **not** be sufficient. This is the whole reason the hold exists.
2. **The schema will not accept a non-user approval as it stands.** The CHECK
   at `20260923000000_a23_device_registry.sql:298` requires `approved_at`,
   `approved_by_user_id`, `approved_by_device_id` and
   `approved_device_public_id` to be non-null *together*, and both approver
   columns are UUID foreign keys. A provenance meaning "no user approved this"
   cannot be expressed: nulls fail the CHECK, invented UUIDs fail the FKs, and
   borrowing a real user/device id would falsify the audit record. Any new
   authority needs an explicit schema change and its own provenance column.
3. The primary key is `(shop_id, actor_user_id)` — one hold per actor. A
   durable pending-request history, or concurrent requests, needs a separate
   table rather than more columns on the hold.
4. `device_registry_events` has a CHECK on its event vocabulary (`:195`) with
   no pending-recovery, cancellation or notification event types. Auditing a
   new flow means extending it.
5. Recovery must be auditable, and contestable by a legitimate owner who did
   not initiate it.
6. Any new capability must be evaluated at **both** OTP-bearing entry points —
   `recoverPin.ts` and `linkDevice.ts` — not just the one being designed for.

## 5. Options

### Option D — pre-issued independent recovery credential (RECOMMENDED)

From the independent review, and now the recommendation.

At provisioning, while the owner still has trusted access, issue a
high-entropy single-use recovery code to be stored **off the handset**. The
server stores only a verifier. Redemption is rate-limited, bound to the exact
shop, actor, recovery request and replacement installation, consumed
atomically, and rotated afterwards. The hold persists; recovery provenance is
recorded explicitly rather than borrowed from a user id.

Why this and not a timer: it introduces evidence the handset-plus-PIN attacker
does not have. Everything in Option A — OTP, PIN, notification — flows through
the one phone that is assumed compromised. A recovery code is the only proposal
here that breaks that single channel. It is also a recognised account-recovery
method rather than an invention (NIST SP 800-63B, account recovery).

Limits, stated plainly: it only helps owners who were provisioned **before**
loss. Owners already locked out need a separately approved identity-proofing
process, which is Option B and is not solved by this.

### Option A — delayed self-approval with notification (REJECTED)

Revision 1's recommendation: OTP + PIN on the new installation, then a 72-hour
notified, cancellable window after which the hold is satisfied. Review verdict:
**FAIL, BLOCKING.** Recorded here with the reasons:

- A thief with handset, PIN and SMS possesses every proposed proof; clearing
  app data supplies the new installation id. The timer only delays them.
- The notification goes to the number on the stolen handset — it warns the
  attacker, not the owner, in exactly the case it exists for.
- Cancellation is offered only to an active admin installation, which by
  definition the locked-out owner does not have. "If one later appears" is
  circular: the hold is what stops one appearing.
- It does not fit the schema (see constraint 2 above).
- `a23_prepare_enrollment` rewrites `requested_at` on every retry, so a naive
  timer restarts on each request — indefinite lockout for the owner, or a
  stale deadline authorising a substituted installation.
- 72 hours had no security basis. It was a guess, and a longer delay cannot
  compensate for an owner who never receives the warning.

The general lesson: elapsed silence is not an approval authority.

### Option B — support-assisted approval under dual control (FALLBACK ONLY)

Two distinct operator identities, append-only record, documented evidence.
Necessary for owners already locked out with no pre-issued credential; it is
the only option that can help them. But it is worth having only if the
operators' evidence is genuinely stronger than the same compromised phone
channel — otherwise it is a slower version of the same mistake, with an
insider path added.

### Option C — pre-registered recovery contact (CONDITIONAL, not sufficient)

Revision 1 called this cheap and said it "removes the problem for new shops".
Review found that unsupported. A second number alone grants no authority under
`a23_approve_enrollment`; it needs a defined approval or contest mechanism to
mean anything. It also degrades badly: a stale number reaches a stranger, a
hostile contact can assist a takeover or block a legitimate recovery, and a
second number on the same handset shares the compromise. Viable only with
verified independent control, consent, periodic revalidation, protected
changes, and a further fallback.

### Recommendation

**D as the primary route, B as the only path for owners already locked out, C
only if it is built into a real approval mechanism. A is withdrawn.**

## 6. Relationship to H-11 Part B

Found while Part B hit this gate on a DEV identity that already carried a hold
from earlier A2.3 testing — the control working correctly on an unsuitable
identity, not a defect. Part B remains BLOCKED rather than FAILED. See §9 of
`b3-device-check-reconciliation-2026-11-01.md`.

Part B does **not** need this fix. A genuinely new synthetic shop has no hold,
so `a23_prepare_enrollment` returns `allowed: true`. Note that the gate is
still *invoked* on that path, via `linkDevice.ts:128` after the Owner row is
created — it passes, it is not absent.

## 7. Status and what remains open

Review verdict on revision 1: **REJECT**, with the single most important fix
being to replace elapsed silence as an approval authority with an independent
recovery credential or an independently verified approval. Revision 2 adopts
that.

Still open, for the next review:

1. Does Option D's credential need to survive a shop that has never had a
   second installation, and what is the provisioning moment — onboarding, or
   first sync?
2. What identity-proofing standard should Option B require, given it is the
   only route for owners already locked out today?
3. Does the pending-request state belong in a new table, given constraint 3?
4. Should provisioning a recovery credential be P0 for Batch 4 onboarding? It
   prevents new instances but does nothing for the existing field population.
