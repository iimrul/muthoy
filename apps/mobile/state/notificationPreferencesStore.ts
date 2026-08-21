import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import { createMMKV } from 'react-native-mmkv';

export interface NotificationPreferences {
  all: boolean;
  stock: boolean;
  expiry: boolean;
  credit: boolean;
  dailyCash: boolean;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  all: true,
  stock: true,
  expiry: true,
  credit: true,
  dailyCash: true,
};

const storage = createMMKV({ id: 'muthoy-notification-preferences' });
const adapter: StateStorage = {
  setItem: (name, value) => storage.set(name, value),
  getItem: (name) => storage.getString(name) ?? null,
  removeItem: (name) => storage.remove(name),
};

interface PreferenceState {
  byShop: Record<string, NotificationPreferences>;
  getForShop: (shopId: string) => NotificationPreferences;
  saveForShop: (shopId: string, preferences: NotificationPreferences) => void;
}

export const useNotificationPreferencesStore = create<PreferenceState>()(persist(
  (set, get) => ({
    byShop: {},
    getForShop: (shopId) => get().byShop[shopId] ?? DEFAULT_NOTIFICATION_PREFERENCES,
    saveForShop: (shopId, preferences) => set((state) => ({ byShop: { ...state.byShop, [shopId]: preferences } })),
  }),
  { name: 'preferences', storage: createJSONStorage(() => adapter) },
));

export function readNotificationPreferences(shopId: string): NotificationPreferences {
  return useNotificationPreferencesStore.getState().getForShop(shopId);
}
