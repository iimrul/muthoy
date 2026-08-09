import { Text, View } from 'react-native';

// Notification Center — Volume 4 NOTIFICATION. P1 (post-beta fast-follow,
// Volume 0's scope lock). Not nested under a named subfolder in Volume 2's
// route tree, so placed at the app/ top level.
// TODO(P1): history list, unread count, severity styling
//   (info/warning/critical) — db/notifications.ts's listNotifications.
//   Volume 3: notifications(shop_id, is_read) index exists specifically for
//   an instant unread-count badge.
export default function NotificationCenterScreen() {
  return (
    <View>
      <Text>TODO: Notification Center (P1 — post-beta, Volume 4 NOTIFICATION)</Text>
    </View>
  );
}
