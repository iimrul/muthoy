import { asPaisa, type Paisa } from '@muthoy/types';

export const MIN_TAX_RATE_BP = 0;
export const MAX_TAX_RATE_BP = 10_000;

/** Integer round-half-up. Inputs must be non-negative whole integers. */
export function divideRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (numerator < 0n || denominator <= 0n) throw new Error('Invalid round-half-up operands');
  return (numerator + denominator / 2n) / denominator;
}

/** Extract shop tax from an MRP-inclusive total without changing that total. */
export function extractInclusiveTax(total: Paisa, rateBp: number): Paisa {
  if (!Number.isInteger(total) || total < 0) throw new Error('Total must be non-negative integer paisa');
  if (!Number.isInteger(rateBp) || rateBp < MIN_TAX_RATE_BP || rateBp > MAX_TAX_RATE_BP) {
    throw new Error('Tax rate must be an integer from 0 to 10000 basis points');
  }
  if (total === 0 || rateBp === 0) return asPaisa(0);
  const value = divideRoundHalfUp(BigInt(total) * BigInt(rateBp), BigInt(10_000 + rateBp));
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Tax amount exceeds safe integer paisa');
  return asPaisa(Number(value));
}

export function normalizeTaxLabel(value: string): string {
  const label = value.trim();
  if (!label || label.length > 24) throw new Error('Tax label must be 1 to 24 characters');
  return label;
}
