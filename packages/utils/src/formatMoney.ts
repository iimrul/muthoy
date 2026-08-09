// Money uses BDT (৳) with Bangladeshi lakh/crore digit grouping (1,00,000,
// not 100,000). Intl has no 'en-BD' locale, but 'en-IN' produces the same
// grouping — see DECISIONS.md. Pair this string with the DM Mono font
// wherever it renders; never hand-format money inline (CLAUDE.md rule 6).
const MONEY_LOCALE = 'en-IN';

export function formatMoney(amount: number): string {
  const formatted = new Intl.NumberFormat(MONEY_LOCALE, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return `৳${formatted}`;
}
