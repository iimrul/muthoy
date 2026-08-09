# assets/fonts/

Reserved fallback: if `@expo-google-fonts/*` ever stops resolving for one of
the three brand fonts, a manually-bundled `.ttf` goes here and loads via
`expo-font`'s local-asset API instead. Empty as of Day 1 — all three brand
fonts currently load via `@expo-google-fonts/*` packages (see `app/_layout.tsx`).
