# Android Java Dialog crash — root-cause findings

**Date:** 2026-11-12. **Method:** read-only. No device, adb, build, network or code change. Logs contain
user and shop IDs; none are reproduced here. **Process disclosure:** early in the investigation one
`git status --short` ran in `D:\md`. Git may refresh its index stat cache during that command; it changes
no file content. All later git use was `diff --no-index` with `--no-optional-locks`.

## In plain English

The app crashed once on the test phone while the developer was live-editing the scanner screen. The
most likely cause is a developer-only tool: the red error box React Native shows during development
tried to close itself after its screen had already been torn down. **This very probably cannot happen
for real users**, because that tool does not exist in the released app. It is not proven yet; the
cheapest next step is to capture a full phone log during the next authorized test session. No code
change is recommended yet.

## 1. The exception (raw log exists)

`D:\MuthoyAudit-20261109\implementation\evidence\android-claude-round-java-crash-20261110.log` lines
3–16 (same in `android-claude-input-retest-crash-20261110.log` lines 101–116):

```
FATAL EXCEPTION: main   Process: com.muthoy.pos.dev
java.lang.IllegalArgumentException: View=DecorView@…[MainActivity] not attached to window manager
  at android.view.WindowManagerGlobal.findViewLocked(WindowManagerGlobal.java:729)
  at android.view.WindowManagerGlobal.removeView(WindowManagerGlobal.java:626)
  at android.view.WindowManagerImpl.removeViewImmediate(WindowManagerImpl.java:208)
  at android.app.Dialog.dismissDialog(Dialog.java:801)
  at android.app.Dialog$$ExternalSyntheticLambda1.run(D8$$SyntheticClass:2)
  at android.os.Handler.handleCallback(Handler.java:958) … Looper.loop … ActivityThread.main
```

- Exit record: `android-claude-round-exit-info-20261110.log`, reason 4, APP CRASH (EXCEPTION).
- Device: Samsung SM-A047F, Android 14 / API 34 (`D:\md\apps\mobile\.expo\dev\logs\start.log:810`).
- **Missing:** only the crash buffer was captured — no main/system logcat, no `WindowLeaked`, no
  ReactNativeJS line, and **no app or React Native frame in the stack**. The caller of `dismiss()` is
  therefore not in evidence. **The root cause below is an inference, not a finding.**

Timeline (UTC+6, 10 Nov): scanner open in camera-denied state 19:16; `MedicineTextScanner.tsx` saved
19:18:26 (added `statusBarTranslucent`, white status strip, extra wrapper); Metro "connection terminated
… not responding for 60 seconds" 19:18:53; JS logs resume 19:19:26; crash 19:19:43.9.

## 2. Most likely root cause (inference)

What the stack proves, assuming stock Android `Dialog` (Samsung's framework variant not inspected):

- `Dialog$$ExternalSyntheticLambda1 → dismissDialog` under `Handler.handleCallback` means the dismiss
  was **queued** — Android does that only when `Dialog.dismiss()` is called **off the main thread**.
- `dismissDialog()` is a no-op on an already-dismissed dialog, so a plain double dismiss is harmless.
  The exception means the dialog's window was torn down without the Dialog object knowing — normally
  the owning Activity was destroyed or recreated while the dialog was showing.

The only off-main-thread `Dialog.dismiss()` path found across React Native, react-native-screens, all
Expo packages (incl. dev-launcher/dev-menu) and the app's modules:

1. `HMRClient.js` calls `dismissRedbox()` on **every Fast Refresh update**
   (`react-native/Libraries/Utilities/HMRClient.js:226-230`, also ~350–372).
2. → `ExceptionsManagerModule.dismissRedbox()` (`ReactAndroid/.../modules/core/ExceptionsManagerModule.kt:63-67`)
   — an async native-module method, so it runs on the native-modules thread.
3. → `DevSupportManagerBase.hideRedboxDialog()` (`.../devsupport/DevSupportManagerBase.kt:298-300`)
4. → `RedBoxDialogSurfaceDelegate.hide()` → `dialog?.dismiss()` (`.../devsupport/RedBoxDialogSurfaceDelegate.kt:133-142`).
   Its `try/catch IllegalArgumentException` cannot help: the failing dismiss runs later, on the main
   thread, outside the try.

Every other dismiss (RN `Modal` — asserts the UI thread, `ReactModalHostView.kt:195-216`; LogBox; dev
menu) runs on the UI thread and cannot produce this stack.

Probable chain: a dev RedBox attached to a MainActivity instance → that Activity was destroyed
(expo-dev-launcher restarts MainActivity with `NEW_TASK|CLEAR_TASK` on dev-URL redelivery,
`DevLauncherController.kt:52-54,386-395`; the 19:13 Metro reconnect redelivered it) → the scanner
edit's Fast Refresh called `dismissRedbox()` off-main → queued dismiss hit the dead window.

- The `statusBarTranslucent` edit is probably only the **trigger** (it caused a Fast Refresh), not the
  cause: the scanner's Modal dismisses synchronously on the UI thread.
- DevLauncher's crash handler waits ~2 s before handing over (`DevLauncherUncaughtExceptionHandler.kt:76-91`),
  so the real throw was likely ~2 s before the logged time.
- **Weakness:** no RedBox is visible in the 19:09–19:15 screenshots, and there is no main logcat.
- **Ruled out:** the approved react-native-screens PR 4413 backport — it changes only C++ files;
  its only Dialogs belong to FormSheet, which the app does not use.

## 3. Production impact and reproduction (not executed)

- **The identified path is dev-only**: HMR is absent in release; `dismissRedbox` checks dev support;
  the release dev-support manager's `hideRedboxDialog()` is a no-op (`ReleaseDevSupportManager.kt:56`);
  dev-launcher is in the `src/debug` source set.
- **Residual release risk: low, not zero.** RN `Modal` skips dismiss only when the Activity is
  finishing (`ReactModalHostView.kt:203-207`); upstream notes the same exception "without clear repro"
  (`:410-415`). MainActivity does not handle locale/fontScale/density changes itself
  (`android/app/src/main/AndroidManifest.xml:23`), so those recreate it. A release crash of this
  kind would show a different (synchronous) stack. Not proven reachable.
- **Deterministic mechanism repro** (instrumented test): show a Dialog → destroy/recreate the Activity
  → call `dismiss()` from a background thread → expect this exact stack.
- **Session replay on the Dev build** (likely, not guaranteed), with `logcat -b all -v threadtime`
  from the start: launch via Metro → open Sale → redeliver the dev URL (Activity recreated) → open the
  scanner in denied state → save `MedicineTextScanner.tsx` to trigger Fast Refresh; repeat, including
  after a >60 s Metro drop. Look for `WindowLeaked`, the DevLauncher handler line, the FATAL.
- **To attribute the caller:** debugger logpoint on `android.app.Dialog.dismiss` with condition
  `Looper.myLooper() != Looper.getMainLooper()`, logging thread name and stack.

## 4. Fix options, ranked

React Native core is consumed as a prebuilt Maven AAR (`android/app/build.gradle:157`), so **a pnpm
patch to ReactAndroid `.kt` files would not be compiled in.**

1. **F0 — zero code (recommended now).** Capture `logcat -b all` and the logpoint in the next
   authorized device session. After any dev-URL redelivery, do a full reload before live-editing.
   Keep the finding classified as dev tooling until evidence says otherwise.
2. **F1 — app-native, debug-only, needs a native rebuild and a new APK approval.** Via a config plugin
   (MainActivity is generated by prebuild), close the RedBox while its window is still attached:
   ```kotlin
   override fun onDestroy() {
     if (BuildConfig.DEBUG) {
       (application as ReactApplication).reactHost?.devSupportManager?.hideRedboxDialog()
     }
     super.onDestroy()
   }
   ```
   Risk: addresses only the RedBox hypothesis; native code under CNG.
3. **F2 — upstream React Native.** Run `dismissRedbox` on the UI thread
   (`UiThreadUtil.runOnUiThread { devSupportManager.hideRedboxDialog() }`), which makes the existing
   try/catch effective. Needs RN from source or an upgrade — report upstream instead.
4. **Not recommended:** removing `statusBarTranslucent` from the scanner — not shown causal, and it
   would undo the F-04 contrast fix.

## 5. Regression check

- Mechanism test (section 3) passes with the chosen fix.
- Dev build with `logcat -b all`: recreate the Activity via dev-URL redelivery → open scanner → 5 Fast
  Refreshes → normal Close; ×10. Pass = no FATAL, no `WindowLeaked`, no Dialog `IllegalArgumentException`.
- Release/preview APK: open/close the scanner and other Modals; background/foreground with a Modal
  open; change font size and system language with a Modal open. Pass = no crash.

## 6. Confidence

| Claim | Confidence |
|---|---|
| Exception and stack | certain (raw log) |
| Off-main-thread `Dialog.dismiss()` after the window was torn down | ~75% |
| Caller is RN RedBox hide via `dismissRedbox` on Fast Refresh | ~40% |
| Dev-only | ~70% |

What would raise it: a full `logcat -b all` for 19:17–19:20 (`WindowLeaked` naming the dialog, the
DevLauncher line, ReactNativeJS), `dumpsys activity` history around 19:13, or the logpoint result.
