# native/

The ONLY code in this app that imports native modules (camera, location,
biometrics, notifications, filesystem/share, BLE). ML Kit scanning and local
BLE/PIN modules need an Expo development build, not Expo Go (see TECH_STACK.md).

- `id.ts` — `generateId()`, every table's device-generated UUID
  (`expo-crypto`'s secure random source, not `Math.random`).
- `crypto.ts` — the only production PIN-crypto boundary. Android delegates
  standard cost-10 bcrypt to the local Expo module in
  `modules/muthoy-pin-crypto`, backed by `at.favre.lib:bcrypt` 0.10.2, and
  creates local-only lookup tags with a non-exportable Android Keystore HMAC
  key. Expo Go is unsupported; use a development/EAS build. `bcryptjs` remains
  dev-only for the Node test shim and is never bundled into production code.

- `scanner.ts` is live: on-device ML Kit OCR plus barcode recognition, with no
  cloud image dependency.
- `notifications.ts` owns local low-stock, expiry, overdue-credit, and daily
  summary checks plus OS delivery. Authenticated foreground startup initializes
  permission/channel state. Successful sales trigger checks after commit, so
  notification failure cannot affect a completed sale.
- `reportExport.ts` writes paged UTF-8 CSV/XLSX files to app cache and shares
  them through the OS sheet. Bangla text and integer-paisa-to-taka formatting
  are handled at the export boundary.
- `printer.ts` owns Android BLE permission, scan, device-local MMKV pairing,
  retry/error mapping, and ESC/POS transport through
  `modules/muthoy-ble-printer`. Beta printing is Android-only.
