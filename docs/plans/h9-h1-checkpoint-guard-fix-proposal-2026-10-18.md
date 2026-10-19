# H-9 H1 checkpoint guard — APPLIED — 2026-10-18

**Status: APPLIED under founder approval**, after first being reported as a stop
because it necessarily modifies the protected A5 runtime's hash-pinned module
(reasoning kept in §1). The protected runtime was reinstalled with the reviewed
installer and re-verified.

Revision 2 replaces the first attempt's comment-line heuristic, which an independent
review broke with three witnesses (§8). Current state:

| | Original | Guard v1 (superseded) | Guard v2 (current) |
|---|---|---|---|
| `runtime-manifest.json` | `fe3310804fcf03d4…b29713` | `641bfdc37d19a1e6…746dbf` | **`5ad71c118ba2f485dc398c6adda2c76dc6ebf4d597daddd506860468d96fbc7f`** |
| `h9-a5-dev-readonly.mjs` | `fd499e5c5d42…` | `b378f4a07420…` | **`00f00bd999b9a5b71516c3d57f29ec2dd0f83353e1b9bdc81838e006a2459370`** |
| `source-checkpoint.mjs` (not protected) | `d8c5642ce7b3…` | `7b7bd576b852…` | **`f883f2f7bf5e47ea2606eec956e855c5dc4b629feb39c25229941f4dd7584bea`** |
| `test/remediation.test.mjs` | — | `02fe47ea72d5…` | **`76349afe2c4e51607190034a15dc830b7d598422ea9833d7e0f2eca21adf2d1a`** † |
| Checkpoint | refused `evidence-sensitive` | created `6fdbd4f0…` | unchanged, re-verified under v2 |

† **Line-ending provenance — corrected 2026-10-19 before the first push.** The test
file was originally authored with CRLF line endings and a trailing blank line, and
hashed in that form as
`4b08ec0628b45b693df82e6fbe42447c867782b9333b23e224c1f522490b938d` — the value this
table carried until now. That hash was **not reproducible from the repository**. The
operator's local Git config sets `core.autocrlf=true` — a per-clone user setting, not a
repository one — and no `.gitattributes` existed, so `git add` normalized the file to LF
and the committed blob hashed differently. An independent pre-push review caught it.

Two changes were therefore made. First, the file was LF-normalized and its trailing
blank line removed, giving
`76349afe2c4e51607190034a15dc830b7d598422ea9833d7e0f2eca21adf2d1a`. Second, a repository
`.gitattributes` now pins `text eol=lf` on every path whose SHA-256 is recorded as
evidence — the A5 runtime files, the three `PINNED_INPUTS`, the two guard-pinned `sync`
sources, this runbook, and the migration pinned by `M34_SHA256` in
`scripts/h9/migration-gate.mjs`. Only with that pin is any of those values canonical:
equal in the worktree, in the index and on a fresh checkout on any platform.

Three distinct hashes are involved, and they must not be confused:

| Value | What it is |
|---|---|
| `76349afe2c4e…` | **The committed artifact.** LF, no trailing blank line. The only value this table pins. |
| `4b08ec0628b4…` | **Historical only.** The pre-push CRLF bytes with the trailing blank line, as this table read before 2026-10-19. Describes no committed artifact. Retained for provenance. |
| `72bc0e8a6e70…` | **Counterfactual only.** What a Windows clone would compute if `.gitattributes` were absent and checkout re-expanded the committed blob to CRLF. Describes no artifact that exists. |

Content is otherwise byte-for-byte unchanged: only line endings and the trailing blank
line differ, and the suite still passes 65/65.

The three `PINNED_INPUTS` (F12 evaluator, both SQL files) are byte-unchanged, so the
Git-pinned evaluator/SQL identity is preserved. The sealed F12 executor was not
touched.

## 1. Why the protected runtime cannot be avoided

`assertEvidenceSafe` has exactly five call sites:

| Site | Argument | Classification | Action |
|---|---|---|---|
| `h9-a5-dev-readonly.mjs:105` | downloaded **source bytes** (inside `verifyCheckpoint`) | restricted source | **must change** |
| `h9-a5-dev-readonly.mjs:163` | A5 result object | evidence metadata | keep strict |
| `h9-a5-dev-readonly.mjs:192` | A5 result + runtime block | evidence metadata | keep strict |
| `source-checkpoint.mjs:80` | downloaded **source bytes** | restricted source | **must change** |
| `source-checkpoint.mjs:100` | `result.provenance` | evidence metadata | keep strict |

`h9-a5-dev-readonly.mjs` is in `RUNTIME_FILES` and is hash-pinned by
`runtime-manifest.json`; `verifyRuntime` refuses `runtime-hash` and `a5-with-token.ps1`
refuses `h9-hash` on any byte change. Creation is gated by the same function, because
`source-checkpoint.mjs:101` calls `verifyCheckpoint(result, after.functions, now)`.
So neither creation nor verification can be fixed from the unprotected side alone, and
fixing only `source-checkpoint.mjs` would produce a checkpoint the live A5 re-run
rejects — the inconsistency the task forbids.

## 2. Classification of the 6 matches (no values exposed)

All six matches are the **same** normalized literal, `sha256` =
`c327520f85b0c6058fed05dfc0a63d8755f325b6ea1b550824f4a8e380d75de1`, masked shape
`8801#########`. It is the standard Bangladeshi documentation/example subscriber
number, written in three forms (local, country-code, E.164) to explain
canonicalization.

| File (captured v26) | Lines | Occurrences | Placement |
|---|---|---|---|
| `sync/_shared/phone.ts` | 11, 23 | 3 | comment / JSDoc only |
| `sync/deviceLogin.ts` | 68, 84 | 3 | comment / JSDoc only |

Every match sits on a line beginning with `//`, `*` or `/*` — verified
programmatically, not by eye. Across all 37 captured files: **zero** `sbp_`,
`sb_secret_`, `whsec_`, `postgres://`/`postgresql://`, `BEGIN … PRIVATE KEY` or
`Bearer <token>` matches. The only pattern class present is the example phone.

## 3. The mechanism — `scripts/h9/h9-a5-dev-readonly.mjs` (PROTECTED)

`assertEvidenceSafe` is split into two constants, the metadata regex derived from the
phone pattern so the scopes cannot drift:

```js
const CREDENTIAL_SHAPES = /sbp_…|sb_secret_…|whsec_…|postgres(?:ql)?:\/\/…|BEGIN .*PRIVATE KEY|Bearer\s+[A-Za-z0-9_.-]{12,}/i;
const BD_SUBSCRIBER = /\+?8801\d{9}/g;
const BD_SUBSCRIBER_ONE = new RegExp(BD_SUBSCRIBER.source, 'i');
```

`assertEvidenceSafe(value)` is behaviourally unchanged — the same seven alternatives,
the same `i` flag, the same `evidence-sensitive` code — so metadata, logs and provenance
stay strict.

`assertSourceSafe(value, key)` takes the file's **bytes** and admits a subscriber
literal only against a pinned record:

```js
export const SOURCE_SUBSCRIBER_ALLOWLIST = Object.freeze({
  'sync/_shared/phone.ts': Object.freeze({
    fileSha256: 'a9941f74f859281da3cf6688096a8fdc91505300469de2af87e22352636c8a5d',
    literalSha256: 'c327520f85b0c6058fed05dfc0a63d8755f325b6ea1b550824f4a8e380d75de1',
    offsets: Object.freeze([649, 669, 1177]),
  }),
  'sync/deviceLogin.ts': Object.freeze({
    fileSha256: '502e330ac6ba34da4da136edb156ff80a8318719b9e80f1744a2b3c22e0abadc',
    literalSha256: 'c327520f85b0c6058fed05dfc0a63d8755f325b6ea1b550824f4a8e380d75de1',
    offsets: Object.freeze([3053, 3686, 3704]),
  }),
});
```

Checks, in order, each with its own refusal code:

1. `source-credential` — any credential class, in any file, always.
2. no subscriber match → return.
3. `source-subscriber-file` — the key is not one of the two approved paths.
4. `source-subscriber-bytes` — `sha256(bytes)` ≠ the pinned file hash. **This is the
   decisive gate.** Each pinned hash is exactly the value the download gate recorded for
   that captured file, so the pin ties the guard to the bytes already in the manifest,
   provenance and checkpoint.
5. `source-subscriber-count` / `source-subscriber-location` /
   `source-subscriber-undeclared` — match count, each match offset, and each literal
   hash against the pin.

Checks 5 are unreachable while the byte pin holds, because identical bytes cannot yield
different matches. They are kept as defence in depth against an allowlist edited into
disagreement with itself, and the lexer test in §6 is what actually enforces the
recorded `offsets` and `literalSha256`. This is stated plainly rather than presented as
independent coverage.

Why a byte pin and not a comment test: deciding comment-ness needs a real lexer, and the
protected runtime may not take that dependency — its verified import closure is Node
built-ins only (`node:crypto`, `node:fs`, `node:path`, `node:url`; TypeScript appears
nowhere but in an explanatory comment). So comment-ness is established **once**, out of
band, by the TypeScript scanner during local verification, and recorded here as hash +
offsets. Identical bytes imply identical comment structure; any edit breaks the hash; and
moving the number into executable code necessarily changes the bytes, so it cannot pass.

The call site at `verifyCheckpoint` passes bytes:

```diff
-    assertEvidenceSafe(bytes.toString('utf8'));
+    assertSourceSafe(bytes, sourceKey(checkpoint.directory, file.path));
```

**Operational consequence to accept knowingly:** the guard is now byte-exact to v26's
`phone.ts` and `deviceLogin.ts`. If either file changes, a future capture refuses
`source-subscriber-bytes` until the pin is re-established by the same lexer-verified
procedure and re-approved. That is the intended fail-closed behaviour, not a defect.

## 4. Required change — `scripts/h9/source-checkpoint.mjs` (not protected)

Line 11, import `assertSourceSafe` alongside the rest; line 80:

```diff
-      const bytes=readFileSync(p);assertEvidenceSafe(bytes.toString('utf8'));
+      const bytes=readFileSync(p);assertSourceSafe(bytes.toString('utf8'));
```

Line 100 (`assertEvidenceSafe(result.provenance)`) stays as-is.

## 5. Reinstall and re-anchor custody

```text
C:\Program Files\PowerShell\7\pwsh.exe -NoProfile -File D:\Muthoy\scripts\h9\install-local-runtime.ps1
C:\Windows\System32\cmd.exe /d /c C:\Users\Imrul\.muthoy-h9-ws\b8ca5d8\ws1-a5\verify-a5.cmd
```

Both were run. The installer refuses any destination other than the fixed path and any
HEAD other than `b8ca5d8c9538fd41605b09d5a9475e16ff496c3d`; it re-copied the seven
allowlisted inputs, re-applied the owner/SYSTEM/Administrators DACLs, wrote a new
manifest and self-verified. `runtime-manifest.json` moved to
`641bfdc37d19a1e63cad1bdc629b27ce72241374d5d0587b0c970eca1d746dbf`; that is now the
custody anchor, and every earlier receipt citing `fe331080…` stays valid for the state
it recorded. All three existing A5 evidence directories were preserved.

`SOURCE_REVISION` stays `b8ca5d8c9538fd41605b09d5a9475e16ff496c3d` — it denotes the
backend revision the evidence pertains to, which has not moved. A reviewer who wants
the tool bytes named separately can add a `toolRevision` field; the manifest hash
already distinguishes them.

## 6. Tests — `scripts/h9/test/remediation.test.mjs` (not protected)

**65/65 passing, 0 fail, exit 0** (55 before this work; 10 guard cases). The suite
imports `typescript` as a test-only dependency; the protected runtime does not.

| Case | Expected |
|---|---|
| Every pinned offset lies inside a genuine comment per `ts.createScanner`; pinned file hashes equal the real bytes; one distinct literal hash | pass — this is what enforces `offsets` and `literalSha256` |
| Legitimate captured comments: the real bytes of both approved files, and end to end through `makeCheckpoint` + `verifyCheckpoint` | accepted; checkpoint carries no phone value and no source body |
| **Witness 1** `/* done */ const x = "+<n>";` | `source-subscriber-bytes` |
| **Witness 2** `*`-prefixed line inside a template literal | `source-subscriber-bytes` |
| **Witness 3** `*`-prefixed multiplication continuation | `source-subscriber-bytes` |
| Each witness appended to the genuine approved bytes | `source-subscriber-bytes` |
| Altered approved bytes: byte appended, comment reworded, occurrence removed, 4th occurrence added, unknown number substituted, occurrence moved into code, whitespace shifted | `source-subscriber-bytes` for all seven |
| Approved example in an unapproved location: other approved file, sibling module, other slug, test file, empty key | `source-subscriber-bytes` / `source-subscriber-file` |
| Credential leakage, six classes, standalone and appended to approved bytes | `source-credential` (checked before the subscriber logic) |
| Evidence metadata scope: the literal, and the whole approved file as metadata | `evidence-sensitive` |
| Source tampering after provenance; after a verified checkpoint | `provenance-file-hash`; `checkpoint-hash` |
| Wrong project in provenance, in either receipt, in the checkpoint | `provenance-identity` / `checkpoint-receipt` / `checkpoint-metadata` |
| Invalid provenance with the example present: missing command, reordered, extra flag, out-of-window, wrong `deployedBefore`, undeclared file | matching `provenance-*` code |

Each witness case first asserts the **premise** — that the TypeScript lexer agrees the
match is *not* inside a comment — and only then that the guard refuses, so the test
documents why refusal is correct rather than merely that something threw. Assertions
compare the exact refusal code: `refuse()` keeps a generic message and carries the reason
on `.code`, so a message-only regex can pass on the wrong refusal. That mistake was made
and corrected during this work.

## 7. Checkpoint created — and the freshness window that remains

Runbook step 5 was then run with the **existing** evidence, unaltered: the 37-file
capture, both genuine A5 receipts and provenance v2. No timestamp was changed and no
provenance was fabricated. The approved entry point printed
`SOURCE FILE INVENTORY VERIFIED; hosted provenance UNVERIFIED; values suppressed` and
exited 4, writing
`C:\Users\Imrul\.muthoy-h9-ws\b8ca5d8\ws1-a5\checkpoint.json`
(`6fdbd4f0e1277cb9d8b54ca212d499444c84299ad23815a117153e9faaafa5be`).

It fit because the window had not closed: the `before` receipt is
`2026-10-18T17:37:54.636Z` and creation ran at `2026-10-18T18:35:49Z` — 57m55s, inside
`makeCheckpoint`'s one-hour limit. Local midnight had passed in UTC+6, which is why the
calendar date had advanced while the UTC clock had not.

`verifyCheckpoint` was then run against the real clock and returned
`LOCAL FILE INVENTORY VERIFIED — HOSTED PROVENANCE UNVERIFIED`. The checkpoint holds
37 file hashes, both inventories, the ordered argv and `hostedProvenanceVerified:false`
— no source bodies, no subscriber values, no credential-shaped text (asserted).

**Still open:** `verifyCheckpoint` also enforces one hour from the `after` capture, so
this checkpoint stops being verifiable by a live A5 re-run after
`2026-10-18T18:40:21.297Z`. Runbook step 6 — the live `run-a5.cmd` that re-reads the
checkpoint with `-Checkpoint` — therefore needs a **fresh** capture: two new A5 runs, a
new provenance record and a new checkpoint, inside one window. That is a DEV read-only
operation and needs its own founder approval. The hosted source-provenance gate stays
open regardless; local custody is not server attestation.

## 8. The comment-boundary bypass (independent review finding)

Guard v1 decided comment-ness with a line-prefix test: the match had to sit on a line
whose trimmed prefix began `//`, `*` or `/*`. It was described at the time as
"conservative on purpose". It was not conservative; it was unsound, and it was wrong in
the permissive direction. Three witnesses, all reproduced against the shipped v1 bytes
before the fix and all **ACCEPTED** by it, while the TypeScript lexer reported none of
them inside a comment:

| Witness | Why v1 accepted it |
|---|---|
| `/* canonicalization */ const fallback = "+<n>";` | the prefix opens with `/*`, but the block comment is closed and the rest is code |
| a `*`-prefixed line inside a template literal | the prefix opens with `*`, but a template literal is one token — the line is data |
| `const total = base` / `  * rate + <n>;` | the prefix opens with `*`, but that `*` is multiplication |

After the fix all three refuse `source-subscriber-bytes`, and the regression suite keeps
each one with its lexer premise asserted. The lesson is recorded rather than smoothed
over: a lexical property must be decided by a lexer, and where the trust boundary cannot
host one, the property must be established out of band and pinned to exact bytes.
