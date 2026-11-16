import { z } from "zod";

export const MONEY_PRECISION_MESSAGE = "Use no more than two decimal places";

// Inspect decimal notation, not a floating-point multiplication/remainder.
export function hasMoneyPrecision(value: number): boolean {
  if (!Number.isFinite(value)) return false;
  const [coefficient = "", exponent = "0"] = String(value).toLowerCase().split("e");
  return Math.max(0, (coefficient.split(".")[1]?.length ?? 0) - Number(exponent)) <= 2;
}

export function hasExcessMoneyDecimals(text: string): boolean {
  const trimmed = text.trim();
  const match = /^[+-]?(?:\d+)?\.(\d*)(?:[eE][+-]?\d+)?$/.exec(trimmed);
  return (match?.[1]?.length ?? 0) > 2
    || (trimmed !== "" && Number.isFinite(Number(trimmed)) && !hasMoneyPrecision(Number(trimmed)));
}

// Invalid raw precision stays visible but cannot become a rounded numeric value.
export function moneyDraftValue(text: string): number | undefined {
  return text === "" ? undefined : hasExcessMoneyDecimals(text) ? Number.NaN : Number(text);
}

export const moneyAmountSchema = z.number().refine(hasMoneyPrecision, MONEY_PRECISION_MESSAGE);
