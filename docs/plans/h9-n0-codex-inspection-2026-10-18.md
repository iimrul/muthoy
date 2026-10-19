# H-9 N0 read-only inspection — 2026-10-18

**N0 ELIGIBILITY: BLOCKED**

Founder authorized N0 read-only account inspection and continued F1–F8 local
remediation. N1 creation and H1–H14 hosted operations remain unauthorized.

## Account-specific result

| Required result | Finding |
|---|---|
| Accessible organizations | UNVERIFIED; authenticated listing unavailable |
| New Free organization permitted | UNVERIFIED |
| Organization plans / existing allocations | UNVERIFIED |
| Available Free-project capacity | UNVERIFIED |
| A2 fresh-project feasibility | UNVERIFIED |
| A3 isolated-project feasibility | UNVERIFIED |
| Billing / payment-method / eligibility restrictions | UNVERIFIED |
| Expected additional A2/A3 cost | UNVERIFIED |

Protected targets: DEV `btfprhticjgeihcngpif`; rehearsal
`jwjrijvprbsndukfhlvf`. Neither target was connected to, queried or changed.
No organization/project creation, deletion, pausing, transfer, billing change,
credential change, SQL, deployment, EAS or device operation was performed.

## Inspection evidence and stopping condition

- Plugin-management discovery found Supabase available but **not installed** in
  this client. No authenticated Supabase connector tool was exposed. It had
  already been suggested on 2026-10-15; no repeat suggestion or installation.
- Located the existing official `@supabase/cli-windows-x64` package version
  **2.117.0**, matching the repository's pinned CLI.
- Attempted `--version`, `orgs list --help`, and `projects list --help` with that
  executable. Each failed at startup with **EPERM** while attempting to write
  `C:\Users\Imrul\.supabase\telemetry.json.tmp.<uuid>` outside the writable
  workspace. Combined command exit **1**. The account-listing operations were
  not reached.
- Stopped that route after this permission failure. No escalation, changed
  permission, alternate credential loader, redirected profile/cache, or A5
  executor invocation was attempted. No token was read or printed by our code.
- Public official documentation was read as fallback. It establishes general
  policy, not this account's eligibility or live remaining quota.

## Verified public policy

Supabase grants two active Free projects across organizations where a user is
Owner or Administrator. Paused projects do not count. A new organization does
not create another two-project allowance. Another Owner/Admin's exhausted quota
can also prevent project creation in a shared organization.

Sources read 2026-10-18:

- [About billing on Supabase](https://supabase.com/docs/guides/platform/billing-on-supabase#free-plan)
- [Billing FAQ](https://supabase.com/docs/guides/platform/billing-faq#how-many-free-projects-can-i-have)
- [Read organization metadata](https://supabase.com/docs/reference/api/v1-get-an-organization)
- [Read organization entitlements](https://supabase.com/docs/reference/api/v1-get-organization-entitlements)

Organization metadata and entitlements have documented GET endpoints. Neither
public endpoint description proves whether this particular account may create
a new Free organization. Do not test that with a write.

## Recommended allocation — conditional, not authorized

Preserve DEV and the existing rehearsal. Do not pause, delete, transfer, upgrade,
or reuse either to free quota.

1. Establish actual account capacity and Free eligibility with an authenticated,
   permitted read-only connection. Also establish account-specific payment
   requirements before any project allocation.
2. If **two** Free slots are verified available, allocate distinct new disposable
   PG17 projects to A2 and A3 under a verified Free organization.
3. If **one** slot is verified available, consider sequential disposable projects:
   complete A2 and preserve its evidence, then separately approve deletion of
   that new disposable and creation of a fresh A3 project. This is a future
   option, not permission to delete or create anything now.
4. If **zero** slots remain, a new organization does not solve capacity. Keep
   hosted A2/A3 blocked and request a founder allocation/cost decision. No
   zero-cost route preserving both existing projects is established.

If DEV and rehearsal both consume this account's active Free allowance,
remaining capacity would be zero. Their current plan/status and the account's
Owner/Admin relationships were not verified, so this is conditional only.

## Remaining founder decisions

Provide an authenticated read-only connection permitted by the existing controls
or a permitted account-specific quota/eligibility record. Then decide allocation
if capacity is insufficient. N1 and every later hosted action still need their
own authorization. No new approval is needed to continue authorized offline
F1–F8 remediation.
