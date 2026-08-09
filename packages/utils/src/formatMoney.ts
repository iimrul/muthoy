import { type Paisa, toTaka } from '@muthoy/types';

// Money is stored and computed as integer paisa (see packages/types/money.ts)
// and only converted to taka HERE, at the display boundary. Takes a branded
// `Paisa` so a taka value can never be passed in by mistake — that would
// render every amount 100x too small.
//
// Displayed with BDT (৳) and Bangladeshi lakh/crore digit grouping
// (1,00,000 not 100,000). Intl has no 'en-BD' locale, but 'en-IN' produces the
// same grouping — see DECISIONS.md. Pair this string with the DM Mono font
// wherever it renders; never hand-format money inline (CLAUDE.md rule 6).
const MONEY_LOCALE = 'en-IN';

export function formatMoney(amount: Paisa): string {
  const formatted = new Intl.NumberFormat(MONEY_LOCALE, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(toTaka(amount));
  return `৳${formatted}`;
}
