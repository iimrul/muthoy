// Same stub as vector-icons.ts, in its OWN file on purpose: vi.mock keys on the
// resolved path, so if Feather and MaterialCommunityIcons aliased to one file a
// suite mocking both (tests/navigation-shell.test.tsx) would have one mock
// silently replace the other.
export default function StubIcon(): null {
  return null;
}
