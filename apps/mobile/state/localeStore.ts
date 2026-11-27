import { create } from "zustand";
import { useCallback } from "react";
import {
  createJSONStorage,
  persist,
  type StateStorage,
} from "zustand/middleware";
import { createMMKV } from "react-native-mmkv";
import { catalog, type CatalogKey } from "../i18n/catalog";
import {
  dateTimeFormatter,
  dayMonthFormatter,
  moneyFormatter,
  numberFormatter,
  percentFormatter,
  timeFormatter,
} from "../i18n/formatters";
import { toTaka, type Paisa } from "@muthoy/types";
import { parseStoredTimestamp } from "../domain/storedTimestamp";

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
  // Cached formatters (i18n/formatters.ts): one per locale and style, never
  // one per figure.
  const formatNumber = useCallback(
    (value: number): string => numberFormatter(locale).format(value),
    [locale],
  );
  // parseStoredTimestamp: a zone-less SQLite stamp is UTC, never local time
  // (domain/storedTimestamp.ts — notifications read six hours early).
  const formatDate = useCallback(
    (value: string | Date): string => dayMonthFormatter(locale).format(parseStoredTimestamp(value)),
    [locale],
  );
  const formatDateTime = useCallback(
    (value: string | Date): string => dateTimeFormatter(locale).format(parseStoredTimestamp(value)),
    [locale],
  );
  const formatTime = useCallback(
    (value: string | Date): string => timeFormatter(locale).format(parseStoredTimestamp(value)),
    [locale],
  );
  const formatPercent = useCallback(
    (value: number, signDisplay: "auto" | "always" = "auto"): string =>
      percentFormatter(locale, signDisplay).format(value),
    [locale],
  );
  const formatMoney = useCallback(
    (value: Paisa): string => `৳${moneyFormatter(locale).format(toTaka(value))}`,
    [locale],
  );
  return {
    locale,
    t,
    formatNumber,
    formatDate,
    formatDateTime,
    formatTime,
    formatPercent,
    formatMoney,
  };
}
