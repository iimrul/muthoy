# PROJECT_CONTEXT.md — Muthoy POS
### Why this product exists. Read alongside CLAUDE.md, TECH_STACK.md, and
### DEVELOPMENT_RULES.md.

Muthoy becomes the default point-of-sale for small independent pharmacies across
Bangladesh — starting with 10-50 pilot shops, scaling toward 100,000. The business
wins by making an owner's daily operations measurably easier from day one, earning
trust before earning money (14-day full-access trial).

## PRODUCT VISION
A Bangla-first, offline-first pharmacy POS that works perfectly with zero internet,
tracks stock by expiry (FEFO), tells the owner exactly how much cash should be in
the drawer, and never loses a sale — even on a shared, low-end Android phone.

## MISSION
Replace the paper notebook. Make the owner's life measurably easier within the
first day of use.

## TARGET USERS
- **Primary — Ruhin (42), pharmacy owner.** Samsung Galaxy A14-class phone, limited
  data, sometimes no signal. Wants to know: what's in stock, what's about to
  expire, how much cash should be in the drawer, who owes him money.
- **Secondary — Arif, counter staff.** Uses the phone to sell and look up stock;
  should never see owner-only financial data unless explicitly permitted.
- **Tertiary — you, the founder**, via the Basic Admin Panel (built Day 14,
  P0/Beta) and its fuller version (P1, post-beta).

## GOALS
- Time-to-first-sale under 5 minutes, unaided.
- Daily-summary-view usage above 75% of active shops.
- 30-day retention above 40%.
- Zero data loss, ever — offline or during sync.
- One shop can never see another's data.

## NON-GOALS (explicitly out of scope for now)
- Multi-country support (Bangladesh only).
- A full ERP / accounting suite (POS + inventory + basic P&L only).
- iOS in the first 15-day sprint (Android first; iOS is a same-codebase fast-follow).
- Real-time multi-device collaboration within a single sale (each device syncs
  independently; true live collaboration is not a goal).

---


## ENGINEERING PHILOSOPHY

### Offline-First Philosophy
SQLite on the phone is the ONLY source of truth for a shop's own screens. The
cloud is backup + multi-device sync + the admin's window — never the live data
source. A screen that calls the network to decide what to show is a bug, full stop.

### Mobile-First
Design and build for a 2GB-RAM, 360dp-width Android phone first. If it's not fast
and legible there, it's not done — regardless of how it looks on a developer's
flagship test device.

### AI-First Development
The founder is the Project Manager; AI (Cursor) is the developer. Every task
follows: give full context → assign one phase/day at a time → require a plan
before code → review by running it, not by reading it → verify against acceptance
criteria before moving on. Never assign the next unit of work until the current
one passes its criteria on a real device.

---

