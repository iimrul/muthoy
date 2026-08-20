import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { getShopName } from '../../db/settings';
import { hasPermissionForRoleName, type Permission } from '../../domain/permissions';
import { useSessionStore } from '../../state/sessionStore';
import { switchUser } from '../../state/switchUser';

// MorningDashboard — Volume 0 Day 5: "a shell showing shop name and a
// greeting", and the (tabs) group's landing tab.
//
// Deliberately has NO StandardHeader — Volume 4 NAVIGATION: the standardized
// header applies to "every screen except MorningDashboard and Registration".
//
// This is a SHELL, not a summary screen: it owns no business logic and reads
// nothing but the shop's name. Every tile below routes to a screen that
// already exists; none of their logic is duplicated here. Volume 4's richer
// dashboard content (today's totals, alerts) is not specced beyond this, so
// it is not invented.

const MORNING_ENDS_HOUR = 12;
const AFTERNOON_ENDS_HOUR = 17;

function greetingFor(hour: number): string {
  if (hour < MORNING_ENDS_HOUR) {
    return 'Good morning';
  }
  return hour < AFTERNOON_ENDS_HOUR ? 'Good afternoon' : 'Good evening';
}

interface NavEntry {
  label: string;
  hint: string;
  href: Href;
  /** Sibling tab rather than a stack push — switch tabs instead of stacking. */
  isTab?: boolean;
  /**
   * Matches the destination screen's own guard; never widens access. Hiding a
   * tile is a convenience, not the enforcement: the destination route and the
   * db/ action behind it both check again (Volume 0 Day 11).
   */
  permission?: Permission;
}

// Every href below points at a route file that already exists. Module scope so
// the array is not reallocated on each render.
const NAV_ENTRIES: NavEntry[] = [
  { label: 'New sale', hint: 'Search, scan, and check out', href: '/(tabs)/sale', isTab: true },
  { label: 'Inventory', hint: 'Medicines, batches, and stock', href: '/(tabs)/inventory', isTab: true },
  { label: 'Customer credit', hint: 'Balances and collections', href: '/credit/credit-sales', permission: 'credit_management' },
  { label: 'Expiry', hint: 'Batches by nearest expiry', href: '/inventory/expiry' },
  { label: 'Cash summary', hint: "Today's expected cash", href: '/cash-summary', permission: 'cash_management' },
  { label: 'Expenses', hint: 'Record a shop expense', href: '/expenses', permission: 'cash_management' },
  { label: 'End of day', hint: 'Count the drawer and close the day', href: '/end-of-day', permission: 'cash_management' },
  { label: 'Staff', hint: 'Add or manage staff logins', href: '/staff/management', permission: 'staff_management' },
  { label: 'Settings', hint: 'Change your PIN', href: '/settings/settings', permission: 'settings_manage' },
];

// Volume 0 Days 5/11: the shared pharmacy phone changes hands during a shift.
// Deliberately NOT permission-gated and NOT on the owner-only Settings screen
// — a staff member must be able to hand the device back, which is impossible
// if the only exit lives behind 'settings_manage'. Confirmed first, because a
// mis-tap discards the in-progress cart (state/switchUser.ts).
function confirmSwitchUser(): void {
  Alert.alert(
    'Switch user?',
    'The app returns to PIN login. Any unfinished sale is cleared. This shop stays set up on this device.',
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Switch user',
        onPress: () => {
          switchUser();
          // Back to the root gate, not straight to PIN Login: app/index.tsx
          // re-derives the destination from SQLite, so an unfinished
          // registration lands on the right screen instead of a PIN prompt
          // no local hash could ever satisfy.
          router.replace('/');
        },
      },
    ],
  );
}

export default function MorningDashboardScreen() {
  const session = useSessionStore((state) => state.session);
  const [shopName, setShopName] = useState<string | null>(null);

  const loadShopName = useCallback(async () => {
    if (!session) {
      return;
    }
    try {
      setShopName(await getShopName(session.shopId));
    } catch {
      // The greeting and every nav tile still work without the name, so a
      // failed read must not blank the shop's landing screen.
      setShopName(null);
    }
  }, [session]);

  useEffect(() => {
    // SQLite load-on-mount, same as the sibling tabs; TanStack Query is
    // reserved for sync.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadShopName();
  }, [loadShopName]);

  // Unreachable in practice: app/index.tsx's RootSessionGate only redirects
  // here once a session is confirmed. Matches the sibling tabs' guard.
  if (!session) {
    return null;
  }

  const entries = NAV_ENTRIES.filter(
    (entry) => !entry.permission || hasPermissionForRoleName(session.role, entry.permission),
  );

  return (
    <View className="flex-1 bg-brand-softGreen">
      <ScrollView contentContainerClassName="gap-4 p-4">
        <View className="gap-1 pt-2">
          <Text className="font-sans text-sm text-midGray">{greetingFor(new Date().getHours())}</Text>
          <Text className="font-sans-bold text-2xl text-richBlack">{shopName ?? 'Your shop'}</Text>
          {/* Who the device currently belongs to — the one thing a handover
              needs to show, so nobody sells under someone else's login. */}
          <Text className="font-sans text-xs text-midGray">
            Signed in as {session.role === 'owner' ? 'Owner' : 'Staff'}
          </Text>
        </View>

        <View className="gap-3">
          {entries.map((entry) => (
            <Pressable
              key={entry.label}
              onPress={() => (entry.isTab ? router.replace(entry.href) : router.push(entry.href))}
              accessibilityRole="button"
              accessibilityLabel={entry.label}
              className="gap-1 rounded-lg bg-white p-4 active:opacity-80"
            >
              <Text className="font-sans-semibold text-base text-richBlack">{entry.label}</Text>
              <Text className="font-sans text-xs text-midGray">{entry.hint}</Text>
            </Pressable>
          ))}
        </View>

        <Pressable
          onPress={confirmSwitchUser}
          accessibilityRole="button"
          accessibilityLabel="Switch user"
          className="gap-1 rounded-lg border border-midGray p-4 active:opacity-80"
        >
          <Text className="font-sans-semibold text-base text-richBlack">Switch user</Text>
          <Text className="font-sans text-xs text-midGray">
            Lock the app and hand the device to someone else
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}
