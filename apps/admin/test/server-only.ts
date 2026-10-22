// The `server-only` package ships a module that THROWS on import, and relies on
// the bundler's "react-server" export condition to swap in an empty one. Next
// does that; a plain Node test runner does not, so importing any admin module
// that starts with `import 'server-only'` would fail before a single assertion
// ran — which is how a credential boundary ends up with no executable test.
//
// vitest.config.ts aliases 'server-only' here. This changes nothing about the
// build: `next build` still resolves the real package, so importing a
// server-only module from a 'use client' file is still a build failure, and
// lib/serviceRoleExposure.test.ts still asserts the marker is present on every
// module that reads a secret.
export {};
