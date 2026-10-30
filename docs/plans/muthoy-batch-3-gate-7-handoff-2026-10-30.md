# Batch 3 — Gate 7 handoff, and the dual acceptance record

**Date:** 2026-10-30
**Accepted code revision:** `ef08537`
**Codex verdict:** `ROUND 8: ACCEPT ef08537` — no material findings
**Claude verdict:** ACCEPT `ef08537` as a code revision. **Batch 3 is NOT CLOSED.**

---

## A. Executive result

**Batch 3 is CODE-COMPLETE AND DUAL-REVIEWED, NOT CLOSED.**

Both agents have independently reviewed the same revision and neither has a
material finding against it. That is what the code gate asked for and it is
met. It is not closure, because gates remain open and most of them need you
rather than more work from me. They are listed in §H and none of them is a
defect — two are decisions, the rest are hosted or physical operations.

I am not calling this DONE and I am not calling it BLOCKED. It is finished work
waiting on authorizations that were never mine to give.

## B. What changed by your authorization, and nothing else did

**One accepted requirement was changed, by your explicit decision of
2026-10-30: §8.2's per-pharmacy "Gross sales today".** It is removed from the
Admin shop drill-down, and the reader no longer computes it — a figure still
produced is a figure a future caller can render.

Why it had to go, in one line: with each pharmacy's gross visible, ten
pharmacies publishing 1 023 and a platform net of 682 give refunds of 341, and
exactly one of the 1 024 possible subsets sums to 341. **No value of k prevents
that**, because k counts how many pharmacies contributed and says nothing about
which.

What was preserved, as you required: pharmacy owners still see their own sales
in their own POS; W4-04 refund-net reporting still exists and still computes;
§8.10 confidentiality is unchanged; and the per-shop sale **count** stays,
because a count is not an amount and support needs to know whether a pharmacy
is trading. The reviewer attacked that last judgement specifically and could
not turn a count into an amount.

Everything else in §8 is as accepted. The plan's original §8.2 text is kept
unrewritten with an amendment note above it, so the record shows what changed
and when rather than reading as though it was always this way.

## C. Which money publishes, and which does not

| Figure | Status today | Why |
|---|---|---|
| Per-pharmacy gross sales | **Removed** | your Decision 1 |
| Platform net sales today (Dashboard) | **Withheld** | revisable: it could change as offline pharmacies sync |
| W4-04 monthly net report (CSV, PDF, preview) | **Withheld** | same |
| Analytics net series | **Withheld** | same |
| Revenue all-time pharmacy net | **Withheld** | same |
| Muthoy's own subscription revenue | **Published** | your Decision 4 — separate category |
| Payment orders on `/payments` | **Published** | Muthoy's own billing records |
| Counts: pharmacies trading, registrations, plan distribution | **Published** | not financial aggregates |

So: **every pharmacy-operational money figure is currently withheld, and
Muthoy's own money publishes.** At beta scale the withholding costs almost
nothing — the reviewer measured 0 of 5 monthly net outputs answering even
before this policy, because ten pharmacies rarely produce five distinct
refunders in a day.

Each withheld figure says it is withheld and why. None renders as a zero, and
none renders as a blank that could be mistaken for no activity — the CSV
carries that convention in the file itself, because a downloaded file has no
page around it to explain.

## D. Do historical gross disclosures still block earlier periods?

**Yes, and nothing has been released.** Figures published before the gross card
was removed are part of what a reader may already know. No previously
suppressed period was released on the strength of the removal, and no
suppression rule was relaxed anywhere in that change. Releasing any prior
period still requires the historical-release and differencing analysis you
asked for, and that analysis has not been done.

## E. The publication policy, and the one thing that would change it

**Policy: a confidentiality-sensitive pharmacy money figure is not published
while it could still change.** Today none can be proven final, so none
publishes.

A freshness delay cannot fix this, and the reason is this product's own
architecture: refunds are bucketed by their own business date, so a month is
final only once every device has synced — and Muthoy is offline-first by
design. `shops.updated_at` is a last-write-wins client timestamp and proves
nothing about what a device still has queued. Any delay long enough to be safe
would be a delay nobody can justify as safe, which is the unproven delay your
decision refuses by name.

**What would change it:** immutable, versioned publication snapshots. I
investigated the migration lineage as you required rather than assuming it, and
a successor migration **is** implementable locally without modifying any sealed
artifact — H-9's checks assert nothing after migration 34, which is exactly why
E4 added a *successor* checks file instead of editing it, and the same pattern
works again. Both H-9 baseline hashes stay byte-identical.

I did not build it, and Codex partly disagreed with me about that. My reason:
an unapplied migration protects nothing, so suppression would be retained
anyway while a successor consumed a chain succession and churned hash-recorded
gate files for a mechanism that cannot run. Codex's correction, which I accept
and record: local implementation would still establish compatibility,
privileges and concurrency behaviour before hosted approval, and the hosted
apply is **not** the only remaining blocker — the mechanism itself, reader
integration and local verification also remain. Both views are in §6n.

## F. Pharmacy money versus Muthoy's money

**k=5 protects pharmacy operational financial information** — their sales,
their refunds, their net — **and platform aggregates derived from it.**

**Muthoy's own subscription-billing revenue is a separate category** and does
not take the pharmacy floor. Exactly one report is classified that way:
`subscription_revenue_and_renewals`. I first classified two more as billing and
the test suite caught me: `subscriptions` and `plan_distribution` count
**pharmacies** per tier and per plan. The money is yours; the subjects are
pharmacies, and a filtered count plus its complement identifies a small group
of them.

Every `/payments` field was classified before any presentation changed: account
label, plan tier and cycle, order amount, status, provider, failure code, event
count, latest event status, created time. All are your own billing records; the
amount comes from the operator-maintained price list and is **not derived from
any pharmacy's sales**, so it cannot be an inference channel into protected
data. That derivation test is written into the code as the condition to
re-apply if a billing report ever starts joining to `sales`.

**One open consequence, for you.** One verified payment publishes `123.45, 1`
and `/payments` joins it to a named pharmacy, so a **one-pharmacy billing
cohort** is identifiable. Codex confirms it does not infer pharmacy takings,
and that flooring the report cannot conceal an identity `/payments` already
publishes under accepted B4 scope and RBAC. The criterion it fails is one I
wrote into my own review brief, not one you set. Re-flooring it would revert
your Decision 4, so it is yours.

## G. Who ran what — stated exactly, because it matters

| Activity | Who | Evidence |
|---|---|---|
| Independent code review | **Codex**, 8 rounds | 8 saved transcripts, 5 review documents |
| Node probes against production modules | **Codex** | executable scripts under `scripts/review/`, each exit 0 |
| Independent code review | **Claude** | round 2, and the corrections in every round |
| **All test execution** | **Claude only** | suite outputs per SHA |
| Typecheck, lint, production build | **Claude only** | per-commit |
| GitHub CI | see §J | |

**Codex executed no test in this batch.** Its sandbox cannot spawn esbuild's
service binary, confirmed by probe in both read-only and workspace-write modes,
and the full-access mode that might bypass it is unavailable in this session.
**There are not two independently executed test suites and this report does not
claim otherwise.** What there are: two independent code reviews, and Codex's own
read-only probes, which reproduced real defects in seven of the eight rounds.

## H. The remaining-blocker register

| # | Blocker | Owner | Nature |
|---|---|---|---|
| 1 | **Hosted apply** of a publication-snapshot migration | founder | authorization you reserved |
| 2 | The snapshot **mechanism itself**, reader integration and local verification | implementation, once (1) is wanted | Codex's correction to me |
| 3 | **One-pharmacy billing cohort** — accept, or gate `/payments` | founder | decision |
| 4 | **E4-H** — migration 35 applied to a hosted project | founder | hosted operation |
| 5 | **E15** — deployed panel opened in a browser, no service-role key in any response or bundle | founder | needs a deployment |
| 6 | **E10, E11, E12, E13, E14** | separate approved plans | pre-existing, unchanged |
| 7 | Device validation of the mobile sync changes | founder, on a real device | pre-existing |

None of these is a defect in the reviewed code. (1) through (3) are decisions
or authorizations; (4) through (7) are hosted or physical steps no agent can
perform.

## I. H-9 and E4 artifact disposition

| Item | State |
|---|---|
| E4 evidence manifest | **no drift**, 48 recorded artifacts |
| Migration chain | **35**, tail `20261023000000` — **no migration added** |
| H-9 `h9_postmigration_checks.sql` pin | `361a400a…` **unchanged** |
| H-9 migration 34 pin | `0b949fa9…` **unchanged** |
| `audit-artifacts/**` | **absent from the outgoing range entirely** |
| Preview APK worktree `D:\Muthoy-Preview-Test` | **untouched**, detached at `bd0fa4d` |
| Inherited dirty and untracked work (46 paths) | **never staged**, absent from the range |

## J. Delivery

Outgoing range audited before push: **223 files, no secret-shaped values.** The
only matches a scan raises are the Postgres role *name* `service_role` in
documentation and test regexes, the E4 manifest's own SHA-256 evidence hashes,
and one npm integrity digest in `pnpm-lock.yaml`. No `sb_secret_`, no JWT, no
private key, no cloud token.

**Pushed:** `c25924e..b339b3f` on `main` — **69 commits, fast-forward, no
force, nothing rewritten.** Verified as a fast-forward before pushing
(`git merge-base --is-ancestor origin/main HEAD`), so no history was replaced.

**GitHub CI:** run `41022095283` on `b339b3f` — **completed, success.**

| Delivery step | Result |
|---|---|
| Secret audit of the outgoing range | 223 files, no secret-shaped values |
| Fast-forward check | `origin/main` 0 behind, ancestor of HEAD |
| Push | `c25924e..b339b3f`, non-force |
| CI | `41022095283` **success** |

The one value worth recording from the audit: an 88-character base64 string
decoding to 64 bytes, which is key-shaped and had to be identified rather than
assumed. It is the npm integrity digest for `tiny-invariant@1.3.3` in
`pnpm-lock.yaml`.

---

## The honest summary

Eight Codex rounds in this protocol, following fifteen before it. **Seven of
the eight found something real.** Three of those findings were defects in my
fixes to the previous round's findings, one was a severity grade I argued for
and got wrong, and one break I introduced mid-fix was caught by the test suite
before it left this machine.

The recurring defect was always the same shape: **I closed a channel on one
surface and left its neighbour open.** The sink, then the public rows, then the
caption, then the registry, then the audit log, then the bucket count, then the
chart label, then the error message, then the Dashboard's copy of the read.
Nine instances of one mistake.

That is the argument for the protocol you imposed, and against my own earlier
judgement that the work was close to done.
