import { Tabs } from 'expo-router';

// The four primary screens (Home/Staff Home, Sale, Inventory) live in a Tabs
// navigator so each one is built ONCE and then kept, instead of being torn down
// and rebuilt — with every query re-run — on every bottom-bar tap. Measured on
// a Galaxy A04s before this change (dev mode): Home 8.1 s, Sale 2–3.5 s,
// Inventory 2.9 s to settle after a tap.
//
// B1's AppNavigationShell still owns the visible bottom bar, so the navigator's
// own bar is hidden. The B1 concern with a hidden Tabs navigator — that it would
// mount its first route (`dashboard`) by itself and compete with role-aware
// login — does not apply with `lazy`: a tab is built only when it is focused,
// and the focused tab always comes from the URL the role-aware router chose.
//
// - freezeOnBlur: a tab that is not visible does not re-render (e.g. Sale no
//   longer re-renders on every cart +/- while the cart is open).
// - backBehavior "none": the hardware back button leaves the tabs exactly as it
//   did with the previous replace-based navigation, never to a tab the role
//   cannot open.
// - Screens that show live data refresh on focus (useFocusEffect), so a kept
//   screen is never stale.
export default function TabsLayout() {
  return (
    <Tabs
      tabBar={() => null}
      backBehavior="none"
      screenOptions={{ headerShown: false, lazy: true, freezeOnBlur: true }}
    />
  );
}
