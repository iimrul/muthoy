# native/

The ONLY code in this app that imports native modules (camera, location,
biometrics, notifications). ML Kit scanning needs an Expo development build,
not Expo Go (see TECH_STACK.md).

`scanner.ts` (OCR + barcode, one ML Kit engine) and `notifications.ts`
(local low-stock/expiry/daily-summary scheduling) currently hold
signature-only stubs — both are P1 (post-beta fast-follow).
