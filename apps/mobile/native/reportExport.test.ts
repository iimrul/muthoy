import * as XLSX from 'xlsx';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExportCell } from '../domain/export';

const fs = vi.hoisted(() => ({ files:new Map<string,number[]>() }));
vi.mock('expo-file-system', () => {
  class Directory { create() {} }
  class File {
    readonly filename: string; readonly uri: string;
    constructor(_directory: unknown, filename: string) { this.filename=filename; this.uri=`file:///cache/${filename}`; }
    get exists() { return fs.files.has(this.filename); }
    get size() { return fs.files.get(this.filename)?.length ?? 0; }
    create() { fs.files.set(this.filename,[]); }
    delete() { fs.files.delete(this.filename); }
    open() {
      const handle = { offset:0,size:0,close:vi.fn(),readBytes:vi.fn(),writeBytes:(chunk: Uint8Array) => {
        const target=fs.files.get(this.filename) ?? [];
        const start=handle.offset;
        for (let index=0;index<chunk.length;index+=1) target[start+index]=chunk[index]!;
        handle.offset=start+chunk.length;handle.size=Math.max(handle.size,handle.offset);fs.files.set(this.filename,target);
      } };
      return handle;
    }
  }
  return { Directory,File,FileMode:{ Truncate:'wt' },Paths:{ cache:'cache' } };
});
vi.mock('expo-sharing', () => ({ isAvailableAsync:vi.fn(async () => true),shareAsync:vi.fn(async () => undefined) }));

const { writeReportExport } = await import('./reportExport');
async function* chunks(...values: ExportCell[][][]): AsyncGenerator<ExportCell[][]> { for (const value of values) yield value; }

beforeEach(() => fs.files.clear());

describe('bounded streaming report files', () => {
  it('writes a genuine XLSX from separate chunks and reports only completed sheets', async () => {
    const progress: number[]=[];
    const file=await writeReportExport('Report','xlsx',[{ name:'Sales',chunks:chunks([['Name','Amount']],[['Napa','10.00']]) }],(done,total) => progress.push(done/total));
    const data=new Uint8Array(fs.files.get(file.filename)!);
    expect(String.fromCharCode(data[0]!,data[1]!)).toBe('PK');
    const workbook=XLSX.read(data,{ type:'array' });
    expect(workbook.SheetNames).toEqual(['Sales']);
    expect(workbook.Sheets.Sales?.A2?.v).toBe('Napa');
    expect(progress).toEqual([1]);
  });

  it('streams CSV chunks with formula neutralization', async () => {
    const file=await writeReportExport('Report','csv',[{ name:'Sales',chunks:chunks([['Name']],[['=BAD']]) }]);
    const data=new Uint8Array(fs.files.get(file.filename)!);
    const text=new TextDecoder().decode(data);
    expect([...data.slice(0,3)]).toEqual([0xef,0xbb,0xbf]);
    expect(text).toContain("'=BAD");
  });
});
