# native/

The ONLY code in this app that imports native modules (camera, location,
biometrics, notifications). ML Kit scanning needs an Expo development build,
not Expo Go (see TECH_STACK.md).

- `id.ts` — `generateId()`, every table's device-generated UUID
  (`expo-crypto`'s secure random source, not `Math.random`).
- `crypto.ts` — `hashPin`/`verifyPinHash` (Days 4-5/11). The ONLY file that
  hashes or verifies a PIN. Uses `bcryptjs` (pure JS) with its salt RNG
  pointed at `expo-crypto`'s platform CSPRNG; the originally-chosen native
  module `react-native-bcrypt-cpp` turned out to ship no Android JNI
  registration at all upstream, so it could never load (see DECISIONS.md).
  Every db/ file that touches a PIN calls only these two functions, never
  bcrypt directly — which is what let the implementation swap without
  touching any SQL.

`scanner.ts` (OCR + barcode, one ML Kit engine) and `notifications.ts`
(local low-stock/expiry/daily-summary scheduling) currently hold
signature-only stubs — both are P1 (post-beta fast-follow).
