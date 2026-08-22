import { asPaisa, type Paisa } from '@muthoy/types';

/** Parses decimal taka text exactly, without binary floating-point money. */
export function parseTakaTextToPaisa(value: string): Paisa {
  const normalized = value.trim();
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!match) throw new Error('Enter a non-negative taka amount with at most 2 decimal places');
  const whole = BigInt(match[1]!);
  const fraction = BigInt((match[2] ?? '').padEnd(2, '0'));
  const paisa = whole * 100n + fraction;
  if (paisa > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Money amount exceeds safe integer range');
  return asPaisa(Number(paisa));
}
