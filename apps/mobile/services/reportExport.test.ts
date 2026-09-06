import { asPaisa } from '@muthoy/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExportCell } from '../domain/export';
import { NotAuthorizedError } from '../db/errors';

const mocks=vi.hoisted(()=>({ saleRows:vi.fn(),refundRows:vi.fn(),expenseRows:vi.fn(),inventoryRows:vi.fn(),creditRows:vi.fn(),report:vi.fn(),monthly:vi.fn(),write:vi.fn(),share:vi.fn(),requireOwner:vi.fn(),premium:vi.fn(),shopName:vi.fn(),progress:vi.fn(),textShare:vi.fn(),formatSummary:vi.fn() }));
vi.mock('../db/reports',()=>({ getReportSaleRows:mocks.saleRows,getReportRefundRows:mocks.refundRows,getReportExpenseRows:mocks.expenseRows,getInventoryExportRows:mocks.inventoryRows,getCreditExportRows:mocks.creditRows,getReportSnapshot:mocks.report,getMonthlyReport:mocks.monthly }));
vi.mock('../db/settings',()=>({ getShopName:mocks.shopName }));
vi.mock('../db/auth',()=>({ requireOwner:mocks.requireOwner }));
vi.mock('../db/commercial',()=>({ requirePremiumFeature:mocks.premium }));
vi.mock('../native/reportExport',()=>({ writeReportExport:mocks.write,shareWrittenExport:mocks.share }));
vi.mock('react-native',()=>({ Share:{ share:mocks.textShare } }));

const { PlanAccessError }=await vi.importActual<typeof import('../db/commercial')>('../db/commercial');
const { buildReportExport,exportAndShareReport,shareReportSummary }=await import('./reportExport');
const totals={ grossSales:asPaisa(0),discounts:asPaisa(0),refunds:asPaisa(11_000),netSales:asPaisa(-11_000),taxCollected:asPaisa(-1_000),netRevenue:asPaisa(-10_000),cogs:asPaisa(-6_000),grossProfit:asPaisa(-4_000),expenses:asPaisa(0),netProfit:asPaisa(-4_000),cashSales:asPaisa(-11_000),creditSales:asPaisa(0),transactions:0,refundsCount:1,averageSale:asPaisa(0),isCogsPartial:false,missingCogsMedicines:[] };

beforeEach(()=>{
  for(const mock of Object.values(mocks)) mock.mockReset();
  mocks.requireOwner.mockResolvedValue(undefined);
  mocks.premium.mockResolvedValue(undefined);
  mocks.shopName.mockResolvedValue('Shop');
  mocks.formatSummary.mockReturnValue('Report summary');
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

// H-1. The Owner check used to live only on the /reports/data-export route, so
// a caller reaching this service directly — or arriving from the two report
// screens, which are gated by the `reports` permission and not by Owner — could
// export sales, refunds and expenses without being the Owner. These assert the
// guard where it now lives: at the service, before any read, write, or share.
const DATASETS=['sales','inventory','credit','expenses'] as const;
const RANGE={startDate:'2026-02-01',endDate:'2026-02-28'};
const request=(over:Partial<Parameters<typeof buildReportExport>[0]>={})=>({ shopId:'shop',actorUserId:'manager',range:RANGE,datasets:['sales'] as const,format:'csv' as const,onProgress:mocks.progress,...over });
const READS=['saleRows','refundRows','expenseRows','inventoryRows','creditRows','report','monthly','shopName'] as const;

/** Nothing was read, no file was written, and nothing reached the share sheet. */
function expectNoExportProduced():void{
  for(const read of READS) expect(mocks[read],`${read} must not run before authorization`).not.toHaveBeenCalled();
  expect(mocks.write).not.toHaveBeenCalled();
  expect(mocks.share).not.toHaveBeenCalled();
  expect(mocks.textShare).not.toHaveBeenCalled();
  expect(mocks.formatSummary).not.toHaveBeenCalled();
  expect(mocks.progress).not.toHaveBeenCalled();
}

describe('export authorization',()=>{
  it.each(DATASETS)('refuses a `reports`-permitted non-Owner the %s dataset',async(dataset)=>{
    mocks.requireOwner.mockRejectedValue(new NotAuthorizedError());
    await expect(buildReportExport(request({datasets:[dataset]}))).rejects.toBeInstanceOf(NotAuthorizedError);
    expect(mocks.requireOwner).toHaveBeenCalledWith('shop','manager');
    expectNoExportProduced();
  });

  it('refuses a non-Owner the monthly P&L export',async()=>{
    mocks.requireOwner.mockRejectedValue(new NotAuthorizedError());
    await expect(buildReportExport(request({monthly:'2026-02'}))).rejects.toBeInstanceOf(NotAuthorizedError);
    expectNoExportProduced();
  });

  it('refuses a non-Owner before exportAndShareReport can share anything',async()=>{
    mocks.requireOwner.mockRejectedValue(new NotAuthorizedError());
    await expect(exportAndShareReport(request())).rejects.toBeInstanceOf(NotAuthorizedError);
    expectNoExportProduced();
  });

  // Identity is checked before entitlement: a Manager on a Free plan is told
  // they are not the Owner, not that they should upgrade.
  it('checks Owner identity before the plan entitlement',async()=>{
    mocks.requireOwner.mockRejectedValue(new NotAuthorizedError());
    await expect(buildReportExport(request())).rejects.toBeInstanceOf(NotAuthorizedError);
    expect(mocks.premium).not.toHaveBeenCalled();
    expectNoExportProduced();
  });

  it.each([['',''],['shop',''],['','owner']])('refuses a missing session (shop %j, actor %j)',async(shopId,actorUserId)=>{
    await expect(buildReportExport(request({shopId,actorUserId}))).rejects.toBeInstanceOf(NotAuthorizedError);
    expect(mocks.requireOwner).not.toHaveBeenCalled();
    expect(mocks.premium).not.toHaveBeenCalled();
    expectNoExportProduced();
  });

  it('still refuses an Owner whose plan does not include export',async()=>{
    mocks.premium.mockRejectedValue(new PlanAccessError('export'));
    await expect(buildReportExport(request({actorUserId:'owner'}))).rejects.toBeInstanceOf(PlanAccessError);
    expect(mocks.requireOwner).toHaveBeenCalledWith('shop','owner');
    expect(mocks.premium).toHaveBeenCalledWith('shop','export');
    expectNoExportProduced();
  });

  it('lets an entitled Owner export every dataset',async()=>{
    for(const read of READS) mocks[read].mockResolvedValue([]);
    mocks.report.mockResolvedValue({ range:RANGE,totals,previousNetSales:asPaisa(0),changeBp:null,trend:[],topMedicines:[],expensesByCategory:[] });
    mocks.write.mockImplementation(async(_stem:string,_format:string,sheets:{chunks:AsyncIterable<ExportCell[][]>}[])=>{
      for(const sheet of sheets) for await(const chunk of sheet.chunks) void chunk;
      return {uri:'file:///report.csv',filename:'report.csv',size:1};
    });
    const file=await buildReportExport(request({actorUserId:'owner',datasets:DATASETS}));
    expect(file.filename).toBe('report.csv');
    expect(mocks.requireOwner).toHaveBeenCalledWith('shop','owner');
    expect(mocks.write).toHaveBeenCalledTimes(1);
  });
});

describe('summary sharing and authorization order',()=>{
  it.each(['requireOwner','premium'] as const)('waits for %s before any summary read, generation, or native Share.share',async(gate)=>{
    let allow!:()=>void;
    mocks[gate].mockReturnValue(new Promise<void>((resolve)=>{allow=resolve;}));
    const pending=shareReportSummary({...request({actorUserId:'owner'}),formatSummary:mocks.formatSummary});
    await Promise.resolve(); await Promise.resolve();
    expectNoExportProduced();
    allow(); await pending;
    expect(mocks.textShare).toHaveBeenCalledWith({message:'Report summary'});
  });

  it.each(['requireOwner','premium'] as const)('waits for %s before any file export read or generation',async(gate)=>{
    let allow!:()=>void;
    mocks[gate].mockReturnValue(new Promise<void>((resolve)=>{allow=resolve;}));
    const pending=buildReportExport(request({actorUserId:'owner'}));
    await Promise.resolve(); await Promise.resolve();
    expectNoExportProduced();
    allow(); await pending;
    expect(mocks.write).toHaveBeenCalledTimes(1);
  });

  it('denies summary sharing before formatting or Share.share',async()=>{
    mocks.requireOwner.mockRejectedValue(new NotAuthorizedError());
    await expect(shareReportSummary({...request(),formatSummary:mocks.formatSummary})).rejects.toBeInstanceOf(NotAuthorizedError);
    expect(mocks.premium).not.toHaveBeenCalled();
    expectNoExportProduced();
  });

  it('does not share when summary formatting fails',async()=>{
    mocks.formatSummary.mockImplementation(()=>{throw new Error('format failed');});
    await expect(shareReportSummary({...request({actorUserId:'owner'}),formatSummary:mocks.formatSummary})).rejects.toThrow('format failed');
    expect(mocks.textShare).not.toHaveBeenCalled();
  });
});
