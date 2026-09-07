// The production stand-in for the DEV registration harness.
//
// metro.config.js resolves `dev/devRegistrationHarness` to THIS file in every
// non-dev bundle (see dev/devOnlyResolver.cjs), so a release build contains
// this component and never the real one. It deliberately imports nothing: the
// point is that the harness, its Supabase calls, its MMKV identity store and
// its strings are absent from the bundle rather than merely unreachable.
//
// Keep the export name identical to the real module's, and keep this file
// inert. Anything added here ships to every user.

export function DevRegistrationHarness() {
  return null;
}
