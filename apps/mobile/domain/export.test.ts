import { describe, expect, it } from 'vitest';
import { asPaisa } from '@muthoy/types';
import { buildCsv, escapeCsvCell, paisaToTakaText, safeExportFilename, type ExportSheet } from './export';

describe('report export formats', () => {
  const sheets: ExportSheet[] = [{ name: 'Sales', rows: [['Name', 'Amount'], ['ওষুধ, "A"', '110.05']] }];

  it('emits Excel-compatible UTF-8 BOM CSV with correct escaping', () => {
    const csv = buildCsv(sheets);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('"ওষুধ, ""A""",110.05');
    expect(escapeCsvCell('=HYPERLINK("bad")')).toBe('"\'=HYPERLINK(""bad"")"');
    expect(escapeCsvCell('@SUM(A1:A2)')).toBe("'@SUM(A1:A2)");
    expect(escapeCsvCell('\r\n=HYPERLINK("bad")')).toBe('"\'\r\n=HYPERLINK(""bad"")"');
    expect(escapeCsvCell('-12.50')).toBe('-12.50');
    expect(paisaToTakaText(asPaisa(-1))).toBe('-0.01');
    expect(paisaToTakaText(asPaisa(12_345))).toBe('123.45');
    expect(safeExportFilename('P&L Jan 2026')).toBe('p-l-jan-2026');
  });
});
