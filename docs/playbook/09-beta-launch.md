# MUTHOY POS — AI ENGINEERING PLAYBOOK
## VOLUME 9 — Beta Launch

## BETA CHECKLIST
```
[ ] Day 15 milestone met: the FULL Beta Definition — offline core AND
    Supabase/RLS/sync AND Basic Admin Panel — complete, real-device tested,
    zero seed data (per Volume 0's Beta Definition, not offline-only)
[ ] Sync (Day 13, P0) live and verified: 200-change stress test and
    restore-on-new-phone pass. Two-device SIMULTANEOUS-edit reconciliation via
    delta-merge is P1 — do NOT run a multi-device pilot until that ships,
    even though Beta itself is cleared to launch as a single-device-per-shop
    pilot
[ ] RLS verified by hand (Day 12): shop A genuinely cannot read shop B's data
[ ] Basic Admin Panel (Day 14) live: pharmacy list + dashboard show real
    synced data, service-role key confirmed absent from the browser
[ ] Sentry + PostHog live and receiving real events
[ ] EAS internal-distribution build installed and confirmed working on the
    actual phones going to pilot pharmacies
[ ] A one-page "what this does / what it doesn't yet do" note ready for pilot
    owners, so expectations are honest from day one
```

## INTERNAL TESTING
Before any pharmacy touches it: the founder uses the app as their own daily
driver for at least a few real (or realistic simulated) business days, on the
actual target device class, catching anything Volume 0/7's checklists missed.

## PILOT PHARMACIES
10-50 shops, onboarded in person. Watch the owner register and make their first
sale UNAIDED — target under 5 minutes (Volume 1's goal). Do not hand over a
phone and walk away; observe the first real use.

## USER FEEDBACK
Weekly check-ins, treated as design partnership, not just support. Ask
specifically: what's confusing, what's missing, what feels slow, are they still
also using their paper notebook (the real signal of adoption).

## ANALYTICS (what to actually watch)
Time-to-first-sale, daily-summary-view rate, sync success rate, crash rate,
30-day retention trend — the exact metrics named as goals in Volume 1. If a
metric isn't moving toward its target, that's the top of next week's priority
list, not a footnote.

## BUG PRIORITIZATION
```
P0 — anything touching money/stock correctness, or any data-isolation leak:
     fix immediately, before anything else, no exceptions.
P1 — crashes, sync failures, anything blocking a core daily workflow.
P2 — confusing UX, minor visual inconsistency, feature requests.
```

## RELEASE NOTES
Plain Bangla, written for a pharmacy owner, not a developer: what's new, what's
fixed, nothing technical. Short — 3-5 lines per release.

## FEATURE FREEZE
Once pilot feedback starts flowing, freeze new feature work and focus entirely
on what the pilot surfaces (Volume 0's later phases, Phase 7 in the earlier
build guide, echo this same principle: don't scale past what's proven). Adding
new features mid-pilot muddies which change caused which feedback.
