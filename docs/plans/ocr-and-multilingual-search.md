# OCR and multilingual search, as they now stand

**Shipped:** W2-01 in full, and W2-03 **in part**, Batch 2, 2026-10-22
(`9bc08a6`, `9e7d880`, `ca7a7a4`, `fd9b21b`, `63b88df`). "Shipped" here means
the code exists and is tested — not that it is device-verified, and not that
W2-03 is complete.
**Status:** W2-01 is CODE-COMPLETE. **W2-03 is PARTIAL** — its fold reaches the
catalogue path only, and shop-inventory search is unchanged and single-script
(§5 has the detail and the blocker). Neither is **device-verified**: no
physical-device run was authorized in this batch, so the on-device camera and
recognition path has not been exercised by a human.

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

> **Superseded for the SALE scan on 2026-11-20 — see §7.** The founder replaced
> the sale confirmation sheet with live auto-add. Add Medicine prefill, purchase
> invoice review and the checkout prescription review keep their confirmation
> exactly as described below.

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

**Where the fold actually reaches, corrected 2026-10-23 after the final
acceptance review.** An earlier version of this section implied the fold applied
to shop-inventory search. It does not:

- `db/medicineCatalog.ts` folds both the stored key and the query, so catalogue
  search IS multilingual;
- `db/sales.ts` and `db/purchases.ts` pass the raw query to `medicines_fts`,
  which indexes names as typed, so shop-inventory search is **single-script,
  unchanged by this batch**.

Since the catalogue ships empty (E7), multilingual search has no data to act on
in the shipped build. The fold itself is implemented and tested; its only reader
is the catalogue path. **W2-03 is PARTIAL:** plan §11.2 expected `db/sales.ts` to
use folded search keys too, which needs a folded-key column on `medicines` and an
FTS rebuild — a SQLite migration touching a search index every shop depends on,
undoable to validate on a device in this batch. Recorded as Batch 3 work.

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
5. Bangla, English and Banglish queries each finding the same **catalogue**
   medicine with the device offline — which needs a licensed dataset first
   (E7). Shop-inventory search stays single-script until the Batch 3 migration
   above, so a device run must NOT be read as proving multilingual inventory
   search.

---

## 7. Live strip scan with auto-add (founder decision, 2026-11-20)

**Decision.** The founder asked for scan-to-sell without pressing anything:
bring a strip in front of the camera and one unit is in the cart; a strip the
shop does not stock says "not found in inventory". Flagged under CLAUDE.md
rule 11 because it reverses the W2-01 rule above ("confirmation must never be
skippable"); the founder chose, explicitly:

1. **(ক)** a confident match adds immediately with a 3-second **Undo**; an
   ambiguous strip is offered as a one-tap choice; never a silent guess.
2. **Prescription medicines auto-add too** (recommendation was a tap; the
   founder declined). The cart and checkout carry the prescription warning.
3. Start with the existing `expo-camera` (auto-captured frames), not a new
   native camera library.
4. Proceeds under the existing P1 OCR scope override (rule 13).

**Why the old scanner read badly.** It was the logic, not the camera.
`extractMedicineNameCandidate` took the first plausible line — on a Napa Extra
strip that is "MA No. 186-480-006" — and `findExactNameMatch` then needed exact
equality, which the "®" in "Napa® Extra" alone defeats.

**How it reads now** (`domain/stripMatcher.ts`). Backwards: the shop's own
inventory is the dictionary, and a medicine matches when every word of its
brand name is on the strip, so registration and licence lines drop out by
themselves. Then: a printed strength that contradicts a medicine removes it
(Progut MUPS 40 vs a 20 mg strip); the most specific name wins (Napa Extra over
Napa); a winner the strip does not fully explain — an extra printed strength
("Caffeine 65 mg" for plain Napa) or a formulation word beside its name
("Extra", "Extend", "MUPS", "Forte"…) — is OFFERED, never added, because the
shop may simply not stock the product actually shown. A brand with no word read
is never substituted from its generic (Maxpro is not Progut).

**One add per appearance** (`domain/stripScanSession.ts`). A medicine is locked
after it is added until the strip has been out of view for two frames AND
900 ms; holding a strip adds one unit, taking it away and back adds another.
Weak matches and choices need two agreeing frames; "not found" is
rate-limited and silenced while a just-added strip is still in view.

**Unchanged safety.** The stock ceiling (`addItem`), the FEFO batch
(`getActiveBatchForMedicine`, real expiry dates), all offline (the dictionary
is SQLite, read once per opening by `db/scanVocabulary.ts`), and every frame is
a temporary file deleted after reading. Both scan entry points (`app/scan.tsx`
and the Sale tab) render the same `LiveStripScanner`; `ScanConfirmSheet` is
removed.

**Limits, stated plainly.**
- ML Kit's on-device model (`text-recognition:16.0.1`) reads **Latin script
  only**. Bengali print on a strip is invisible to it; matching relies on the
  English brand name, which the strips photographed all carry. A medicine the
  shop stored under a Bengali name still matches when its transliteration is
  within one letter of the English print (ফ্লাকোল ↔ Flacol is tested).
- Text turned 90° (a strip held sideways) is unlikely to read; hold strips
  level.
- The matcher's fixtures are the founder's five strips **transcribed by hand**,
  not captured ML Kit output. Recognition accuracy and the real frame rate are
  device questions — see the device checklist below.
- No vibration: the app holds no VIBRATE permission.

**The beep (founder request, 2026-11-20).** A unit that really enters the cart
plays the prototype's beep — `assets/sounds/scan-beep.wav`, rendered from the
prototype's own WebAudio values (800 Hz sine, 0.3 → 0.01 over 150 ms) — through
`native/scanSound.ts` (`expo-audio` ~57.0.5). Silent / vibrate mode is
respected. `expo-audio` is a NATIVE module, so it plays only on a build made
after this change; on an older build the module is absent and the beep is
silently skipped (verified on the phone below). Its config plugin is NOT added,
so no microphone permission or background-audio service enters the app.

**Device run, 2026-11-20 — Galaxy A04s (SM-A047F, Android 14), installed
`com.muthoy.pos.dev` (built 2026-11-10), JavaScript from this branch via Metro.**

| Check | Result |
|---|---|
| Scanner opens from the Sale tab and from the `/scan` deep link | PASS |
| Camera permission: panel → system dialog → live preview | PASS |
| Live frame loop runs without a tap; capture + ML Kit per frame | ~0.85–1.1 s (logcat timestamps) |
| Every frame deleted after reading (app `cache/Camera` never held more than one file) | PASS |
| The app's own `scanTextLines` on the five photos, real ML Kit | all five read; output saved verbatim as `domain/stripMatcher.device-ocr.json` |
| Matcher on that real output | all five → the right medicine; Napa Extra / Extend never become plain Napa (tests) |
| Beep on this older build (no ExpoAudio) | module absent, `playScanBeep` called twice, app alive — silent, no crash |

What the real read showed: "mg" is often misread ("500 rmg", "500 ng"), the
script-font "Extend" almost never reads cleanly ("Napa°tend", "NapaCxtend",
"'NapaExtend"), and the ORSaline packet yields little more than "SMC" and
"OsMc0RSaine". The matcher handles all three (glued brand, one-to-two-letter
slips), and ORSaline is a WEAK match — it needs two agreeing frames live.

**Still not verified — needs a person with the phone:** holding real strips in
front of the camera (one add per appearance, Undo, the Progut 20/40 choice), and
hearing the beep, which needs a new dev build. Note the DEV shop's inventory has
two items both named "Progut MUPS" with no strength in the name: a Progut strip
will be OFFERED as a choice between them, not added, until they are told apart.

**iPhone.** Everything used is cross-platform — `expo-camera`, ML Kit text
recognition and `expo-audio` all support iOS — but the app has never been built
or run on an iPhone (no Mac here; it needs an EAS iOS build and an Apple
developer account). Known iOS risks to check on the first build: whether iOS
still plays the camera shutter sound on every captured frame (`shutterSound:
false` is set for every frame, but nobody has yet LISTENED on either platform —
on Android ask the person testing; on iOS some regions force the sound), the
silent switch (the beep respects it by design), and the ML Kit pod.
If the shutter sound cannot be silenced on iOS, the frame-processor camera
(`react-native-vision-camera`, no photo capture at all) is the fix, after its
own compatibility check against this SDK.
