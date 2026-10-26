# Admin metric definitions — Batch 3

**Status: the definitions are implemented and tested locally. No figure
described here has been verified against hosted production data.**

Every money figure the Admin Panel renders reaches the screen through a typed
`Metric` in `apps/admin/lib/adminMetrics.ts`, and every one of those carries a
`definitionRef` naming a heading in THIS file. `adminMetrics.test.ts` asserts
that each `definitionRef` resolves to a heading here, so a figure cannot be
shown with a definition nobody wrote down.

This document exists because three completely different quantities get called
"revenue" in a pharmacy platform:

1. **Muthoy's own recurring income** from subscriptions — a run rate;
2. **Cash Muthoy actually collected** from verified payment orders;
3. **What the pharmacies themselves sold** — somebody else's money entirely.

They are kept apart by construction. `lib/adminMetrics.ts` tags every metric
with a `family` of `subscription`, `pharmacy_sales` or `count`, and
`adminMetrics.test.ts` asserts per family that no pharmacy-sales label says
revenue, MRR, ARR or profit and no subscription label says sales or net. A
component cannot be handed a caption: `MetricTile` takes a `Metric` and has no
prop a caller could pass a string through.

---

## MRR

**The forward-looking monthly run rate of subscriptions currently being paid
for. It is not cash, and it is not a figure to add to anything.**

The qualifying predicate derives from the canonical one the database itself
uses, `b4_user_has_premium`
(`backend/supabase/migrations/20260831000000_b4_commercial_platform.sql:262-272`):

```
premium :=  (status = 'trialing' AND trial_ends_at  > now)
         OR (tier IN ('pro','ultra') AND status IN ('active','canceled')         AND paid_through  > now)
         OR (tier IN ('pro','ultra') AND status IN ('active','past_due','grace') AND grace_ends_at > now)
```

Two things in that predicate are easy to get wrong, and an earlier draft of the
plan got both wrong:

- an **`active`** row qualifies through *either* `paid_through` **or**
  `grace_ends_at`, so testing `paid_through` alone silently excludes an active
  subscription that is inside its grace period;
- a **`canceled`** row with `paid_through > now` is **still entitled**, because
  the access it already paid for runs to the end of the period.

MRR is the canonical predicate **minus trialing** (a trial pays nothing) **and
minus canceled** (a cancellation will not recur):

```
tier IN ('pro','ultra')
AND (   (status = 'active'                       AND paid_through  > now)
     OR (status IN ('active','past_due','grace') AND grace_ends_at > now) )
```

**The amount.** The `plan_offerings` row matching the subscription's own `tier`
and `billing_cycle`. `is_active` is deliberately ignored, so a grandfathered
price still counts — the subscription is being paid at the price it was sold at,
not at today's. A `monthly` cycle contributes its full amount; an `annual` cycle
contributes `floor(amount_paisa / 12)`. **The flooring residue is never
redistributed**, and the page says the annual contribution is floored rather
than leaving a reader to discover a few paisa missing.

**One subscription per account.** An account with historical subscription rows
is counted once, through its current row. A test plants two rows for one account
and asserts the count is one.

**A subscription whose tier and cycle match no offering contributes nothing**,
and the count of such rows is reported beside the figure rather than folded into
it silently.

### Why the MRR trend is BLOCKED and not shown

`docs/playbook/05-admin.md:58` asks for an MRR trend *"computed from
`subscriptions` history"*. **That history does not exist.** A renewal updates the
same `billing_subscriptions` row, so last month's run rate is not recoverable
from current state at all.

What `/revenue` shows instead is a **collected subscription payments** series
from verified payment orders, labelled as itself. That is real evidence and it is
a different quantity — cash that arrived, not run rate. Calling it the MRR trend
would be exactly the mislabelling this document exists to prevent.

A historical run-rate series needs an immutable subscription-lifecycle-event
table. That is gate **E12**, and it is not built.

### Churn is also not claimed

For the same reason. See *Recorded cancellations* below.

---

## Collected subscription payments

**Cash Muthoy received. Not a run rate, not an expectation, and not a forecast.**

The sum of `payment_orders.amount_paisa` where `status = 'verified'`, bucketed by
`verified_at` for the monthly series.

- A `created`, `pending`, `failed` or `expired` order contributes **nothing**. An
  order somebody started is not money received.
- An order marked `verified` with **no `verified_at`** cannot be placed in a
  month. It is excluded from the series, **counted separately**, and reported as
  a billing exception on `/revenue` — not silently dropped, because then the
  series total and the order count would disagree and neither page would say so.
- Historical SSLCommerz orders stay readable and reconcilable. **No bKash figure
  exists, because no bKash order exists** — the gateway is not activated
  (W4-10 stands).

---

## Pharmacy sales (refund-net)

**What the pharmacies sold, net of their own refunds. This is somebody else's
money and is never added to anything above.**

```
netSalesPaisa(sum(sales.total), sum(sale_refunds.total_amount))
```

computed through the single shared definition in `packages/utils`
(`netSalesPaisa`), which W4-04 introduced so the mobile report and the admin
panel cannot disagree about the subtraction.

**Both sides are windowed on `business_date`**, the same column, which is the
W4-04 correction: a sale windowed on `created_at` and its refund windowed on
`business_date` disagree for every sale rung up after 6pm Dhaka.

**The per-shop drill-down still says `Gross sales today`, verbatim.** A per-shop
figure stays gross because `sale_refunds` is read platform-wide, so subtracting
it from one shop's sales would be wrong. `adminLabels.test.ts` asserts that
wording on `/shops/[id]` and asserts that the dashboard's platform-wide figure
is the net one.

### k-anonymity on every aggregate

Any bucket, series point or export row derived from fewer than **5 distinct
contributing shops** renders as an em dash and exports as empty. One function,
`suppressBelowK`, and the floor is on the number of **distinct shops**, not on
the row count — a hundred sales rows from one pharmacy is still one pharmacy.

**Registration metadata is exempt**, per plan §8.10: a count of pharmacies that
registered on a day is not a disclosure about any of their trade. The Dashboard's
registration trend is therefore unsuppressed and its activity trend is
suppressed, and the page says which is which.

---

## Counts, named for what they measure

Each of these is named for the thing it counts, so no reader has to infer what a
number means from where it sits on a page.

| Metric | Definition |
|---|---|
| **Registered pharmacies** | non-deleted `shops` rows |
| **Pharmacies active today** | distinct shops with at least one non-deleted `sales` row whose `business_date` is the Dhaka day |
| **Active subscriptions** | `billing_subscriptions` rows in status `active` |
| **Trial subscriptions** | `billing_subscriptions` rows in status `trialing` |
| **Accounts that have ever paid** | accounts holding at least one `payment_orders` row with `status = 'verified'`, ever |
| **Trial to paid conversion** | accounts with `launch_trial_granted_at` that later hold a verified order, over accounts with `launch_trial_granted_at`. **Null, not zero, when nobody was ever granted a trial** — "0% converted" reads as a failure and "no trials granted yet" is the truth |
| **Expired without cancellation** | `paid_through < now` with `canceled_at` null. A different event from a cancellation, so it is counted apart |

**Accounts ever paid and currently paid entitlements are shown side by side
deliberately. The gap between them is itself information** — it is the accounts
that paid once and no longer have access.

### The Dashboard's five alert classes

All five are computed, all five are always listed, and a zero is shown rather
than omitted — an absent row reads as an unchecked one, and on an operational
page those are opposites.

| Alert | Definition |
|---|---|
| Subscriptions expiring within 7 days | the running period end (`grace_ends_at` where a grace period is what expires, else `paid_through`) falls inside the horizon **and is still in the future**. A period that has already ended is *expired*, not *expiring* |
| Accounts past due or in grace | `entitlement_snapshots.status` in `past_due` or `grace` — the status a device actually honours |
| Pharmacies with no billing account | `billing_account_id` is null **and** the shop registered more than 24 hours ago. A shop and its billing account are two separate writes, so a fresh signup is briefly expected to have neither |
| Payment orders open past expiry | status `created` or `pending` with `expires_at` in the past |
| Provider events rejected | `payment_provider_events.processing_status = 'rejected'` — a payment signal the server refused |

---

## Currently paid entitlements

**What a device would honour right now, on the strength of a payment.**

The canonical predicate above **minus the trialing branch** — a trial is premium
but pays nothing. It **includes** a `canceled` row still inside its
`paid_through`, because that access has been paid for and withdrawing it early
would be taking away something the pharmacy bought.

`entitlementCounts` returns three figures over one pass: `trialing`,
`currentlyPaid` and `entitled`. **`entitled` is counted over the rows rather than
added from the other two**, because the two branches are not provably disjoint
and a total computed by addition would be wrong in exactly the case nobody tests.

This figure, not MRR, is what answers "how many pharmacies are paying us right
now". MRR answers "how much per month", and the two can move in opposite
directions.

---

## Recorded cancellations

**Subscriptions with `canceled_at` inside a stated period. This is NOT a churn
trend and is not labelled one.**

A renewal updates the same `billing_subscriptions` row and clears `canceled_at`
(`20260831000000:704`). So a count over all time is not "every cancellation
ever" — it is "every cancellation that has not yet been overwritten by a
renewal", which is a figure whose meaning changes as rows renew.

That is why the period is **explicit and stated on the page** (90 days), and why
the figure is called *recorded cancellations* rather than churn. A churn series
needs the same immutable lifecycle-event table the MRR trend needs: gate **E12**.

**Expired without cancellation** is reported next to it as a separate figure,
because a subscription that lapsed and one that was cancelled are different
events and a single number covering both would answer neither question.

### Renewal history

From **verified `payment_orders` only**, newest first. A `created` or `pending`
order is a renewal somebody began; a `failed` or `expired` one is a renewal that
did not happen. Counting any of them would show a pharmacy renewing on a day it
did not pay — the kind of error that reaches a founder as a number and never as
a bug.

`billing_subscriptions` is **current lifecycle state only** and is labelled as
such wherever it appears. It is not a history.

### The next billing date, and why it carries its basis

`/subscriptions` prints the next billing date **and the field it came from**,
because a bare date invites the reader to assume a charge:

| Status | Date shown | Basis |
|---|---|---|
| `active` | `paid_through` | end of the paid cycle |
| `trialing` | `entitlement_snapshots.trial_ends_at` | end of the trial |
| `past_due`, `grace` | `grace_ends_at`, else `paid_through` | end of the grace period |
| `canceled`, `expired` | **em dash** | nothing scheduled |

A terminal row gets an em dash rather than falling back to `paid_through`:
`paid_through` on a canceled row is when access ran out, in the past, and showing
it under "next billing" would read as an upcoming charge. A `trialing` row with
no entitlement snapshot also gets an em dash, because the one record that knows
when the trial ends is missing — `billing_subscriptions` has no trial column.

---

## What is deliberately absent

| Figure | Why |
|---|---|
| MRR trend / historical run rate | the history does not exist on a mutable row — gate **E12** |
| Churn rate or churn series | same reason |
| ARR | not computed, and the word is banned in every label by `adminLabels.test.ts` |
| Profit | Muthoy does not hold the cost side of a pharmacy's sales, and does not compute its own |
| Any per-shop financial export | `/reports` ships platform aggregates and registration metadata only; a test asserts no report row carries a sale, a customer or a medicine |
| Any bKash figure | the gateway is not activated. There is nothing to report, so nothing is reported |

---

## Where each definition is enforced

| Claim | Enforced by |
|---|---|
| every rendered money figure comes from a `Metric` | `components/PageParts.tsx` has no caption prop; `adminLabels.test.ts` asserts every `MetricTile` resolves through `requireMetric` |
| no family is mislabelled | `adminMetrics.test.ts`, per family |
| every `definitionRef` resolves to a heading in this file | `adminMetrics.test.ts` |
| the canonical predicate is not re-derived | `adminMetrics.test.ts`, against a fixture with one row of every status, including the two cases an earlier draft got wrong |
| the net figure really is net | `adminLabels.test.ts`'s two-link provenance chain: the word `net` may only attach to the one net-typed field, and that field may only be produced by the shared `netSalesPaisa` |
| money renders in DM Mono | `adminLabels.test.ts` (CLAUDE.md rule 6) |
| a 4-shop bucket is never visible | `adminSuppression.test.ts`, at the k−1 / k boundary |

**None of the above is a claim about hosted data.** Gate **E15** — the deployed
browser/devtools check — remains open, and no admin page is DONE without it.
