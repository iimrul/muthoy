import type { Locale } from "../state/localeStore";

const PREFIX = "@muthoy-i18n:";

export function encodeLocalizedText(en: string, bn: string): string {
  return `${PREFIX}${JSON.stringify({ en, bn })}`;
}

export function localizeStoredText(value: string, locale: Locale): string {
  if (!value.startsWith(PREFIX)) return value;
  try {
    const parsed = JSON.parse(value.slice(PREFIX.length)) as {
      en?: unknown;
      bn?: unknown;
    };
    const localized = parsed[locale];
    return typeof localized === "string" ? localized : value;
  } catch {
    return value;
  }
}
