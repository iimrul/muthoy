# MUTHOY POS — AI ENGINEERING PLAYBOOK
## VOLUME 7 — Testing

## UNIT TESTING
Domain logic only (`domain/` folder) — FEFO, cash formula, permissions, discount
resolution. Pure functions, no rendering, no DB mock needed if written correctly
(they take data in, return data out). Target: every money/stock-affecting
function has normal + boundary + edge case tests (Volume 6's Testing Prompt).

## INTEGRATION TESTING
Screen + data layer together: a full Checkout writes the correct rows across
`sales`, `sale_items`, `inventory_movements`, and updates the cash drawer in one
pass. Run against a real (test) SQLite instance, not a mock.

## OFFLINE TESTING
Airplane mode, full business day: register → sell → stock in → credit → close.
Force-kill the app mid-write, reopen, confirm no corruption (WAL doing its job).

## OCR TESTING
Real physical medicine boxes where possible, imperfect lighting/angles,
unrecognized items — every case must fail gracefully, never crash.

## SYNC TESTING (Day 13, P0 — the highest-stakes testing in the 15-day sprint)
200 queued offline changes sync with zero loss/duplicates. Kill mid-sync,
confirm resume. Wipe and restore a phone from cloud backup. NOTE: two-device
simultaneous-edit reconciliation via stock-delta merge is P1 (post-beta) —
Beta's last-write-wins scope means this specific test is NOT a Beta gate, but
it must pass before any multi-device pilot begins (Volume 0's explicit risk note).

## INVENTORY TESTING
Duplicate batch number rejected cleanly. FEFO active-batch selection correct
across 2, 1, and 5+ batch medicines, including a null-expiry batch (must sort
last). Stock spill-over across a batch boundary during a single sale.

## PERFORMANCE TESTING
Real 2GB-RAM Android device, not the simulator. Search across 500+ seeded
medicines stays under ~100ms. Cold start under ~2 seconds. No ANRs during a
simulated busy-shop stress test (rapid repeated sales).

## QA CHECKLIST (run before every milestone and every release)
```
[ ] FEFO correct across all batch-count scenarios
[ ] Cash formula matches a hand calculation exactly
[ ] Opening cash defaults to 0, never inherited
[ ] One shop cannot see another's data — owner isolation AND RLS, both P0,
    verified by hand Day 12 and re-confirmed Day 15
[ ] PINs never appear in plain text anywhere, including logs
[ ] No seed/demo data in a fresh install
[ ] Every screen uses the standard header except Dashboard/Registration
[ ] Money in DM Mono, other numbers in Plus Jakarta Sans, no hardcoded fonts
[ ] App is fast and stable on a real 2GB device
[ ] Scanning fails gracefully on no-match, never crashes
```

## BUG WORKFLOW
1. Reproduce exactly, write the steps down.
2. Use Volume 6's Bug Fix Prompt — root cause first, patch second.
3. Confirm the fix via the original feature's Validation Checklist, not just the
   one broken step.
4. Log it in DECISIONS.md if it reveals a spec gap (not just a typo-level bug).
