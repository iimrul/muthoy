# A2.3 production-readiness concern: recovery for a shop with one Owner device

Raised 2026-11-03, out of H-11 Part B. **Revision 3, 2026-11-04**, after a
second independent security/architecture review returned **REJECT** on revision
2. Revision 1's Option A is retained below only as a rejected option, with the
reasons, because the reasons are the useful part.

**What each review changed.** Review 1 rejected revision 1's *recommended
option*: the concern was valid, the fix was not. Review 2 accepted that
rejection as sound, and found revision 2's remaining defect to be the opposite
kind — one **factual** error, load-bearing, plus four unmet security
requirements on the newly recommended Option D. The factual error is the
important one, and it was mine twice over: in both revisions I **enumerated**
the unrecoverable states instead of stating the invariant that produces them,
and both enumerations were narrower than the SQL. Revision 3 states the
invariant and gives the cases as instances of it. Every citation below was
re-verified against the migration before being written here.

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
Nothing in registration, login, PIN recovery or app-data clearing creates one.

Both reviews confirmed this creator boundary against the SQL. Three corrections
to how earlier revisions worded it:

- They are the only **creators**, not the only **writers**: prepare, enrol and
  approve all update an existing hold row.
- "Never revoked" must include *binding* revocation, and the boundary is per
  `(shop_id, actor_user_id)`, not per shop.
- **"No hold means `allowed: true`" is overbroad** (review 2). With no hold,
  `a23_prepare_enrollment` returns `'allowed', not v_enforced` when
  `p_device_public_id` is null or empty —
  `20260926000000_a23_persistent_enrollment_holds.sql:49-56` — so on an
  *enforced* shop a caller that supplies no installation id is refused even
  with no hold. The unconditional `allowed: true` is the branch at `:57-60`,
  which requires a device public id. The new-shop conclusion survives, because
  every current client supplies one; the wording did not.

Note also that the constraints this document reasons about were later
canonicalised by `20261008000000_h9_enrollment_hold_constraint_normalization.sql`,
which replaces the consumption CHECK with a verified-equivalent copy (`:73`) and
proves the approval CHECK is unchanged and singular (`:141`). Revisions 1 and 2
did not cite it. It matters here specifically because Option D depends on
one-shot atomic consumption, which is the rule that migration normalised.

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

But the states that ARE unrecoverable must be stated as an invariant, not as a
list. Revision 2 listed two and called them exhaustive; review 2 found a third
and was right. Enumerating is what produced both errors, so:

> **Recovery is impossible whenever a hold exists for `(shop_id,
> actor_user_id)` and no accessible, active, session-bound Owner/Manager
> installation other than the hold's `source_device_id` remains.**

That is the whole dead end. Every case below is an instance of it, and the list
is illustrative, not a boundary:

1. **Self-revocation of the last installation** (`a23_revoke_device`). Hold
   created, device revoked.
2. **Self-revocation of the last BINDING** (`a23_revoke_binding`) — the case
   revision 2 missed. The *device row stays `active`*; only the binding is
   revoked, and a hold is still created (`:1238`). `a23_revoke_binding`
   (declared `:1196`) asserts nothing but `a23_assert_device_admin` at `:1208`:
   there is **no self-target
   guard and no last-admin guard**, so an Owner may pass their own id as
   `p_target_actor_user_id`. `a23-device-registry.pgtest.ts:338` already
   executes exactly that call successfully, incidentally, while testing registry
   versioning. Recovery is then blocked because `a23_approve_enrollment`
   requires the *caller's own* binding to be active — `b.actor_user_id =
   p_caller_user_id and b.status = 'active'` at `:1480-1489` — which is
   precisely what was just revoked. The still-active device cannot approve.
3. **Loss, clearing, or key-unwrap failure of the last remaining installation
   while a hold is outstanding** from an earlier revocation.

Case 1 is already encoded in the test suite by name:
`a23-device-registry.pgtest.ts:579`, *"leaves a sole-admin revoked-device case
blocked pending manual recovery"* — approval refused `MU071`, enrolment refused
`MU070`. Case 2 is **not** covered by any test asserting the lockout; the only
test that performs it is asserting something else. That gap is worth closing
whatever is decided about recovery policy, because a guard added later has
nothing pinning the behaviour it is meant to change.

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

### Option D — pre-issued independent recovery credential (PREFERRED DIRECTION, NOT YET A DESIGN)

From review 1, and still the preferred direction. Review 2 did **not** reject
the direction; it rejected the specification as incomplete, with four MAJOR
findings that must be answered before this is a design rather than an
intention. They are recorded as requirements in "What Option D still owes"
below. Revision 2 called this "RECOMMENDED", which overstated how finished it
was.

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

#### What Option D still owes

Review 2's four MAJOR findings, as requirements. None is answered yet, and
answering them is design work that needs its own scoped rule 10 approval.

1. **It contradicts this document's own "satisfy, never skip" rule.** §0 says no
   option may skip `a23_approve_enrollment`. That function requires a real
   active administrator session and writes both FK-backed approver ids
   (`:1480-1489`, `:1511`). A recovery credential cannot satisfy it unchanged.
   So Option D must openly choose one of: a separate recovery-redemption RPC, or
   an explicit refactor of `a23_approve_enrollment`'s signature and invariants.
   What it must NOT do is borrow a real user/device id to look like an approval —
   that falsifies the audit record, which is the objection that killed revision
   1's Option A. The honest admission is that Option D needs **new** storage for
   the credential, **new** storage for the recovery request/grant, a revised
   XOR-style provenance constraint, and an extended `device_registry_events`
   vocabulary with grants.
2. **Redemption atomicity and denial of service are unspecified.** "Consumed
   atomically" never says atomic *with what*. Today every preflight retry
   rewrites `requested_at`, replaces the requested installation and clears any
   prior approval (`20260926000000:80`), and a *successful* phone+PIN attempt is
   not charged as a failure before that preflight runs
   (`deviceLogin.ts:187-201`). So an attacker holding handset and PIN can
   substitute requested installation ids indefinitely, and a lost response or a
   downstream bind failure could burn the only recovery code and strand the
   legitimate owner. Required: an immutable request id frozen only after valid
   code proof; compare-and-consume, hold satisfaction, exact-installation
   authorisation and the enrolment grant in **one** transaction; idempotent
   retry after a lost response; an ordinary unauthenticated preflight that can
   never rotate or invalidate the credential; and separate rate limits for
   request creation, redemption, shop/actor, and global abuse.
3. **A recovery code is an authenticator, not identity proof.** Possession
   proves control of a bearer secret, nothing about the person. A photographed,
   copied, co-located or carelessly provisioned code becomes takeover authority
   — and "stored off the handset" does not mean "stored apart from the handset":
   a code in the same drawer as the phone shares its compromise. Option D must
   state explicitly which it requires: code + phone/PIN, code + a fresh OTP, or
   code alone with a written, accepted lower-assurance risk. NIST SP 800-63B-4
   also requires secure delivery, ≥64 bits of approved randomness, hashing,
   throttling, invalidation after use, replacement issuance and recovery
   notification. And the capability must be evaluated at **every**
   credential-proving binding path — `deviceLogin.ts`, `recoverPin.ts`,
   `linkDevice.ts` and the shared SQL gate — not only the two OTP-bearing ones
   this document previously named.
4. **No notification design.** §4 constraint 5 demands recovery be contestable
   by a legitimate owner who did not initiate it, and Option D provides no way
   to contest anything. Theft of the code would allow a silent takeover plus
   credential rotation. Notification must reach the primary number but **never
   only** it: also every active administrator installation, at least one
   independently verified secondary address or designee, and support/audit
   monitoring. Provisioning, replacement, rotation, successful redemption and
   failed-abuse thresholds should all notify, and a contact change must notify
   both the old and the new address.

Finding 4 is the uncomfortable one, because it partly re-imports Option C.
Option D needs an independently verified second contact to be contestable, and
§5's Option C says a second contact is only viable with verified independent
control, consent and revalidation. So D and C are not alternatives: **D needs
C's contact machinery for its notification half**, even though a second contact
grants no approval authority on its own. Revision 2 presented them as separate
options and that was wrong.

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

**D as the preferred direction once it owes nothing above, carrying C's
verified-contact machinery for its notification half; B as the only path for
owners already locked out today. A is withdrawn.**

Two things this document should stop implying. It is not a menu of four
independent options — the viable shape is D+C together, with B as the
human fallback. And none of it is a design yet: the four requirements above are
unanswered, so there is nothing here anyone could implement from.

Independent of any recovery policy, two cheaper changes stand on their own and
would each shrink the problem. Both are proposals, not decisions:

- **A last-admin / self-target guard on `a23_revoke_binding` and
  `a23_revoke_device`.** Refusing the call that strands the shop is far simpler
  than building a way back from it, and today nothing refuses it (`:1196`).
  This narrows cases 1 and 2 of §3 to "cannot happen" rather than "needs
  recovery". It does not help case 3.
- **A test pinning case 2's lockout**, which nothing currently asserts.

## 6. Relationship to H-11 Part B

Found while Part B's first attempt was blocked at enrolment on unsuitable DEV
identities. One correction to how revision 2 put this: it asserted those
identities "already carried a hold from earlier A2.3 testing". **That was never
verified and cannot be.** All five A2.3 registry tables are revoked from
`service_role` (`20260923000000:329-333`), so every available credential gets
403 / SQLSTATE 42501 on `device_enrollment_holds` — the inventory is
unreadable, which is the control working, not a gap. The accurate statement is
that enrolment was refused and the cause could not be read.

Part B does **not** need this fix, and that is now demonstrated rather than
argued: a genuinely new synthetic shop (`B3-PARTB-SYNTH`) was created and
enrolled on 2026-11-03, passing the gate, which is invoked on that path via
`linkDevice.ts:128` after the Owner row is created. The gate passes; it is not
absent.

Part B was subsequently **executed and is NOT PASS** — for unrelated reasons
(the run did not follow `backend/supabase/checks/restore_drill.md`'s steps
10-16). See §10 of `b3-device-check-reconciliation-2026-11-01.md`. Nothing in
this document's subject matter contributed to that outcome, and nothing here
blocks the re-run.

## 7. Status and what remains open

| Revision | Review verdict | The single most important fix named |
|---|---|---|
| 1 | **REJECT** | Replace elapsed silence as an approval authority with an independent credential or an independently verified approval |
| 2 | **REJECT** | Correct the lockout boundary: state the invariant, and add self-revocation of the last *binding* |
| 3 | not yet reviewed | — |

Revision 3 fixes revision 2's factual error and records the four Option D
requirements. It does **not** answer them, so a third review would be reviewing
a corrected problem statement, not a finished design.

**Nothing has been implemented.** No credential exists, no hold policy changed,
no migration written or deployed. Any of it needs its own scoped rule 10
approval.

Still open:

1. The four Option D requirements above — the substantive design work.
2. Does Option D's credential need to survive a shop that has never had a
   second installation, and what is the provisioning moment — onboarding, or
   first sync?
3. What identity-proofing standard should Option B require, given it is the
   only route for owners already locked out today?
4. Does the pending-request state belong in a new table, given constraint 3?
5. Should provisioning a recovery credential be P0 for Batch 4 onboarding? It
   prevents new instances but does nothing for the existing field population.
6. Should the cheap guard on `a23_revoke_binding` / `a23_revoke_device` be
   decided **first**, independently? It is a much smaller change than any
   recovery mechanism and removes two of the three §3 cases. Deciding recovery
   policy first risks building a way back from a state that should simply be
   refused.

---

## 8. Review provenance

| | Review 1 | Review 2 |
|---|---|---|
| Subject | revision 1 | revision 2 |
| Date | 2026-11-03 | 2026-11-04 |
| Verdict | REJECT | REJECT |
| Findings | 2 BLOCKING, 3 claims spot-checked | 1 BLOCKING, 4 MAJOR, 2 MINOR |
| Reviewer | independent agent, read-only, source-checked | independent agent, read-only, source-checked |

Every finding of review 2 that rests on a file and line was re-verified against
that file before being written into this revision: the hold-creator set, the
missing self-target and last-admin guards (`:1208`), the approver's
own-active-binding requirement (`:1480-1489`), the `allowed: not v_enforced`
branch (`20260926000000:49-56`), the preflight rewrite (`20260926000000:80`),
the uncharged successful attempt (`deviceLogin.ts:187-201`), the H-9
normalisation (`:73`, `:141`), and `pgtest:338`. All held. No finding was
accepted on the reviewer's authority alone, and none was discarded.
