import { Directory, File, FileMode, Paths, type FileHandle } from 'expo-file-system';
import { escapeCsvCell, safeExportFilename, type ExportCell } from '../domain/export';

export type ExportFormat = 'csv' | 'xlsx';
export interface WrittenExport { uri: string; filename: string; size: number; }
export interface ExportSheetStream { name: string; chunks: AsyncIterable<readonly ExportCell[][]>; }

const encoder = new TextEncoder();
const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const bytes = (value: string) => encoder.encode(value);
function concat(parts: readonly Uint8Array[]): Uint8Array {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(size); let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}
function u16(value: number): Uint8Array { return new Uint8Array([value & 255, value >>> 8 & 255]); }
function u32(value: number): Uint8Array { return new Uint8Array([value & 255, value >>> 8 & 255, value >>> 16 & 255, value >>> 24 & 255]); }

const CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1;
  CRC_TABLE[index] = value >>> 0;
}
function updateCrc(crc: number, data: Uint8Array): number {
  let next = crc;
  for (const value of data) next = (CRC_TABLE[(next ^ value) & 255]! ^ next >>> 8) >>> 0;
  return next;
}

interface ZipEntry { name: Uint8Array; crc: number; size: number; offset: number; }
class StreamingZip {
  private readonly entries: ZipEntry[] = [];
  private current: { name: Uint8Array; crc: number; size: number; offset: number } | null = null;
  private position = 0;
  constructor(private readonly handle: FileHandle) {}
  private write(data: Uint8Array): void { this.handle.writeBytes(data); this.position += data.length; }
  start(name: string): void {
    if (this.current) throw new Error('ZIP entry already open');
    const encoded = bytes(name); const offset = this.position;
    this.write(concat([u32(0x04034b50),u16(20),u16(0x0800),u16(0),u16(0),u16(0x21),u32(0),u32(0),u32(0),u16(encoded.length),u16(0),encoded]));
    this.current = { name: encoded, crc: 0xffffffff, size: 0, offset };
  }
  data(data: Uint8Array): void {
    if (!this.current) throw new Error('No ZIP entry open');
    this.write(data); this.current.crc = updateCrc(this.current.crc, data); this.current.size += data.length;
    if (this.current.size > 0xffffffff) throw new Error('Export entry exceeds ZIP32 limit');
  }
  end(): void {
    if (!this.current) throw new Error('No ZIP entry open');
    const entry = { ...this.current, crc: (this.current.crc ^ 0xffffffff) >>> 0 };
    const endOffset = this.position;
    this.handle.offset = entry.offset + 14;
    this.handle.writeBytes(concat([u32(entry.crc),u32(entry.size),u32(entry.size)]));
    this.handle.offset = endOffset;
    this.entries.push(entry); this.current = null;
  }
  finish(): void {
    if (this.current) this.end();
    const centralOffset = this.position;
    for (const entry of this.entries) {
      this.write(concat([u32(0x02014b50),u16(20),u16(20),u16(0x0800),u16(0),u16(0),u16(0x21),u32(entry.crc),u32(entry.size),u32(entry.size),u16(entry.name.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(entry.offset),entry.name]));
    }
    const centralSize = this.position - centralOffset;
    this.write(concat([u32(0x06054b50),u16(0),u16(0),u16(this.entries.length),u16(this.entries.length),u32(centralSize),u32(centralOffset),u16(0)]));
  }
}

function xml(value: string): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
}
function columnName(index: number): string {
  let value = index + 1; let output = '';
  while (value > 0) { const remainder = (value - 1) % 26; output = String.fromCharCode(65 + remainder) + output; value = Math.floor((value - 1) / 26); }
  return output;
}
function worksheetRows(rows: readonly ExportCell[][], firstRow: number): string {
  return rows.map((row, rowOffset) => {
    const number = firstRow + rowOffset;
    const cells = row.map((cell, column) => {
      const ref = `${columnName(column)}${number}`;
      return typeof cell === 'number' && Number.isFinite(cell)
        ? `<c r="${ref}"><v>${cell}</v></c>`
        : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(String(cell))}</t></is></c>`;
    }).join('');
    return `<row r="${number}">${cells}</row>`;
  }).join('');
}
function sheetNames(sheets: readonly ExportSheetStream[]): string[] {
  const used = new Set<string>();
  return sheets.map((sheet, index) => {
    const base = sheet.name.replace(/[\\/?*:[\]]/g, '-').slice(0, 31) || `Sheet${index + 1}`;
    let name = base; let suffix = 2;
    while (used.has(name)) { const tail = `-${suffix++}`; name = `${base.slice(0, 31 - tail.length)}${tail}`; }
    used.add(name); return name;
  });
}
async function writeEntry(zip: StreamingZip, name: string, content: string): Promise<void> {
  zip.start(name); zip.data(bytes(content)); zip.end(); await yieldToUi();
}
async function writeXlsx(handle: FileHandle, sheets: readonly ExportSheetStream[], onSheetComplete?: (completed: number, total: number) => void): Promise<void> {
  const names = sheetNames(sheets); const zip = new StreamingZip(handle);
  const overrides = names.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('');
  await writeEntry(zip,'[Content_Types].xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${overrides}</Types>`);
  await writeEntry(zip,'_rels/.rels','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  await writeEntry(zip,'xl/workbook.xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((name,index) => `<sheet name="${xml(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets></workbook>`);
  await writeEntry(zip,'xl/_rels/workbook.xml.rels',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((_,index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}</Relationships>`);
  for (let sheetIndex = 0; sheetIndex < sheets.length; sheetIndex += 1) {
    const sheet = sheets[sheetIndex]!; zip.start(`xl/worksheets/sheet${sheetIndex + 1}.xml`);
    zip.data(bytes('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'));
    let rowNumber = 1;
    for await (const chunk of sheet.chunks) {
      for (let offset = 0; offset < chunk.length; offset += 50) {
        const slice = chunk.slice(offset, offset + 50); zip.data(bytes(worksheetRows(slice, rowNumber))); rowNumber += slice.length;
        await yieldToUi();
      }
    }
    zip.data(bytes('</sheetData></worksheet>')); zip.end(); onSheetComplete?.(sheetIndex + 1, sheets.length); await yieldToUi();
  }
  zip.finish();
}
async function writeCsv(handle: FileHandle, sheets: readonly ExportSheetStream[], onSheetComplete?: (completed: number, total: number) => void): Promise<void> {
  handle.writeBytes(bytes('\uFEFF'));
  for (let sheetIndex = 0; sheetIndex < sheets.length; sheetIndex += 1) {
    const sheet = sheets[sheetIndex]!;
    if (sheetIndex > 0) handle.writeBytes(bytes('\r\n'));
    if (sheets.length > 1) handle.writeBytes(bytes(`${escapeCsvCell(`[${sheet.name}]`)}\r\n`));
    for await (const chunk of sheet.chunks) {
      for (let offset = 0; offset < chunk.length; offset += 50) {
        const lines = chunk.slice(offset, offset + 50).map((row) => row.map(escapeCsvCell).join(',')).join('\r\n');
        if (lines) handle.writeBytes(bytes(`${lines}\r\n`));
        await yieldToUi();
      }
    }
    onSheetComplete?.(sheetIndex + 1, sheets.length);
  }
}

export async function writeReportExport(filenameStem: string, format: ExportFormat, sheets: readonly ExportSheetStream[], onSheetComplete?: (completed: number, total: number) => void): Promise<WrittenExport> {
  if (sheets.length === 0) throw new Error('No export data selected');
  const directory = new Directory(Paths.cache, 'exports'); directory.create({ intermediates: true, idempotent: true });
  const filename = `${safeExportFilename(filenameStem)}.${format}`; const file = new File(directory, filename);
  if (file.exists) file.delete(); file.create({ intermediates: true, overwrite: true });
  const handle = file.open(FileMode.Truncate);
  try { if (format === 'csv') await writeCsv(handle, sheets, onSheetComplete); else await writeXlsx(handle, sheets, onSheetComplete); }
  catch (error) { handle.close(); if (file.exists) file.delete(); throw error; }
  handle.close();
  if (!file.exists || file.size <= 0) throw new Error('Export file could not be written');
  return { uri: file.uri, filename, size: file.size };
}

export async function shareWrittenExport(file: WrittenExport): Promise<void> {
  const Sharing = await import('expo-sharing');
  if (!await Sharing.isAvailableAsync()) throw new Error('File sharing is unavailable on this device');
  await Sharing.shareAsync(file.uri, { dialogTitle: 'Muthoy Data Export', mimeType: file.filename.endsWith('.xlsx') ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv', UTI: file.filename.endsWith('.xlsx') ? 'org.openxmlformats.spreadsheetml.sheet' : 'public.comma-separated-values-text' });
}
