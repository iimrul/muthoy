// @vitest-environment jsdom

import { createElement, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asPaisa } from '@muthoy/types';
import type { ReportSnapshot } from '../db/reports';
import type { Session } from '../state/sessionStore';
import type { ReportSummaryShareRequest } from '../services/reportExport';

interface StubProps { children?:ReactNode;onPress?:()=>void;disabled?:boolean;value?:string;onChangeText?:(value:string)=>void;visible?:boolean;accessibilityLabel?:string; }
vi.mock('react-native', () => ({
  View:({ children }:StubProps)=>createElement('div',null,children),Text:({ children }:StubProps)=>createElement('span',null,children),
  Pressable:({ children,onPress,disabled,accessibilityLabel }:StubProps)=>createElement('button',{ onClick:onPress,disabled,'aria-label':accessibilityLabel },children),
  ScrollView:({ children }:StubProps)=>createElement('div',null,children),Modal:({ children,visible }:StubProps)=>visible?createElement('div',null,children):null,
  TextInput:({ value,onChangeText }:StubProps)=>createElement('input',{ value:value??'',onChange:(event:{target:{value:string}})=>onChangeText?.(event.target.value) }),
  Share:{ share:vi.fn(async()=>undefined) },
}));
vi.mock('@expo/vector-icons/Feather',()=>({ default:({ name }:{name:string})=>createElement('span',null,name) }));
vi.mock('../components/ui/StandardHeader',()=>({ StandardHeader:({ title,rightAccessory }:{title:string;rightAccessory?:ReactNode})=>createElement('header',null,title,rightAccessory) }));
vi.mock('../components/ui/AccessDenied',()=>({ AccessDenied:()=>createElement('div',null,'Denied') }));
vi.mock('../components/reports/ReportCharts',()=>({ TrendChart:()=>createElement('div',null,'trend-chart'),DonutChart:()=>createElement('div',null,'donut-chart'),SixMonthBars:()=>createElement('div',null,'six-month-chart') }));

const state=vi.hoisted(()=>({ locale:'en' as 'en'|'bn',session:null as Session|null,report:vi.fn(),monthly:vi.fn(),export:vi.fn(),shareSummary:vi.fn(),scan:vi.fn(),print:vi.fn(),printer:null as null|{id:string;name:string;pairedAt:string;validatedAt?:string} }));
vi.mock('expo-router',()=>({ router:{ back:vi.fn(),push:vi.fn() },useLocalSearchParams:()=>({}) }));
// Real permission hooks and role rules; only the persisted session input is replaced.
vi.mock('../state/sessionStore',()=>({ useSessionStore:<T,>(selector:(value:{session:Session|null;epoch:number})=>T)=>selector({session:state.session,epoch:0}) }));
vi.mock('../state/sessionGuard',()=>({ captureSessionFor:()=>({ isStale:()=>false,isStillActive:()=>true,ifLive:(action:()=>void)=>action() }) }));
vi.mock('../state/localeStore',()=>({ useI18n:()=>({ locale:state.locale,formatMoney:(value:number)=>`P${value}`,formatNumber:(value:number)=>String(value),formatDateTime:(value:string)=>value,t:(key:string)=>({ categoryUtilities:state.locale==='bn'?'ইউটিলিটি':'Utilities' } as Record<string,string>)[key]??key }) }));
vi.mock('../db/cash',()=>({ currentBusinessDate:()=> '2026-02-10',getEndOfDaySummary:vi.fn(async()=>null),closeDay:vi.fn() }));
vi.mock('../db/customers',()=>({ getCustomerListTotals:vi.fn(async()=>({totalOutstanding:0})) }));
vi.mock('../sync',()=>({ triggerSyncNow:vi.fn() }));
vi.mock('../db/reports',()=>({ getReportSnapshot:state.report,getEndOfDayReportSnapshot:state.report,getMonthlyReport:state.monthly }));
vi.mock('../db/commercial',()=>({
  listOwnerShops:vi.fn(async()=>[]),
  readShopSummaries:vi.fn(async()=>[]),
  // The cross-shop comparison block is entitlement-gated now, so the report
  // screen resolves multi-shop access and a billing account like any other
  // protected read.
  subscribeCommercialCache:vi.fn(()=>()=>undefined),
  readMultiShopContext:vi.fn(async()=>({ entitled:false,primaryShopId:null,liveShopCount:0 })),
  getBillingAccountIdForShop:vi.fn(async()=>null),
}));
vi.mock('../sync/connectivity',()=>({ hasNetworkConnection:vi.fn(async()=>false) }));
vi.mock('../sync/multiShop',()=>({ refreshShopSummaries:vi.fn(async()=>[]) }));
vi.mock('../db/settings',()=>({ getShopName:vi.fn(async()=> 'Shop'),getB2Settings:vi.fn(async()=>({closingHour:23})) }));
vi.mock('../services/reportExport',()=>({ exportAndShareReport:state.export,shareReportSummary:state.shareSummary }));
vi.mock('../native/printer',()=>{
  class PrinterError extends Error { constructor(readonly code:string,message:string){super(message);} }
  return { PrinterError,getPairedPrinter:()=>state.printer,removePairedPrinter:()=>{state.printer=null;},savePairedPrinter:(device:{id:string;name:string})=>(state.printer={...device,pairedAt:'now'}),scanBlePrinters:state.scan,printEscPos:state.print };
});
vi.mock('../domain/escpos',()=>({ buildMonthlyPnlPrint:()=>new Uint8Array([1]),buildTestPrint:()=>new Uint8Array([1]) }));

const ReportScreen=(await import('../app/reports/report')).default;
const MonthlyReportScreen=(await import('../app/reports/monthly-report')).default;
const EndOfDayScreen=(await import('../app/end-of-day')).default;
const DataExportScreen=(await import('../app/reports/data-export')).default;
const PrinterSettingsScreen=(await import('../app/settings/printer-settings')).default;
const { PrinterError }=await import('../native/printer');
const { Share }=await import('react-native');

function fixture(overrides:Partial<ReportSnapshot['totals']>={}):ReportSnapshot {
  return { range:{startDate:'2026-02-10',endDate:'2026-02-10'},previousNetSales:asPaisa(0),changeBp:null,trend:[],topMedicines:[],expensesByCategory:[],totals:{
    grossSales:asPaisa(100),discounts:asPaisa(0),refunds:asPaisa(0),netSales:asPaisa(100),taxCollected:asPaisa(0),netRevenue:asPaisa(100),
    cogs:asPaisa(40),grossProfit:asPaisa(60),expenses:asPaisa(0),netProfit:asPaisa(60),cashSales:asPaisa(100),creditSales:asPaisa(0),
    transactions:1,refundsCount:0,averageSale:asPaisa(100),isCogsPartial:false,missingCogsMedicines:[],...overrides,
  } };
}
function deferred<T>() { let resolve!:(value:T)=>void;let reject!:(error:unknown)=>void;const promise=new Promise<T>((ok,no)=>{resolve=ok;reject=no;});return {promise,resolve,reject}; }

beforeEach(()=>{state.locale='en';state.session={shopId:'shop',userId:'owner',role:'owner'};state.report.mockReset();state.monthly.mockReset();state.export.mockReset();state.shareSummary.mockReset();state.scan.mockReset();state.print.mockReset();state.printer=null;vi.mocked(Share.share).mockClear();});
afterEach(()=>cleanup());

describe('B3 report/export/printer final states',()=>{
  it.each(['manager','staff'] as const)('keeps End of Day view for authorized %s but disables external Share',async(role)=>{
    state.session={shopId:'shop',userId:role,role,permissions:{cash_drawer:true,reports:true}};
    state.report.mockResolvedValue(fixture());
    render(createElement(EndOfDayScreen));await screen.findAllByText('P100');
    const share=screen.getByRole('button',{name:/Share/}) as HTMLButtonElement;
    expect(share.disabled).toBe(true);
    fireEvent.click(share);
    expect(state.shareSummary).not.toHaveBeenCalled();
    expect(Share.share).not.toHaveBeenCalled();
  });

  it('routes Owner End of Day summary through the same authorized share service',async()=>{
    state.report.mockResolvedValue(fixture());
    render(createElement(EndOfDayScreen));await screen.findAllByText('P100');
    fireEvent.click(screen.getByRole('button',{name:/Share/}));
    await waitFor(()=>expect(state.shareSummary).toHaveBeenCalledTimes(1));
    const request=state.shareSummary.mock.calls[0]![0] as ReportSummaryShareRequest;
    expect(request).toMatchObject({shopId:'shop',actorUserId:'owner'});
    expect(request.formatSummary(fixture())).toBe('Sales Report 2026-02-10 — 2026-02-10\nTotal Sales: P100\nTransactions: 1\nNet Profit: P60');
    expect(Share.share).not.toHaveBeenCalled();
  });

  it.each(['manager','staff'] as const)('lets reports-capable %s view reports with no Download or Share',async(role)=>{
    state.session={shopId:'shop',userId:role,role,permissions:{reports:true}};
    state.report.mockResolvedValue(fixture());
    render(createElement(ReportScreen));
    expect((await screen.findAllByText('P100')).length).toBeGreaterThan(0);
    expect(state.report).toHaveBeenCalledWith('shop',role,expect.anything());
    expect(screen.queryByRole('button',{name:'Download'})).toBeNull();
    expect(screen.queryByRole('button',{name:'Share'})).toBeNull();
    expect(state.export).not.toHaveBeenCalled();
    expect(state.shareSummary).not.toHaveBeenCalled();
    expect(Share.share).not.toHaveBeenCalled();
  });

  it.each(['manager','staff'] as const)('lets reports-capable %s view monthly P&L with no CSV or Excel',async(role)=>{
    state.session={shopId:'shop',userId:role,role,permissions:{reports:true}};
    state.monthly.mockResolvedValue({...fixture(),yearMonth:'2026-02',sixMonthTrend:[]});
    render(createElement(MonthlyReportScreen));
    expect((await screen.findAllByText('P60')).length).toBeGreaterThan(0);
    expect(state.monthly).toHaveBeenCalledWith('shop',role,expect.anything());
    expect(screen.queryByRole('button',{name:/CSV/})).toBeNull();
    expect(screen.queryByRole('button',{name:/Excel/})).toBeNull();
    expect(state.export).not.toHaveBeenCalled();
    expect(Share.share).not.toHaveBeenCalled();
  });

  it('routes Owner summary Share through the service and preserves its text',async()=>{
    state.report.mockResolvedValue(fixture());
    render(createElement(ReportScreen));await screen.findAllByText('P100');
    fireEvent.click(screen.getByRole('button',{name:'Share'}));
    await waitFor(()=>expect(state.shareSummary).toHaveBeenCalledTimes(1));
    const request=state.shareSummary.mock.calls[0]![0] as ReportSummaryShareRequest;
    expect(request).toMatchObject({shopId:'shop',actorUserId:'owner',range:{startDate:'2026-02-10',endDate:'2026-02-10'}});
    expect(request.formatSummary(fixture())).toBe('Sales Report (2026-02-10 — 2026-02-10)\nTotal Sales: P100\nTransactions: 1\nNet Profit: P60');
    expect(Share.share).not.toHaveBeenCalled();
  });

  it('shows a service denial for an Owner-looking session without native sharing',async()=>{
    state.report.mockResolvedValue(fixture());
    state.shareSummary.mockRejectedValue(new Error('Owner access only'));
    render(createElement(ReportScreen));await screen.findAllByText('P100');
    fireEvent.click(screen.getByRole('button',{name:'Share'}));
    expect(await screen.findByText('Owner access only')).toBeTruthy();
    expect(Share.share).not.toHaveBeenCalled();
  });

  it('keeps Owner Download routed to CSV export',async()=>{
    state.report.mockResolvedValue(fixture());
    render(createElement(ReportScreen));await screen.findAllByText('P100');
    fireEvent.click(screen.getByRole('button',{name:'Download'}));
    await waitFor(()=>expect(state.export).toHaveBeenCalledWith(expect.objectContaining({shopId:'shop',actorUserId:'owner',format:'csv'})));
  });

  it.each([['CSV','csv'],['Excel','xlsx']])('keeps Owner monthly %s export',async(label,format)=>{
    state.monthly.mockResolvedValue({...fixture(),yearMonth:'2026-02',sixMonthTrend:[]});
    render(createElement(MonthlyReportScreen));await screen.findAllByText('P60');
    fireEvent.click(screen.getByRole('button',{name:new RegExp(label)}));
    await waitFor(()=>expect(state.export).toHaveBeenCalledWith(expect.objectContaining({shopId:'shop',actorUserId:'owner',format,monthly:'2026-02'})));
  });

  it('clears prior totals immediately when a report preset changes',async()=>{
    const next=deferred<ReportSnapshot>();state.report.mockResolvedValueOnce(fixture()).mockReturnValueOnce(next.promise);
    render(createElement(ReportScreen));await screen.findAllByText('P100');
    fireEvent.click(screen.getByText('Week'));
    expect(screen.queryAllByText('P100')).toHaveLength(0);expect(screen.getByText('Building report…')).toBeTruthy();
    await act(async()=>next.resolve(fixture({ netSales:asPaisa(200) })));
    expect(await screen.findAllByText('P200')).toHaveLength(2);
  });

  it('renders a refund-only monthly P&L with negative tax reversal',async()=>{
    state.locale='bn';state.monthly.mockResolvedValue({ ...fixture({ grossSales:asPaisa(0),refunds:asPaisa(110),netSales:asPaisa(-110),taxCollected:asPaisa(-10),netRevenue:asPaisa(-100),cogs:asPaisa(-50),grossProfit:asPaisa(-50),expenses:asPaisa(0),netProfit:asPaisa(-50),cashSales:asPaisa(-110),transactions:0,refundsCount:1,averageSale:asPaisa(0) }),yearMonth:'2026-02',sixMonthTrend:[],expensesByCategory:[] });
    render(createElement(MonthlyReportScreen));
    expect(await screen.findByText(/ফেরত ট্যাক্স/)).toBeTruthy();
    expect(screen.queryByText('এই মাসে কোনো আর্থিক কার্যক্রম নেই')).toBeNull();
  });

  it('renders an expense-only month with localized category and prior-month delta',async()=>{
    state.locale='bn';state.monthly.mockResolvedValue({ ...fixture({ grossSales:asPaisa(0),refunds:asPaisa(0),netSales:asPaisa(0),taxCollected:asPaisa(0),netRevenue:asPaisa(0),cogs:asPaisa(0),grossProfit:asPaisa(0),expenses:asPaisa(20),netProfit:asPaisa(-20),cashSales:asPaisa(0),transactions:0,refundsCount:0,averageSale:asPaisa(0) }),yearMonth:'2026-02',sixMonthTrend:[],expensesByCategory:[{category:'utilities',amount:asPaisa(20),previousAmount:asPaisa(10)}] });
    render(createElement(MonthlyReportScreen));
    expect((await screen.findAllByText('ইউটিলিটি')).length).toBeGreaterThan(0);expect(screen.getByText(/গত মাস: P10/)).toBeTruthy();
    expect(screen.queryByText('এই মাসে কোনো আর্থিক কার্যক্রম নেই')).toBeNull();
  });

  it('shows only real export progress, then the real write error',async()=>{
    const pending=deferred<{uri:string;filename:string;size:number}>();
    state.export.mockImplementation(({onProgress}:{onProgress?:(value:number)=>void})=>{onProgress?.(50);return pending.promise;});
    render(createElement(DataExportScreen));fireEvent.click(screen.getByText('Export & Share'));
    expect(await screen.findByText('50%')).toBeTruthy();
    await act(async()=>pending.reject(new Error('disk full')));
    expect(await screen.findByText('disk full')).toBeTruthy();expect(screen.queryByText(/Export ready/)).toBeNull();
  });

  it('renders printer disconnect and retries the real scan action',async()=>{
    state.scan.mockRejectedValueOnce(new PrinterError('disconnected','lost')).mockResolvedValueOnce([]);
    render(createElement(PrinterSettingsScreen));fireEvent.click(screen.getByText('Select'));
    expect(await screen.findByText('Printer disconnected')).toBeTruthy();
    fireEvent.click(screen.getByText('Retry'));await waitFor(()=>expect(state.scan).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('No BLE printers found')).toBeTruthy();
  });
});
