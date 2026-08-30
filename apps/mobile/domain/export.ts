import type { Paisa } from '@muthoy/types';

export type ExportCell = string | number;
export interface ExportSheet { name: string; rows: ExportCell[][]; }

export function paisaToTakaText(value: Paisa): string {
  const sign = value < 0 ? '-' : '';
  const absolute = Math.abs(value);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
}

export function escapeCsvCell(value: ExportCell): string {
  const raw = String(value);
  const dangerous = /^\s*[=+@]/.test(raw) || (/^\s*-/.test(raw) && !/^\s*-\d+(?:\.\d+)?\s*$/.test(raw));
  const text = dangerous ? `'${raw}` : raw;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** UTF-8 BOM keeps Bangla and the taka symbol intact in desktop Excel. */
export function buildCsv(sheets: readonly ExportSheet[]): string {
  const lines: string[] = ['\uFEFF'];
  sheets.forEach((sheet, index) => {
    if (index > 0) lines.push('');
    if (sheets.length > 1) lines.push(escapeCsvCell(`[${sheet.name}]`));
    for (const row of sheet.rows) lines.push(row.map(escapeCsvCell).join(','));
  });
  return lines.join('\r\n');
}

export function safeExportFilename(value: string): string {
  const safe = value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return safe || 'muthoy-export';
}
