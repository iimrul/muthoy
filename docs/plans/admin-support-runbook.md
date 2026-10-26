# Admin support runbook

**Batch 3. CODE-COMPLETE. The tables live in migration 35, which is NOT applied
to any hosted project — so on a deployed panel today the Support page would fail
its read, and no support history exists anywhere.**

## What a case is

A row in `admin_support_cases` — a **platform** table, not a shop table. Opening
a case about a pharmacy writes nothing into that pharmacy's data.

| Field | Values |
|---|---|
| `status` | `open`, `pending`, `resolved`, `closed` |
| `priority` | `low`, `normal`, `high`, `urgent` |
| `category` | `onboarding`, `sync`, `payment`, `data`, `device`, `account`, `other` |
| `shop_id` | **NOT NULL** — a case always belongs to a pharmacy |
| `summary` | ≤ 2 000 characters (the CHECK bound) |

Notes live in `admin_support_notes`, with `body` ≤ 8 000 characters.

**These values are not a matter of taste.** They are CHECK-constrained in
migration 35, and `adminSettings.test.ts` **parses the migration SQL** to
compare them against the TypeScript. An earlier draft had drifted on all of them
— five value spaces — and the test that was supposed to catch it compared three
TypeScript copies to each other, so it passed while every support write would
have failed at the database.

## Who can do what

| Action | Permission | Who holds it |
|---|---|---|
| read cases and notes | `support.read` | super_admin, support, read_only |
| open a case, transition it, add a note | `support.write` | super_admin, support |
| read a pharmacy's own audit log | `shop_audit.read` | super_admin, support |

**Support gains no `subscriptions.write` and no unrestricted shop access.** A
note is a row in an admin table; it is not a shop write. Support cannot change a
plan, extend a trial, or touch a pharmacy's stock or money — those surfaces do
not exist in the panel at all (gates E10 and E11).

## Notes are append-only by PRIVILEGE, not by UI

Migration 35 grants `insert` on `admin_support_notes` and nothing else.
`adminGrants.test.ts`'s `(module, table, operation)` manifest records exactly
that, and a synthetic module performing an `update` on it is one of the negative
controls.

So "a note cannot be edited" is a property of the database, not a property of
the form. That matters because a support note is the thing somebody reads
afterwards to work out what was done and said.

The FK from a note to its case is **`ON DELETE RESTRICT`**: deleting a case
cannot erase its note trail. An append-only table whose parent cascades is not
append-only.

## Every transition is audited

Each case transition and each note records an entry with the actor, the action,
the case id and the from/to values — all through the enumerated redaction
allowlist (`caseId` must be UUID-shaped or it is dropped). The audit is
**awaited** before the action returns, and a write that commits but fails to
audit returns the distinct `committed: true, code: 'audit_write_failed'` shape
with "applied, not recorded, do not retry" — never a plain failure that would
invite a duplicate note.

See `docs/plans/admin-audit-security.md`.

## Every payload is parsed by a shared schema

`adminSupportCaseCreate`, `adminSupportCaseUpdate` and `adminSupportNoteCreate`
live in `packages/validation`, per the repository rule that every Zod schema is
shared and never duplicated. Each is `safeParse`d **before** any table
operation, and `adminValidation.test.ts` asserts every exported action parses its
input through one of them before its first client call.

## The empty state is the truthful state

**The tables ship empty and no support history is fabricated.** The page's empty
state says so in words. On a fresh platform there are no cases because nothing
has happened, and that is different from a page that failed to load — the two
states read differently and are tested separately.

## Day-to-day flow

1. **Find the pharmacy.** `/pharmacies`, or the drill-down from a Dashboard
   alert.
2. **Read what is already known.** The drill-down's support-notes block lists
   that pharmacy's own cases, filtered on `shop_id` **in the query**. It is
   read-only there and links to `/support`.
3. **Open or pick up a case** on `/support`, using the status filter and the
   queue counts.
4. **Add a note** rather than editing one. The privilege enforces it.
5. **For a sync or data question**, read that pharmacy's own audit log on
   `/audit` — one shop at a time, read-only, gated on `shop_audit.read`.
6. **Transition the case** when it is pending or resolved. Every transition is
   audited.

## What support must escalate rather than attempt

| Request | Why it cannot be done here | Gate |
|---|---|---|
| "extend their trial" | the extend-trial design is superseded and unapproved; it needs an approved audited server API | **E10** |
| "refresh their entitlement so they get access back" | that action **extended paid access with no payment behind it** and was removed from the panel in this batch | **E11** |
| "change their plan" | no admin write to `billing_subscriptions` exists, by design | — |
| "fix their stock figure" | no admin write to any shop table exists, by design | — |
| "send them a notification" | no admin notification dispatcher exists anywhere in the product; the Settings templates are read-only and say so | — |

Each of those is a refusal with a reason, not a missing feature.

## What is NOT claimed

- **The tables do not exist on any hosted project.** Until migration 35 is
  applied (gate **E4-H**), the Support page cannot work against a real database,
  and this runbook describes a code path rather than an operating procedure.
- **No support case has ever been created.** There is no history, and none is
  invented.
- Gate **E15** applies: nobody has used this page in a deployed browser.
