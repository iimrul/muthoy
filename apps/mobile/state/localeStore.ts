import { create } from "zustand";
import { useCallback } from "react";
import {
  createJSONStorage,
  persist,
  type StateStorage,
} from "zustand/middleware";
import { createMMKV } from "react-native-mmkv";
import { catalog, type CatalogKey } from "../i18n/catalog";

export type Locale = "bn" | "en";

const storage = createMMKV({ id: "muthoy-locale" });
const adapter: StateStorage = {
  setItem: (name, value) => storage.set(name, value),
  getItem: (name) => storage.getString(name) ?? null,
  removeItem: (name) => storage.remove(name),
};

interface LocaleState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  toggle: () => void;
}

export const useLocaleStore = create<LocaleState>()(
  persist(
    (set) => ({
      locale: "bn",
      setLocale: (locale) => set({ locale }),
      toggle: () =>
        set((state) => ({ locale: state.locale === "bn" ? "en" : "bn" })),
    }),
    { name: "locale", storage: createJSONStorage(() => adapter) },
  ),
);

export function useI18n() {
  const locale = useLocaleStore((state) => state.locale);
  const t = useCallback(
    (key: CatalogKey): string => catalog[locale][key],
    [locale],
  );
  const formatNumber = useCallback(
    (value: number): string =>
      new Intl.NumberFormat(locale === "bn" ? "bn-BD" : "en-IN").format(value),
    [locale],
  );
  const formatDateTime = useCallback(
    (value: string | Date): string =>
      new Intl.DateTimeFormat(locale === "bn" ? "bn-BD" : "en-BD", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value)),
    [locale],
  );
  const formatTime = useCallback(
    (value: string | Date): string =>
      new Intl.DateTimeFormat(locale === "bn" ? "bn-BD" : "en-BD", {
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(value)),
    [locale],
  );
  return {
    locale,
    t,
    formatNumber,
    formatDateTime,
    formatTime,
  };
}
