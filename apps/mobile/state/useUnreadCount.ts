import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { getUnreadCount } from '../db/notifications';

export function useUnreadCount(shopId: string | undefined, userId: string | undefined): number {
  const [unreadCount, setUnreadCount] = useState(0);
  useFocusEffect(
    useCallback(() => {
      let isActive = true;
      if (shopId && userId) {
      void getUnreadCount(shopId, userId).then((count) => {
        if (isActive) {
          setUnreadCount(count);
        }
      }).catch(() => {
        if (isActive) {
          setUnreadCount(0);
        }
      });
      }
      return () => {
        isActive = false;
      };
    }, [shopId, userId]),
  );
  return unreadCount;
}
