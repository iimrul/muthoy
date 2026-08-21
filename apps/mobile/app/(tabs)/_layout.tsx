import { Slot } from 'expo-router';

// B1's AppNavigationShell owns the prototype bottom navigation. A second,
// hidden Tabs navigator would independently choose its first route
// (`dashboard`) when the group mounts, competing with role-aware login.
export default function TabsLayout() {
  return <Slot />;
}
