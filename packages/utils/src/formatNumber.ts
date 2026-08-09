// Non-money numeric display — Plus Jakarta Sans rule (CLAUDE.md rule 6).
// Same digit-grouping convention as formatMoney for consistency.
const NUMBER_LOCALE = 'en-IN';

export function formatNumber(value: number): string {
  return new Intl.NumberFormat(NUMBER_LOCALE).format(value);
}
