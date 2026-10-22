# OCR and multilingual search, as they now stand

**Shipped:** W2-01 and W2-03, Batch 2, 2026-10-22 (`9bc08a6`, `9e7d880`,
`ca7a7a4`, `fd9b21b`, `63b88df`).
**Status:** CODE-COMPLETE, **not device-verified**. No physical-device run was
authorized in this batch, so the on-device camera and recognition path has not
been exercised by a human.

This supersedes the status text in `docs/plans/ocr.md`, which describes the
original plan boundary rather than current behaviour. That document is kept for
its history.

---

## 1. The shape of it

Recognition is **on-device** (ML Kit text recognition). Nothing leaves the
phone for OCR: no image, no recognised text, no network call. That property is
what makes the feature usable in a shop with no connection, and it is also why
the only cost of a misread is a wrong suggestion rather than a data leak.

Three surfaces use it:

| Surface | What OCR does there |
|---|---|
| Sale entry (`app/(tabs)/sale.tsx`, `app/scan.tsx`) | reads a medicine name from a strip or box and offers candidates |
| Add Medicine | reads a name to prefill the form |
| Checkout prescription capture (`app/sale/checkout.tsx`) | reads a prescription and offers its lines for review |

---

## 2. The confirmation gates, and why there are two scanners

**Every add that originates from a possible MISREAD passes a confirmation
sheet.** The user sees what was recognised and confirms it before anything
enters the cart or the database.

The plan named one scanner (`app/scan.tsx`). The gate went on **both**, because
`app/(tabs)/sale.tsx` carried an identical auto-add on an exact match: "never
skippable" cannot hold while one of two identical paths still commits on a
misread. That deviation is recorded in the commit and in CLAUDE.md rule 11
terms.

What deliberately does **not** pass a gate: tapping a search result, and tapping
a barcode candidate. Both are explicit choices by the user, not a machine's
reading of a blurry strip.

**Barcode is EXCLUDED** (Q1, founder decision). OCR works independently with
manual confirmation. The barcode code that already shipped is neither deleted
nor extended.

---

## 3. The image-deletion guarantee, and its one exception

The scanner **owns and deletes its own capture** on the OCR path: the temporary
image is removed once recognition has produced text, whether that text is used
or not. `native/prescriptionAttachment.ts` gained `removeTemporaryCapture()` for
exactly this, and the scanner calls it.

The `captureOnly` path is different, and this is stated plainly because it is a
privacy-relevant gap:

- On that path the caller receives ownership of the capture. Recognition there
  is **opt-in by presence** of an `onCaptureRecognition` handler, so no future
  caller acquires OCR silently, and a recognition failure is folded to `null`
  rather than reusing a retryable scan-error branch.
- **Cleaning up that capture is DESCOPED (gate E9).** Five designs were each
  shown unsafe — plan §6.2.2 holds all five and the reason each failed. The
  rule that replaced them: **preserve existing durable captures, introduce no
  destructive cleanup.** A prescription a shop deliberately attached to a held
  draft must survive a retake, a cancel and an unmount, which
  `tests/sale/resumed-draft-capture.test.tsx` asserts.

So: images on the OCR path are deleted by the scanner; images a user
deliberately attached are kept until the user or the feature that owns them
removes them; and no code in this batch deletes a durable capture.

---

## 4. The prescription review at checkout

A captured prescription is recognised, and its lines are offered **one at a
time** for review. The matching lives in `domain/prescriptionLines.ts`, not in
the checkout screen, because that screen was already over the 800-line limit
(866 lines, now ~950).

A confirmed line calls the existing `addItem` and then `resetQuote()` — the
founder approved that behaviour on 2026-10-22, after the plan was found to leave
it unspecified. Nothing is added without confirmation, and an unrecognised line
is simply not offered.

**Known debt, recorded not hidden:** `app/sale/checkout.tsx` is over the
file-size limit and deserves a dedicated extraction pass. It was not done here
because that is unrelated refactoring of money-path code, and money-path
refactoring with no device validation available is how a working checkout
becomes a broken one.

---

## 5. Multilingual search (W2-03)

Three scripts, one comparison space: English, Bangla, and "Banglish" (Bangla
typed in Latin letters, which is how most people actually type).

`packages/utils/src/bengali.ts` provides the fold: Bangla text and Latin
transliterations are normalised into a single search key, so "নাপা", "napa" and
"Napa" all find the same medicine. 21 tests cover it, and a mutation removing
the transliteration fold fails four of them.

The FTS query builder that turns a user's typing into a prefix query existed
**twice**, privately and identically, in `db/sales.ts` and `db/purchases.ts`.
W2-03 needed a third caller, so it moved to `domain/ftsQuery.ts` and all three
import it — `DEVELOPMENT_RULES.md` forbids duplicating shared logic, and a third
copy is how three subtly different search behaviours appear.

Search works on whatever rows exist, so it is **not** gated on the catalogue
dataset (E7). With an empty catalogue it searches the shop's own inventory,
exactly as before.

---

## 6. What a device run still has to show

None of the following is claimed, and each needs a human with a phone:

1. Recognition accuracy on real Bangladeshi medicine strips, in shop lighting.
2. The confirmation sheet appearing on **both** scanners, and being impossible
   to skip.
3. The temporary capture actually being gone from the device filesystem after an
   OCR scan.
4. A held draft's durable prescription surviving a retake, a cancel, and an app
   restart.
5. Bangla, English and Banglish queries each finding the same medicine, with the
   device offline.
