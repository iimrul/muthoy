import { Tabs } from 'expo-router';

// (tabs)/_layout.tsx — Volume 0 Day 5's navigation shell. Built now, ahead of
// Day 5, because Day 8's Inventory list is otherwise unreachable: nothing
// routes to /(tabs)/inventory without a tab navigator wrapping it. Minimal
// 3-tab bar (Dashboard, Sale, Inventory) — each screen renders its own
// StandardHeader, so the navigator's own header stays off.
export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="dashboard" options={{ title: 'Dashboard' }} />
      <Tabs.Screen name="sale" options={{ title: 'Sale' }} />
      <Tabs.Screen name="inventory" options={{ title: 'Inventory' }} />
    </Tabs>
  );
}
