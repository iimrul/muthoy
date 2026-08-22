const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function assertIsoDate(value: string): void {
  const match = ISO_DATE.exec(value);
  if (!match) throw new Error(`Invalid ISO date: ${value}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error(`Invalid ISO date: ${value}`);
  }
}

/** Bangladesh has used UTC+06:00 without DST since 2010. */
export function dhakaBusinessDate(now: Date): string {
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid date');
  return new Date(now.getTime() + DHAKA_OFFSET_MS).toISOString().slice(0, 10);
}

export function businessDateDifference(later: string, earlier: string): number {
  assertIsoDate(later);
  assertIsoDate(earlier);
  return (Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) / 86_400_000;
}
