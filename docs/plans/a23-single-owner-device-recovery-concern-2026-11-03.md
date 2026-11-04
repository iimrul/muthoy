# A2.3 production-readiness concern: recovery for a shop with one Owner device

Raised 2026-11-03, out of H-11 Part B. **Revision 4, 2026-11-04**, after a
THIRD independent security/architecture review returned **REJECT** on revision
3. Revision 1's Option A is retained below only as a rejected option, with the
reasons, because the reasons are the useful part.

**Three rejections, and the pattern is mine.** Each revision got the *boundary*
wrong in a different way: revision 1 by narrating an impossible sequence,
revision 2 by enumerating two states and calling them exhaustive, revision 3 by
replacing the enumeration with an invariant that was itself false. So revision 4
does not offer a fourth formulation of my own. **The predicate in §3 is the
reviewer's, derived from the SQL, and I verified every clause of it against the
source before adopting it.** Where earlier revisions reasoned from the shape of
the system, the text below cites the line that decides each claim.

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

Note also `20261008000000_h9_enrollment_hold_constraint_normalization.sql`,
which revisions 1 and 2 did not cite. **Revision 3 cited it but described it
wrongly**, and review 3 corrected that. What it actually does: creates a
temporary comparison probe (`:73`), keeps an already-correct canonical
constraint, creates one only if absent, drops the known equivalent duplicate
(`:93`), and proves the approval CHECK is singular (`:141`).

**And the correction matters more than the wording.** Revision 3 linked that
CHECK to "one-shot atomic consumption". It is not the concurrency guarantee —
it only enforces field consistency. One-shot consumption comes from the **hold
row lock**: `select * into v_hold from device_enrollment_holds … for update`
followed by the consumed-state test and a transactional update
(`20260923000000:922-930`), pinned by
`a23-device-registry.pgtest.ts:522`, *"admits at most one concurrent consumer of
an exact approval"*. Any Option D design must build on that lock, not on the
CHECK — treating a consistency constraint as a compare-and-consume guarantee is
how a future revision would reintroduce a race.

So a brand-new Owner registering a brand-new shop is unaffected, and so is any
shop/actor pair that has never been revoked. `a23-device-registry.pgtest.ts`
pins this directly: *"keeps normal non-revoked strong-auth enrolment
available"* asserts `allowed: true, held: false`.

## 3. The actual dead end — corrected

Revision 1 narrated: owner loses phone, revokes it, cannot enrol a replacement.
The narrative was wrong, but **revisions 2 and 3 over-corrected it** and review
3 caught that too.

What is true: in the ordinary lost-phone case the owner signs in on the
replacement first — no hold exists, so it enrols — and revokes the lost
installation afterwards, from the replacement. That remains the correct
sequence for a current client.

What revisions 2 and 3 wrongly stated as a general property: *"revoking is a
guarded action requiring a bound session."* It is not. **Neither revoke RPC
takes a session id**, and each asserts only administrator role —
`a23_revoke_binding` at `:1208` and `a23_revoke_device` at `:1340`, both
`perform a23_assert_device_admin(...)` and nothing more. At the transport layer,
an **unbound legacy session is admitted while the shop has not enforced**:
`deviceRegistryPolicy.ts:392` is literally
`return facts.enforced ? refuse("device_session_unbound") : { allowed: true };`
So on a shop with `devices_enforced_at is null`, revocation by an unbound caller
is reachable, and the threat model must include it.

### The predicate

Revision 3 wrote: *"Recovery is impossible whenever a hold exists for
`(shop_id, actor_user_id)` and no accessible, active, session-bound
Owner/Manager installation other than the hold's `source_device_id` remains."*
**That was false**, and review 3 supplied the counterexample. Verified against
source:

`a23_prepare_enrollment` returns `allowed: true, held: true, approved: true`
when `approved_device_public_id = p_device_public_id and approved_at is not null
and consumed_at is null` — `20260926000000:71-78` — and it **consults the
approver not at all**. `a23_enroll_device` applies the same three-part test
(`:134-140`, and the internal copy at `20260923000000:922-930`). So once a
different installation has approved the exact replacement, that replacement
enrols **even if the approver is subsequently revoked, lost or destroyed**.
Revision 3's predicate classified that working recovery as impossible.

And because a hold row **persists after consumption**, "a hold exists" does not
mean "enrolment is currently blocked" — which revision 2 had already noted and
revision 3's own predicate then ignored.

The correct predicate, from review 3 and verified clause by clause:

> **Recovery through current A2.3 paths is unavailable when the exact
> replacement lacks a valid unconsumed approval, AND no live Owner/Manager can
> present an eligible session mapped to an active device and an active binding
> OF THEIR OWN on a device different from the hold's `source_device_id`.**

Both halves are load-bearing. The first is what `20260926000000:71-78` tests;
the second is what `a23_approve_enrollment` requires at
`20260923000000:1480-1489`.

The cases below are instances, **each qualified by "and no valid unconsumed
exact-device approval exists"**. The list is illustrative, not a boundary:

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
4. **A Manager revokes an Owner's binding on their sole SHARED installation** —
   added by review 3. The Manager's own binding stays active, so there IS a live
   admin with an active binding; but that installation is the hold's
   `source_device_id`, and `a23_approve_enrollment` refuses an approver whose
   device is the hold source (`:1506`). So the shop has an administrator, an
   active device and an active binding, and still cannot approve. This is the
   case that most clearly shows why the predicate has to name
   `source_device_id` rather than "an active installation".

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
4. **No notification design — and notification is not contestability.**
   Revision 3 answered this with a delivery list and review 3 called that
   incomplete, correctly. **Notification DETECTS fraud; it does not make a
   recovery reversible.** Option D still specifies no repudiation response: no
   grant suspension, no rollback or rebinding procedure, no session
   termination, no service level, and no named authority able to reverse a
   fraudulent recovery. NIST requires that a notification carry instructions
   for repudiating the event, not merely that it be delivered. Delivery must
   still reach the primary number and **never only** it — also every active
   administrator installation, at least one independently reachable secondary
   address, and support/audit monitoring — for provisioning, replacement,
   rotation, successful redemption and failed-abuse thresholds, with a contact
   change notifying both the old and the new address.

Five further gaps, all still open:

- Who may issue, replace, rotate, revoke or reissue the code, and what step-up
  proof each of those operations requires.
- **How a compromised active handset is prevented from replacing the legitimate
  offline code before self-revoking.** This is the sharpest one: it would turn
  the recovery credential into the attacker's tool.
- The concrete response when a notification is repudiated.
- The PostgreSQL-versus-GoTrue transaction boundary, and compensation plus
  idempotency when session minting happens outside the recovery-grant
  transaction.
- An explicit recovery assurance classification and the accepted factor
  combination.

**Correction to revision 3's "D needs C" claim.** Revision 3 said Option D
needs Option C's machinery for its notification half. Review 3 found that
**overstated**, and it is: Option D needs *managed, independently reachable
notification addresses*. A recovery **contact** is a separate recovery
*authority*, and NIST treats notification addresses and recovery contacts as
different things. C-like consent and revalidation are required only if a
designee is actually given authority. So D and C are neither alternatives nor
a package — D needs addresses, not a second approver.

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

**D as the preferred direction once it owes nothing above, with managed
independent notification addresses (NOT Option C's approval authority); B as the
only path for owners already locked out today. A is withdrawn.**

Two things this document should stop implying. It is not a menu of four
independent options — the viable shape is D with managed notification
addresses, and B as the human fallback. And none of it is a design yet: the
four requirements and five gaps above are unanswered, so there is nothing here
anyone could implement from.

**The first decision is not an option at all.** Per review 3: settle the
compromise-versus-availability policy and the recovery assurance target before
choosing a mechanism. Every option above trades those two against each other,
and the trade has never been stated, let alone decided.

**Revision 3 said the revocation guard was "a much smaller change than any
recovery mechanism" and should be "decided first, independently". Review 3
refuted that, and I accept the refutation.** It is recorded here because the
reasons generalise:

- **`p_target_actor_user_id = p_caller_user_id` is not a safe self-target
  test.** It would block an Owner, standing on a replacement device, from
  revoking their own binding on the stolen old one — the exact action the
  correct lost-phone sequence depends on.
- **`a23_revoke_device` cannot identify the caller's current device.** Its
  signature carries no `auth_session_id` (`:1330-1334`), so "am I revoking the
  device I am standing on?" is unanswerable without a signature change plus
  session validation equivalent to approval's.
- **"Last admin" must mean post-operation recovery CAPACITY**, not last admin
  person: at least one live Owner/Manager holding an active binding on an
  active device other than the target, computed after the operation. A
  person-based test is the wrong unit.
- **The schema cannot know what is physically reachable.** A structurally
  active binding may sit on a handset that is lost or whose key material no
  longer unwraps, so a guard can be satisfied by an installation nobody can use.
- **It is not race-free as proposed.** Both revocations lock only the TARGET
  device row — `select * into v_device from shop_devices … for update` at
  `:1210` and `:1342` — so two concurrent revocations of *different* devices
  each observe the other as still active and both proceed, racing the shop to
  zero recovery-capable installations. Race freedom needs a shop-scoped lock and
  a post-state computation, and every role-change and deactivation path would
  have to adopt the same protocol.
- `devices_enforced_at` must NOT enter the calculation. Holds and approval
  restrictions apply either way; that flag only decides whether an unbound
  legacy caller reaches the operation at all.

**And the trade may be the wrong way round.** A guard strong enough to prevent
case 1 would also refuse *immediate containment of a compromised sole device* —
leaving a suspected attacker authorised in order to preserve availability.
NIST SP 800-63B-4 treats failure to invalidate a compromised authenticator as
generally more serious than an erroneous invalidation denial-of-service. So:

> **Decide the compromise-versus-availability policy and the recovery assurance
> target FIRST. Then add a guard as defence in depth. The guard does not
> replace recovery, and it must not be sequenced ahead of it.**

What does stand on its own, and is cheap: **a test pinning cases 2 and 4**,
which nothing currently asserts.

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
| 3 | **REJECT** | The invariant is still false — an already-approved, unconsumed exact replacement enrols without the approver |
| 4 | not yet reviewed | — |

Revision 4 adopts the reviewer's predicate, adds the fourth lockout state,
withdraws the "decide the guard first" advice and the "D needs C" claim, and
corrects the H-9 description. It answers **none** of Option D's requirements, so
a fourth review would again be reviewing a corrected problem statement, not a
design.

**Nothing has been implemented.** No credential exists, no hold policy changed,
no migration written or deployed. Any of it needs its own scoped rule 10
approval.

Still open, in order:

0. **The compromise-versus-availability policy and the recovery assurance
   target.** Review 3's sequencing point: this precedes every option, and
   nothing below can be decided without it.
1. The four Option D requirements and five gaps above — the substantive design
   work.
2. Does Option D's credential need to survive a shop that has never had a
   second installation, and what is the provisioning moment — onboarding, or
   first sync?
3. What identity-proofing standard should Option B require, given it is the
   only route for owners already locked out today?
4. Does the pending-request state belong in a new table, given constraint 3?
5. Should provisioning a recovery credential be P0 for Batch 4 onboarding? It
   prevents new instances but does nothing for the existing field population.
6. ~~Should the guard be decided first, independently?~~ **Answered: no.**
   Review 3 showed it is neither cheap nor independent, and that sequencing it
   ahead of recovery risks refusing urgent containment of a stolen sole device.
   See §5. What remains open is the guard's *definition* once question 0 is
   settled: specifically the post-operation recovery-capacity rule, the
   shop-scoped lock, and whether `a23_revoke_device` gains an
   `auth_session_id`.
7. A test pinning §3 cases 2 and 4, which nothing currently asserts. This is
   the one item here that needs no policy decision first.

---

## 8. Review provenance

| | Review 1 | Review 2 | Review 3 |
|---|---|---|---|
| Subject | revision 1 | revision 2 | revision 3 |
| Date | 2026-11-03 | 2026-11-04 | 2026-11-04 |
| Verdict | REJECT | REJECT | REJECT |
| Findings | 2 BLOCKING, 3 claims spot-checked | 1 BLOCKING, 4 MAJOR, 2 MINOR | 1 BLOCKING, 3 MAJOR, 1 MINOR |
| Reviewer | independent agent, read-only, source-checked | as before | as before |

Every finding of reviews 2 and 3 that rests on a file and line was re-verified
against that file before being written into this revision. Review 2: the
hold-creator set, the missing self-target and last-admin guards (`:1208`), the
approver's own-active-binding requirement (`:1480-1489`), the
`allowed: not v_enforced` branch (`20260926000000:49-56`), the preflight rewrite
(`20260926000000:80`), the uncharged successful attempt
(`deviceLogin.ts:187-201`), the H-9 normalisation (`:73`, `:141`), `pgtest:338`.
Review 3: the already-approved enrolment path (`20260926000000:71-78`,
`:134-140`, `20260923000000:922-930`), the `source_device_id` approver exclusion
(`:1506`), `a23_revoke_device`'s admin-only assert and absent session id
(`:1330-1334`, `:1340`), the per-device-only revocation locks (`:1210`,
`:1342`), the unbound-legacy admission
(`deviceRegistryPolicy.ts:392`), and `pgtest:522`. **All held.**

No finding was accepted on the reviewer's authority alone, and none was
discarded. Three of the four substantive errors across these revisions were
mine asserting a boundary the source does not support; the fourth was asserting
a concurrency guarantee from a consistency constraint. Both are the same
mistake in different clothing — reasoning from the shape of the system instead
of from the line that decides it.
