import { asPaisa } from '@muthoy/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExportCell } from '../domain/export';

const mocks=vi.hoisted(()=>({ saleRows:vi.fn(),refundRows:vi.fn(),expenseRows:vi.fn(),inventoryRows:vi.fn(),creditRows:vi.fn(),report:vi.fn(),monthly:vi.fn(),write:vi.fn() }));
vi.mock('../db/reports',()=>({ getReportSaleRows:mocks.saleRows,getReportRefundRows:mocks.refundRows,getReportExpenseRows:mocks.expenseRows,getInventoryExportRows:mocks.inventoryRows,getCreditExportRows:mocks.creditRows,getReportSnapshot:mocks.report,getMonthlyReport:mocks.monthly }));
vi.mock('../db/settings',()=>({ getShopName:vi.fn(async()=> 'Shop') }));
vi.mock('../native/reportExport',()=>({ writeReportExport:mocks.write,shareWrittenExport:vi.fn(), }));

const { buildReportExport }=await import('./reportExport');
const totals={ grossSales:asPaisa(0),discounts:asPaisa(0),refunds:asPaisa(11_000),netSales:asPaisa(-11_000),taxCollected:asPaisa(-1_000),netRevenue:asPaisa(-10_000),cogs:asPaisa(-6_000),grossProfit:asPaisa(-4_000),expenses:asPaisa(0),netProfit:asPaisa(-4_000),cashSales:asPaisa(-11_000),creditSales:asPaisa(0),transactions:0,refundsCount:1,averageSale:asPaisa(0),isCogsPartial:false,missingCogsMedicines:[] };

beforeEach(()=>{
  for(const mock of Object.values(mocks)) mock.mockReset();
  mocks.report.mockResolvedValue({ range:{startDate:'2026-02-01',endDate:'2026-02-28'},totals,previousNetSales:asPaisa(0),changeBp:null,trend:[],topMedicines:[],expensesByCategory:[] });
  mocks.saleRows.mockResolvedValue([{ invoiceNo:'INV-1',businessDate:'2026-02-01',createdAt:'2026-02-01T12:00:00.000Z',subtotal:asPaisa(11_000),discount:asPaisa(0),tax:asPaisa(1_000),taxRateBp:1_000,taxLabel:'GST',total:asPaisa(11_000),paymentType:'cash',cash:asPaisa(11_000),credit:asPaisa(0),items:'Napa (1)' }]);
  mocks.refundRows.mockResolvedValue([]);
});

describe('report export fidelity',()=>{
  it('streams Dhaka time and original mixed-tax snapshot fields with completed-sheet progress',async()=>{
    const collected:Record<string,ExportCell[][]>={};
    mocks.write.mockImplementation(async(_stem:string,_format:string,sheets:{name:string;chunks:AsyncIterable<ExportCell[][]>}[],complete:(done:number,total:number)=>void)=>{
      for(let index=0;index<sheets.length;index+=1){const rows:ExportCell[][]=[];for await(const chunk of sheets[index]!.chunks) rows.push(...chunk);collected[sheets[index]!.name]=rows;complete(index+1,sheets.length);}
      return {uri:'file:///report.xlsx',filename:'report.xlsx',size:10};
    });
    const progress:number[]=[];
    await buildReportExport({shopId:'shop',actorUserId:'owner',range:{startDate:'2026-02-01',endDate:'2026-02-28'},datasets:['sales'],format:'xlsx',onProgress:(value)=>progress.push(value)});
    expect(collected.Summary).toContainEqual(['Tax/VAT Reversed','10.00']);
    expect(collected.Sales?.[1]).toEqual(['2026-02-01','18:00:00','INV-1','110.00','0.00','10.00','10%','GST','110.00','cash','110.00','0.00','Napa (1)']);
    expect(progress.at(-1)).toBe(100);
    expect(progress).toHaveLength(3);
  });
});
