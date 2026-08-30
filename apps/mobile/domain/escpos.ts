import { asPaisa } from '@muthoy/types';
import type { MonthlyReportSnapshot, ReportSnapshot } from '../db/reports';
import { paisaToTakaText } from './export';

const WIDTH = 32;
const ESC = 0x1b; const GS = 0x1d;

export function thermalText(value: string): string {
  return value.normalize('NFKD').replace(/[^\x20-\x7E]/g, '?');
}
export function centerThermal(value: string, width = WIDTH): string {
  const text = thermalText(value).slice(0, width);
  return `${' '.repeat(Math.max(0, Math.floor((width - text.length) / 2)))}${text}`;
}
export function thermalColumns(label: string, value: string, width = WIDTH): string {
  const left = thermalText(label); const right = thermalText(value);
  if (left.length + right.length + 1 <= width) return `${left}${' '.repeat(width - left.length - right.length)}${right}`;
  const available = Math.max(1, width - right.length - 1);
  return `${left.slice(0, available)} ${right.slice(-Math.min(right.length, width - 1))}`.slice(0, width);
}
function ascii(value: string): Uint8Array { return new TextEncoder().encode(thermalText(value)); }
function combine(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0); const output = new Uint8Array(total); let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; } return output;
}
export function buildTestPrint(): Uint8Array {
  return combine([new Uint8Array([ESC,0x40,ESC,0x61,0x01,ESC,0x45,0x01]), ascii('MUTHOY POS\n'),
    new Uint8Array([ESC,0x45,0x00]), ascii('Printer test successful\n'), ascii('Generic ESC/POS - 32 columns\n'),
    ascii('--------------------------------\n\n\n'), new Uint8Array([GS,0x56,0x41,0x03])]);
}
export function buildMonthlyPnlPrint(shopName: string, report: MonthlyReportSnapshot): Uint8Array {
  const rows = [centerThermal(shopName), centerThermal('MONTHLY PROFIT & LOSS'), centerThermal(report.yearMonth),
    '-'.repeat(WIDTH), thermalColumns('Total sales', paisaToTakaText(report.totals.grossSales)),
    thermalColumns('Discounts', `-${paisaToTakaText(report.totals.discounts)}`),
    ...(report.totals.refunds > 0 ? [thermalColumns('Refunds', `-${paisaToTakaText(report.totals.refunds)}`)] : []),
    thermalColumns('MRP-inclusive net', paisaToTakaText(report.totals.netSales)),
    ...(report.totals.taxCollected > 0 ? [thermalColumns('Included tax', `-${paisaToTakaText(report.totals.taxCollected)}`)]
      : report.totals.taxCollected < 0 ? [thermalColumns('Tax reversed', paisaToTakaText(asPaisa(-report.totals.taxCollected)))] : []),
    thermalColumns('Net sales revenue', paisaToTakaText(report.totals.netRevenue)),
    ...(report.totals.cogs >= 0 ? [thermalColumns('COGS', `-${paisaToTakaText(report.totals.cogs)}`)]
      : [thermalColumns('COGS reversed', paisaToTakaText(asPaisa(-report.totals.cogs)))]),
    thermalColumns('Gross profit', paisaToTakaText(report.totals.grossProfit)),
    thermalColumns('Expenses', `-${paisaToTakaText(report.totals.expenses)}`), '-'.repeat(WIDTH),
    thermalColumns(report.totals.netProfit < 0 ? 'NET LOSS' : 'NET PROFIT', paisaToTakaText(report.totals.netProfit)),
    '', report.totals.isCogsPartial ? 'WARNING: COGS is partial' : '', 'English-only thermal output', '', ''];
  return combine([new Uint8Array([ESC,0x40,ESC,0x61,0x00]), ascii(`${rows.filter(Boolean).join('\n')}\n`), new Uint8Array([GS,0x56,0x41,0x03])]);
}

export function buildEodReportPrint(shopName: string, report: ReportSnapshot): Uint8Array {
  const rows = [centerThermal(shopName), centerThermal('END OF DAY REPORT'), centerThermal(`${report.range.startDate} - ${report.range.endDate}`),
    '-'.repeat(WIDTH), thermalColumns('MRP-inclusive sales', paisaToTakaText(report.totals.netSales)),
    thermalColumns('Transactions', String(report.totals.transactions)), thermalColumns('Cash sales', paisaToTakaText(report.totals.cashSales)),
    thermalColumns('Credit sales', paisaToTakaText(report.totals.creditSales)),
    ...(report.totals.taxCollected > 0 ? [thermalColumns('Included tax', paisaToTakaText(report.totals.taxCollected))]
      : report.totals.taxCollected < 0 ? [thermalColumns('Tax reversed', paisaToTakaText(asPaisa(-report.totals.taxCollected)))] : []),
    ...(report.totals.cogs >= 0 ? [thermalColumns('COGS', paisaToTakaText(report.totals.cogs))]
      : [thermalColumns('COGS reversed', paisaToTakaText(asPaisa(-report.totals.cogs)))]), thermalColumns('Expenses', paisaToTakaText(report.totals.expenses)),
    '-'.repeat(WIDTH), thermalColumns('NET PROFIT', paisaToTakaText(report.totals.netProfit)), '', 'English-only thermal output', '', ''];
  return combine([new Uint8Array([ESC,0x40,ESC,0x61,0x00]), ascii(`${rows.join('\n')}\n`), new Uint8Array([GS,0x56,0x41,0x03])]);
}

export function bytesToBase64(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index] ?? 0; const b = bytes[index + 1] ?? 0; const c = bytes[index + 2] ?? 0;
    output += alphabet.charAt(a >> 2) + alphabet.charAt(((a & 3) << 4) | (b >> 4)) +
      (index + 1 < bytes.length ? alphabet.charAt(((b & 15) << 2) | (c >> 6)) : '=') +
      (index + 2 < bytes.length ? alphabet.charAt(c & 63) : '=');
  }
  return output;
}
