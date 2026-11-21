// Non-money numeric display — Plus Jakarta Sans rule (CLAUDE.md rule 6).
// Same digit-grouping convention as formatMoney for consistency.
const NUMBER_LOCALE = 'en-IN';

// Built once on first use (see formatMoney.ts).
let numberFormat: Intl.NumberFormat | null = null;

export function formatNumber(value: number): string {
  numberFormat ??= new Intl.NumberFormat(NUMBER_LOCALE);
  return numberFormat.format(value);
}
