// i18n/formatters.ts — every Intl formatter the app uses, built ONCE per
// locale and style. Building an Intl.NumberFormat / DateTimeFormat is far more
// expensive than using one (locale data lookup, option resolution), and screens
// format dozens of figures per render; useI18n used to build a new formatter
// for every single figure. Output is unchanged: same locales, same options.
//
// A DateTimeFormat fixes the device time zone when it is built. The app runs in
// one zone (Asia/Dhaka), so caching for the life of the process is safe.

export type FormatterLocale = "bn" | "en";

const formatters = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat>();

function cached<T extends Intl.NumberFormat | Intl.DateTimeFormat>(key: string, create: () => T): T {
  const existing = formatters.get(key);
  if (existing) return existing as T;
  const created = create();
  formatters.set(key, created);
  return created;
}

// en-IN gives the Bangladeshi lakh/crore grouping (1,00,000); Intl has no en-BD
// number grouping of its own (DECISIONS.md).
const numberTag = (locale: FormatterLocale) => (locale === "bn" ? "bn-BD" : "en-IN");
const dateTag = (locale: FormatterLocale) => (locale === "bn" ? "bn-BD" : "en-BD");

export function numberFormatter(locale: FormatterLocale): Intl.NumberFormat {
  return cached(`number|${locale}`, () => new Intl.NumberFormat(numberTag(locale)));
}

export function moneyFormatter(locale: FormatterLocale): Intl.NumberFormat {
  return cached(
    `money|${locale}`,
    () => new Intl.NumberFormat(numberTag(locale), { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  );
}

export function percentFormatter(locale: FormatterLocale, signDisplay: "auto" | "always"): Intl.NumberFormat {
  return cached(
    `percent|${locale}|${signDisplay}`,
    () => new Intl.NumberFormat(dateTag(locale), { style: "percent", maximumFractionDigits: 0, signDisplay }),
  );
}

export function dayMonthFormatter(locale: FormatterLocale): Intl.DateTimeFormat {
  return cached(`dayMonth|${locale}`, () => new Intl.DateTimeFormat(dateTag(locale), { day: "numeric", month: "short" }));
}

export function dateTimeFormatter(locale: FormatterLocale): Intl.DateTimeFormat {
  return cached(
    `dateTime|${locale}`,
    () => new Intl.DateTimeFormat(dateTag(locale), { dateStyle: "medium", timeStyle: "short" }),
  );
}

export function timeFormatter(locale: FormatterLocale): Intl.DateTimeFormat {
  return cached(`time|${locale}`, () => new Intl.DateTimeFormat(dateTag(locale), { hour: "2-digit", minute: "2-digit" }));
}
