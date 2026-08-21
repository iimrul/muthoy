# native/

The ONLY code in this app that imports native modules (camera, location,
biometrics, notifications). ML Kit scanning needs an Expo development build,
not Expo Go (see TECH_STACK.md).

- `id.ts` — `generateId()`, every table's device-generated UUID
  (`expo-crypto`'s secure random source, not `Math.random`).
- `crypto.ts` — the only production PIN-crypto boundary. Android delegates
  standard cost-10 bcrypt to the local Expo module in
  `modules/muthoy-pin-crypto`, backed by `at.favre.lib:bcrypt` 0.10.2, and
  creates local-only lookup tags with a non-exportable Android Keystore HMAC
  key. Expo Go is unsupported; use a development/EAS build. `bcryptjs` remains
  dev-only for the Node test shim and is never bundled into production code.

`scanner.ts` (OCR + barcode, one ML Kit engine) remains a signature-only P1
stub. `notifications.ts` is live and owns local low-stock, expiry, and daily
summary checks plus OS delivery. Authenticated foreground startup initializes
notification permission and the Android channel; the channel is also ensured
before every post. Successful sales trigger checks after commit without
awaiting them, so notification failure cannot affect the completed sale.
