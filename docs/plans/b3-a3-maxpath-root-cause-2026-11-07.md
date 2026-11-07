# A3: the Android build failure is Windows MAX_PATH, confirmed by experiment

Written 2026-11-07 against baseline `ef46a84`. **The approved diagnostic build
was NOT run, and no APK exists.** The root cause was found by read-only
diagnosis instead, which is why the build budget was not spent — the approved
experiment tests a hypothesis now known not to be the cause.

Five previous attempts, roughly 70 minutes of build time, produced the same
error every time:

```
ninja: error: manifest 'build.ninja' still dirty after 100 tries
> Task :react-native-reanimated:buildCMakeRelWithDebInfo[arm64-v8a][reanimated] FAILED
```

---

## 1. The mechanism

Ninja re-runs the generator when it thinks `build.ninja` is out of date, reloads,
and gives up after 100 attempts. Asking ninja why — `ninja -d explain -n`, in the
real build directory — answers it in two lines:

```
ninja explain: output .../CMakeFiles/VerifyGlobs.cmake_force
               of phony edge with no inputs doesn't exist
ninja explain: output ../prefab/armeabi-v7a/prefab/lib/arm-linux-androideabi/cmake/
               react-native-worklets/react-native-workletsConfigVersion.cmake
               of phony edge with no inputs doesn't exist
```

A phony edge whose output does not exist is **permanently dirty**. The first is
by design — CMake uses it to force the glob check to run every build, and
`restat = 1` on that edge (`build.ninja:976`) lets ninja prune it. The second is
not by design, and nothing prunes it:

1. `react-native-workletsConfigVersion.cmake` is a declared input of
   `build build.ninja: RERUN_CMAKE` (`build.ninja:982`).
2. Ninja cannot see the file, so the manifest edge is dirty.
3. Ninja re-runs CMake. CMake regenerates correctly. The file still cannot be
   seen.
4. Loop → 100 tries → error.

**The file exists on disk.** That contradiction is the finding:

```
EXISTS  2026-11-04 18:16:42  react-native-worklets/react-native-workletsConfigVersion.cmake
```

Ninja stats it through the **relative** path recorded in the manifest, resolved
against its working directory, and Win32 applies MAX_PATH to the *combined*
length, not to the canonical path:

| form | length | ninja |
|---|---|---|
| relative, from the ABI build dir (cwd 142 + 1 + 121) | **264** | reported missing |
| `react-native-workletsConfig.cmake`, same dir (142 + 1 + 114) | **257** | **not** reported |
| canonical absolute path | 251 | — |

Two files, same directory, same build, names differing by seven characters. The
one over 260 is invisible to ninja; the one under it is fine. Ninja's own
behaviour splits exactly on the limit.

Both halves of the cap are confirmed, not assumed:

- `LongPathsEnabled = 0` (`HKLM\SYSTEM\CurrentControlSet\Control\FileSystem`).
- `ninja.exe` 1.10.2 contains no `longPathAware` manifest entry, so it is capped
  at 260 **even if** that registry flag were set. It is the only ninja on the
  machine, and CMake 3.22.1 is the only SDK CMake installed.

## 2. The controlled experiment

One variable changed — the length of ninja's working directory, via `subst`,
which creates a drive alias and writes nothing. Same files, same volume, same
ninja, same manifest.

| cwd | relative resolves to | worklets phantom |
|---|---|---|
| 142 chars (real path) | 264 | **present** |
| 41 chars (`subst X:`) | 163 | **gone** |

The `subst` was removed afterwards; `X:` is no longer mapped. The
`VerifyGlobs.cmake_force` phony remains in both runs, as expected, because that
one is intentional.

A plain `ninja -n` in the resting state now **converges** (exit 0, one CMake
re-run, no "still dirty"), and in that state every one of the 43 declared
manifest inputs exists, none is newer than `build.ninja`, none is future-dated,
and the glob check reports no mismatch. So the failure is not a corrupt build
directory or a stale timestamp — it is a path the build tool cannot see.

## 3. How much is over the limit

Every native build directory in the worktree, worst relative dependency per ABI:

| | |
|---|---|
| ABI build dirs scanned | 24 |
| **over MAX_PATH** | **3** — at 268, 264, 261 |
| within 3 characters of it | a further 3 — at 258, 257, 253 |
| minimum characters to remove | **9** |
| worst offender | `react-native-reanimated` `armeabi-v7a` → **268** |

This explains an observation I previously could not: **the failing module
changed between runs.** Several modules sit within a few characters of the
boundary, so which one trips first depends on build order, not on anything
random.

## 4. What this means for the four earlier hypotheses

| Hypothesis | Status now |
|---|---|
| `--ignore-scripts` / dependency install | Irrelevant, as observed. |
| **Windows path length** | **CORRECT. My earlier "disproved at `D:\mb`" was wrong** — see below. |
| Gradle parallelism race | Correctly disproved: not a race, fully deterministic. |
| Cross-volume prefab copying | Real, but a **different** phenomenon — the hard-link warnings, not this failure. |

**The correction that matters.** I reported path length as disproved because
moving the worktree to `D:\mb` (a 5-character root) did not fix the build. That
inference was invalid. Shortening the root reduced the total but left it at 268
— **8 characters** over the limit. The depth comes from the pnpm store
(`node_modules\.pnpm\_<32 hex>\node_modules\`, 72 characters before the package
name) and the prefab chain
(`.cxx\RelWithDebInfo\<hash>\prefab\<abi>\prefab\lib\<triple>\cmake\<pkg>\`), not
from the drive root. A test that cannot distinguish "shorter" from "short
enough" cannot disprove a threshold hypothesis, and I treated a negative result
as one.

**Consequence for the approved experiment.** Moving `GRADLE_USER_HOME` to D:
changes where prefab packages are *sourced from*; it does not shorten the
destination path inside the worktree, which is what exceeds 260. I predict it
would remove the hard-link warnings — a genuine, separate improvement, since
hard links cannot cross volumes and both are NTFS — and leave the ninja failure
exactly as it is. That prediction is why the build was not run. It is a
prediction, not a measurement.

## 5. Candidate fixes, with the arithmetic

The worst case is 268 and must reach 259 or below, so **≥ 9 characters**, with
headroom for the 258/257 cluster.

| Option | Saves | Result | Scope / risk |
|---|---|---|---|
| **A.** `subst` a drive for the worktree root (`D:\mb\` → `X:\`) | 3 | 265 | **Insufficient.** Ruled out by arithmetic. |
| **B.** pnpm `virtual-store-dir` to a short absolute path (`D:\mb\node_modules\.pnpm\` → `D:\v\`) | **20** | **248** | Worktree-local `.npmrc` + `pnpm install` there. Smallest change that works, reversible, main tree untouched. **Recommended.** |
| **C.** `virtual-store-dir-max-length` | uncertain | — | The store dir is already a 32-hex hash; benefit unproven. Adjunct to B at best. |
| **D.** `node-linker=hoisted` | 53 | 215 | Most headroom, but changes the dependency resolution model for the whole repo. Highest blast radius; not advisable mid-sprint for a money app. |
| **E.** Long-path-aware toolchain | n/a | fixes the class | Needs an admin, machine-wide `LongPathsEnabled=1` **and** a newer SDK CMake for a ninja ≥ 1.11. Two installs; not authorized. |
| **F.** Relocate `.cxx` per module | n/a | — | Requires editing dependency `build.gradle` files inside `node_modules`. Not viable. |

Option B is the one I would run, and it is the only one I am asking for.

## 6. What is NOT claimed

- **No APK exists.** Nothing about package identity, the Hermes bundle, the DEV
  backend, the debuggable flag, `allowBackup=false` or artifact provenance has
  been verified, because there is no artifact to verify.
- The root cause is established for the **three** directories measured over the
  limit. Whether a full build then succeeds is not proven — fixing the first
  blocker reveals whatever is behind it.
- Nothing was built, installed, or changed on the device. No app data was
  cleared. `apps/mobile/android` in the main tree, Preview, production and
  prototype-web are untouched; the only worktree change remains the previously
  reviewed `debuggable true`.
- The `subst` experiment and every probe in §1–§3 were read-only, apart from
  CMake regenerating its own `.cxx` build directory, which any build does.

## 7. Approval requested

One change and one build: add a worktree-local `.npmrc` setting
`virtual-store-dir` to a short absolute path on D:, run `pnpm install` in the
isolated worktree only, re-run the survey in §3 to confirm every ABI directory
is under the limit **before** building, then run one build.

If that build fails, it fails with new evidence rather than the same error, and
I will stop and report rather than iterate.
