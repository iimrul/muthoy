# MUTHOY POS — AI ENGINEERING PLAYBOOK
## VOLUME 6 — AI Prompt Library
### The most important volume. Each prompt is copy-paste-ready.
### Always ensure the AI tool you're using has read CLAUDE.md,
### PROJECT_CONTEXT.md, TECH_STACK.md, and DEVELOPMENT_RULES.md before using
### any of these.

## WHICH TOOL FOR WHICH PROMPT
Per Volume 2's AI Workflow (full role definitions there): use **Cursor Pro**
for most prompts below — anything scoped to one screen or one feature area,
iterative, debugged interactively. Use **Claude Code** specifically for
prompts #3 (Database), #12 (Sync Queue), and any Refactor/Testing prompt that
spans many files at once — repo-wide, architecture-aware tasks. Use
**Claude Chat** to draft or refine any of these prompts before you run them,
and for the Documentation Prompt (#21), which is planning/writing work, not
implementation. Each prompt below notes its recommended tool where it isn't
the Cursor Pro default.

---

## 1. PROJECT INITIALIZATION PROMPT

**Purpose:** Bootstrap the entire monorepo shell — nothing else can start before this.
**When to Use:** Day 1, once, at the very beginning.
**Prompt:**
> "Read CLAUDE.md, PROJECT_CONTEXT.md, TECH_STACK.md, and DEVELOPMENT_RULES.md fully. Initialize a Turborepo with apps/mobile (Expo SDK
> 52 + TypeScript + Expo Router), apps/admin (empty placeholder for now), and
> packages/ui, types, utils, validation, constants, config per Volume 2's folder
> creation order. Configure NativeWind in apps/mobile with the brand tokens from
> Volume 1. Set up git with a proper .gitignore. Plan first, then execute step by
> step, confirming each step works before the next."

**Expected Output:** a working monorepo; `apps/mobile` boots via `npx expo start`;
folder structure matches Volume 2 exactly; first git commit made.

**Validation:** app runs with zero errors; folder tree matches spec; brand colors
render correctly on a test screen.

**Human Review:** open 3 generated files at random, ask Cursor to explain each in
plain English; confirm nothing was invented beyond what was asked.

**Recovery Prompt:** "The folder structure doesn't match Volume 2's spec exactly
— here's the diff [paste]. Fix the structure without breaking what already runs."

---

## 2. FOLDER GENERATION PROMPT

**Purpose:** Scaffold a new feature area's folder/file skeleton before filling it in.
**When to Use:** At the start of each new feature day (Volume 0), before writing logic.
**Prompt:**
> "Create the folder and file skeleton for [feature, e.g. 'Sales'] per Volume 4's
> spec and Volume 2's layered architecture — empty screen components, a domain
> logic file stub, and any needed db query function stubs. Do not implement logic
> yet, just the skeleton with TODO comments referencing what each piece must do."

**Expected Output:** empty, correctly-placed files that compile with placeholder
returns/TODOs.

**Validation:** app still builds with the new empty files present; nothing broke.

**Human Review:** confirm file placement matches the layered architecture (no
screen file created inside `db/`, etc.).

**Recovery Prompt:** "Move [file] — it's in the wrong layer per Volume 2. It
should be in [correct folder] because [reason]."

---

## 3. DATABASE PROMPT

**Purpose:** Implement the finalized schema exactly as specified — no improvisation.
**When to Use:** Day 2, and any time a new table/column is genuinely needed
later. **Tool: Claude Code** (repo-wide schema implementation, not a
single-file Cursor Pro edit).
**Prompt:**
> "Here is our finalized schema (paste schema.ts in full). Implement it exactly
> via Drizzle + expo-sqlite with WAL mode. Do not modify field names, types, or
> constraints — implement it as given. Generate the first migration. Write a DB
> init module that runs migrations safely on every app start."

**Expected Output:** all 24 tables exist locally, matching schema.ts exactly.

**Validation:** spot-check 5 tables' columns against schema.ts directly; confirm
every foreign key has its specified `onDelete` behavior.

**Human Review:** ask "does this match schema.ts exactly? Show me anywhere it
doesn't" — read the answer, don't skim it.

**Recovery Prompt:** "Table [X] doesn't match schema.ts — it's missing
[column/constraint]. Fix only that table, don't touch anything else."

---

## 4. MIGRATION PROMPT

**Purpose:** Change the schema safely, without losing existing data.
**When to Use:** Any time a field/table needs to change after Day 2.
**Prompt:**
> "I need to [describe the change, e.g. 'add a loyalty_points column to
> customers']. Generate a NEW Drizzle migration for this — never edit an existing
> migration file. Then test it against a database that already has sample data in
> it (not an empty one) and confirm existing rows survive with the new column
> correctly defaulted."

**Expected Output:** a new migration file; confirmation that existing test data
survived the migration intact.

**Validation:** query the affected table before and after — row count unchanged,
new column present with the correct default.

**Human Review:** literally look at the row count before/after yourself, don't
trust a summary.

**Recovery Prompt:** "That migration lost/corrupted data — here's what changed
[paste before/after]. Roll back and redo it non-destructively."

---

## 5. AUTHENTICATION PROMPT

**Purpose:** Build registration, PIN setup/login, and staff PIN management.
**When to Use:** Days 4-5 (local registration/PIN), Day 11 for
staff-specific auth, and Day 13 for wiring in real phone OTP.
**Prompt:**
> "Build [Registration / PIN Setup / PIN Login / Staff PIN management] per
> Volume 4's Authentication spec. PINs must be bcrypt-hashed, never stored or
> logged in plain text. Use the dots+keypad PIN entry pattern consistently
> everywhere a PIN is entered. Validate all input with Zod. Plan first."

**Expected Output:** working, offline-capable auth flow matching the spec.

**Validation:** inspect the stored PIN value directly in the database — confirm
it's a bcrypt hash, not plaintext, every time.

**Human Review:** attempt a wrong PIN and confirm rejection; attempt to bypass
auth by navigating directly to a protected route.

**Recovery Prompt:** "I found the PIN stored in plain text at [location]. Fix
this immediately and confirm no other place in the code does the same."

---

## 6. INVENTORY PROMPT

**Purpose:** Build stock viewing and manual stock entry.
**When to Use:** Day 8.
**Prompt:**
> "Build the Inventory list and Add Medicine screens per Volume 4's Inventory
> spec. Enforce UNIQUE(shop_id, medicine_id, batch_no) with a friendly error
> message, not a crash. Use React Hook Form + Zod. Plan first."

**Expected Output:** working inventory list and add-medicine flow.

**Validation:** attempt a duplicate batch number — confirm a friendly rejection,
not an app crash or a silent duplicate.

**Human Review:** add 3 medicines with multiple batches, manually verify the
active-batch (FEFO) display against the actual earliest expiry date.

**Recovery Prompt:** "Adding a duplicate batch number crashed the app instead of
showing an error. Fix the validation to catch this before it reaches the DB."

---

## 7. SALES PROMPT

**Purpose:** Build Sale Entry, Cart, and Checkout with correct FEFO and cash impact.
**When to Use:** Days 6-7 — the highest-stakes days in the whole sprint.
**Prompt:**
> "Build Sale Entry, Cart, and Checkout per Volume 4. Implement FEFO deduction
> (earliest-expiry batch first, spill to next when one empties) and the cash
> formula exactly as specified in Volume 3 — do not approximate either. Write
> unit tests for both before considering this done. Plan first, flag any
> ambiguity before coding."

**Expected Output:** a complete, correct sale flow with passing FEFO/cash tests.

**Validation:** run the unit tests yourself and read the actual pass/fail output;
sell across a batch boundary and verify the spill-over by inspecting
`inventory_movements` directly.

**Human Review:** hand-calculate expected cash for 5 real test transactions and
compare against the app's number, line by line.

**Recovery Prompt:** "The cash total is off by [amount] after these transactions
[list them]. Walk through the formula step by step and find where it diverges."

---

## 8. PURCHASE PROMPT

**Purpose:** Build supplier purchase invoices that correctly affect stock and cash.
**When to Use:** P1, immediately post-beta (Add Medicine's manual batch entry,
Volume 0 Day 8, covers Beta's stock-in need).
**Prompt:**
> "Build Purchases per Volume 4: invoice_no auto-generation, line items that
> create/update batches, COD purchases immediately reduce cash, credit purchases
> only update the supplier payable. Plan first."

**Expected Output:** working purchase-entry flow with correct cash/payable split.

**Validation:** one COD and one credit purchase — confirm cash drops only for
the COD one.

**Human Review:** check the supplier's payable balance manually against the
credit purchase amount.

**Recovery Prompt:** "A credit purchase incorrectly reduced cash immediately.
Fix the payment_terms branching so credit never touches the drawer at entry."

---

## 9. SUPPLIER PROMPT

**Purpose:** Build the supplier directory and detail view.
**When to Use:** P1, immediately post-beta, alongside the Purchase Prompt
(Add Medicine's manual batch entry, Volume 0 Day 8, covers Beta's needs).
**Prompt:**
> "Build the Suppliers list and detail screen per Volume 4/5 — name, phone,
> address, email, contact_person, purchase history, and outstanding payable
> total for that supplier. Plan first."

**Expected Output:** a working supplier directory tied to real purchase history.

**Validation:** a supplier's payable total matches the sum of their unpaid
credit purchases exactly.

**Human Review:** spot-check the math on one supplier by hand.

**Recovery Prompt:** "This supplier's payable total doesn't match their
purchase history — recompute it from purchases directly, don't cache a stale sum."

---

## 10. CUSTOMER PROMPT

**Purpose:** Build the customer directory and credit ledger.
**When to Use:** Day 9 (merged with Credit Sales and Expiry Management in the
15-day plan).
**Prompt:**
> "Build Customers and the credit ledger per Volume 4 — name/phone/address/notes,
> a list of credit sales and collections per customer, and a running balance.
> Plan first."

**Expected Output:** working customer records with an accurate credit balance.

**Validation:** give credit, then collect a partial payment — confirm the
remaining balance is exactly correct.

**Human Review:** hand-verify one customer's full credit history against the
displayed balance.

**Recovery Prompt:** "This customer's balance is wrong after a partial
collection — show me the exact calculation and where it diverges from
(amount owed − amount collected)."

---

## 11. NOTIFICATION PROMPT

**Purpose:** Build local, offline-capable alerts.
**When to Use:** P1, immediately post-beta (not required for a critical
pharmacy workflow to run end-to-end — see Volume 0's scope lock).
**Prompt:**
> "Build low-stock alerts (threshold crossing, de-duplicated so it doesn't
> re-fire every screen open), expiry alerts, the 8 PM owner-only cash summary,
> and the Notification Center with unread count and severity styling
> (info/warning/critical) per Volume 4. Plan first."

**Expected Output:** working local notifications and a notification history screen.

**Validation:** force a low-stock condition once — confirm exactly one
notification fires, not one per screen visit.

**Human Review:** open the app 5 times after triggering one alert, confirm it
didn't re-fire.

**Recovery Prompt:** "The low-stock alert is firing every time I open the app.
Add de-duplication so it only fires once per threshold crossing."

---

## 12. SYNC QUEUE PROMPT

**Purpose:** Build the offline-to-cloud outbox and reconciliation engine.
**When to Use:** Day 13 (P0, part of Beta) — use Claude Code, not Cursor Pro,
since this spans db/, sync/, and auth screens at once. Still the hardest
phase — go slowly even though it's inside the 15-day window.
**Prompt:**
> "Build the sync_queue writer (every local write also enqueues a row) and a
> MINIMUM VIABLE sync engine for Beta: push queued rows to the Edge Function
> in batches when online,
> retry with exponential backoff on failure, and pull other devices' changes.
> For BETA, resolve ALL conflicts — including stock quantity — with
> last-write-wins by updated_at; do NOT build delta-merge or a conflict_queue
> yet, that's an explicit P1 fast-follow immediately after Beta, before any
> multi-device pilot. Plan first, and flag anything risky before building it."

**Expected Output:** a working outbox-pattern sync engine.

**Validation:** queue 200 offline changes, go online, confirm all arrive with
zero duplicates; run two phones editing the same shop offline and confirm
correct reconciliation.

**Human Review:** this is a hard-spot — do not approve based on "it looks like
it works." Deliberately kill the app mid-sync and confirm it resumes correctly
on reopen.

**Recovery Prompt:** "Sync lost data during this scenario [describe exactly].
Do not patch around it — explain the root cause first, then fix it."

---

## 13. OCR PROMPT

**Purpose:** Wire ML Kit text recognition into Sale Entry and Add Medicine.
**When to Use:** P1, immediately post-beta (manual search covers Beta itself —
see Volume 0's scope lock).
**Prompt:**
> "Integrate ML Kit's text recognition API. On Sale Entry, scanning reads the
> medicine name off a strip and looks it up in local inventory — read-only, no
> confirmation needed on success. On Add Medicine, scanning prefills form fields
> but the user MUST confirm before saving — never auto-commit a scanned value.
> Plan first, flag any Expo config changes needed."

**Expected Output:** working text-scan-to-lookup on Sales, scan-to-prefill on
Add Medicine.

**Validation:** scan a real medicine strip in imperfect lighting — confirm
graceful handling either way (match or no-match), never a crash.

**Human Review:** test with at least 2 real physical items, not just printed
test text.

**Recovery Prompt:** "A misread on Add Medicine got saved without confirmation.
Add the confirmation step back — it must never be skippable."

---

## 14. BARCODE PROMPT

**Purpose:** Wire ML Kit barcode scanning into Sale Entry and Add Medicine.
**When to Use:** P1, immediately post-beta, alongside OCR (same engine, same
session — see the OCR Prompt above).
**Prompt:**
> "Integrate ML Kit's barcode scanning API — the same ML Kit instance as text
> recognition, not a separate library. Same two contexts as the OCR prompt:
> read-only lookup on Sale Entry, prefill-with-confirmation on Add Medicine.
> Plan first."

**Expected Output:** working barcode-scan-to-lookup and scan-to-prefill.

**Validation:** scan a known barcode, confirm the exact right medicine is found;
scan an unrecognized barcode, confirm a clear not-found message.

**Human Review:** confirm ONE camera session can detect either a barcode or text
without the user choosing a mode first, per Volume 4's spec.

**Recovery Prompt:** "Barcode scanning requires a separate camera library from
OCR right now — that's not what was specified. Consolidate both onto ML Kit's
two APIs within one camera session."

---

## 15. PERFORMANCE PROMPT

**Purpose:** Ensure the app stays fast on a real 2GB-RAM Android phone.
**When to Use:** Day 15, and any time a screen feels sluggish.
**Prompt:**
> "Profile [screen/flow] for performance on a low-end Android device profile.
> Look for unnecessary re-renders, unindexed queries, and large lists rendering
> without virtualization. Fix what you find without changing the screen's
> behavior. Plan first, show me what you found before fixing it."

**Expected Output:** a list of found issues and fixes; measurably smoother
behavior on the real device.

**Validation:** time the specific interaction before and after on the actual
test phone, not the simulator.

**Human Review:** use the app yourself on the real phone for 5 minutes, note
anything that still feels slow.

**Recovery Prompt:** "This fix improved [screen] but broke [behavior]. Revert
the behavior change and keep only the performance improvement."

---

## 16. REFACTOR PROMPT

**Purpose:** Improve code structure without changing behavior.
**When to Use:** Whenever a file grows unwieldy, or during Day 15's
hardening pass.
**Prompt:**
> "Refactor [file/feature] for clarity per Volume 1's coding standards — do NOT
> change any observable behavior. After refactoring, run through this feature's
> original Validation Checklist again and confirm every item still passes."

**Expected Output:** cleaner code, identical behavior.

**Validation:** re-run the feature's original tests/checklist — 100% must still pass.

**Human Review:** diff the before/after and confirm no logic actually changed,
only structure/naming.

**Recovery Prompt:** "This refactor changed behavior — [describe what broke].
Revert to the exact prior behavior while keeping the structural improvement."

---

## 17. REVIEW PROMPT

**Purpose:** The PM's core review tool — used after every session (Volume 1).
**When to Use:** End of every single work session, no exceptions.
**Prompt:**
> "Does everything you just built follow CLAUDE.md, PROJECT_CONTEXT.md, TECH_STACK.md, and DEVELOPMENT_RULES.md and today's spec in
> Volume 0/4/5? Explain in plain English what you built, why, and where it might
> NOT match the spec. List any assumption you made that I should confirm."

**Expected Output:** a plain-English self-assessment, including honest
uncertainty, not just a confirmation.

**Validation:** N/A — this prompt IS the validation step.

**Human Review:** actually read the answer critically; if anything sounds
vague or evasive, ask a direct follow-up before moving on.

**Recovery Prompt:** "You said this matches the spec, but I found [discrepancy].
Explain why that happened and fix it."

---

## 18. TESTING PROMPT

**Purpose:** Get real, run test coverage on money/stock-critical logic.
**When to Use:** Day 7 (FEFO/cash), Day 15 (full pass), and any time domain
logic changes.
**Prompt:**
> "Write unit tests for [FEFO deduction / the cash formula / permission checks /
> discount resolution] covering: the normal case, a boundary case (e.g. a batch
> emptying mid-sale), and an edge case (null expiry, zero stock, a denied
> permission). Run them and show me the actual pass/fail output."

**Expected Output:** a real test file and genuine terminal output showing results.

**Validation:** you personally see the test command run and its output — not a
paraphrase of it.

**Human Review:** read at least one test's assertions yourself and confirm it's
actually checking the right thing, not a trivial always-true check.

**Recovery Prompt:** "This test passes but doesn't actually verify [the real
behavior] — it's checking the wrong thing. Rewrite it to test what actually
matters: [describe]."

---

## 19. BUG FIX PROMPT

**Purpose:** Fix a defect without introducing a new one.
**When to Use:** Any time something's broken.
**Prompt:**
> "Here's the bug: [exact steps to reproduce, and what you expected vs what
> happened]. Find the root cause — don't just patch the symptom. Explain the
> root cause to me before fixing it. Then fix it and confirm the original
> Validation Checklist for this feature still fully passes."

**Expected Output:** a root-cause explanation, a targeted fix, and confirmed
non-regression.

**Validation:** reproduce the original bug steps — confirm it's actually gone,
not just less visible.

**Human Review:** ask "could this same root cause be affecting anything else in
the app?" — bugs are often not isolated.

**Recovery Prompt:** "That fix didn't address the root cause — the bug still
happens under [slightly different condition]. Go deeper."

---

## 20. DEPLOYMENT PROMPT

**Purpose:** Ship a build via EAS (mobile) or Vercel (admin).
**When to Use:** Day 15 (first EAS internal build), and every release after.
**Prompt:**
> "Build a new EAS [internal-distribution / production] build. Confirm: no seed
> data ships, environment variables are correctly set for this environment, and
> version numbers are bumped per Volume 1's versioning rule. Walk me through
> exactly how to install/test this build before we call it done."

**Expected Output:** a working build artifact and clear install instructions.

**Validation:** install it yourself on the real test phone; confirm it's
actually the new version, not a cached old one.

**Human Review:** run the full Volume 9 Beta Checklist against this specific build.

**Recovery Prompt:** "This build has [seed data / wrong env / crashes on
launch]. Do not ship it — find and fix the cause, then rebuild."

---

## 21. DOCUMENTATION PROMPT

**Purpose:** Keep CLAUDE.md, PROJECT_CONTEXT.md, TECH_STACK.md, and DEVELOPMENT_RULES.md / DECISIONS.md accurate as the source of truth.
**When to Use:** Any time a real decision is made or a convention changes.
**Prompt:**
> "We just decided [describe the decision/change]. Update DECISIONS.md with a
> dated entry explaining what changed and why. If this affects CLAUDE.md, PROJECT_CONTEXT.md, TECH_STACK.md, and DEVELOPMENT_RULES.md's
> rules, update that too and point out exactly what changed."

**Expected Output:** an accurate, dated log entry; updated brief if applicable.

**Validation:** read the new entry — does it explain WHY, not just WHAT?

**Human Review:** confirm this decision doesn't silently contradict an earlier
one already logged — ask Cursor to check for that specifically.

**Recovery Prompt:** "DECISIONS.md is out of sync with what we actually built —
here's the real current state [describe]. Reconcile the document to match reality."
