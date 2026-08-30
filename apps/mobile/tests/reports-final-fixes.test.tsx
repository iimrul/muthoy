// @vitest-environment jsdom

import { createElement, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asPaisa } from '@muthoy/types';
import type { ReportSnapshot } from '../db/reports';

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

const state=vi.hoisted(()=>({ locale:'en' as 'en'|'bn',report:vi.fn(),monthly:vi.fn(),export:vi.fn(),scan:vi.fn(),print:vi.fn(),printer:null as null|{id:string;name:string;pairedAt:string;validatedAt?:string} }));
const session={ shopId:'shop',userId:'owner',role:'owner' as const,permissions:undefined };
vi.mock('expo-router',()=>({ router:{ back:vi.fn(),push:vi.fn() },useLocalSearchParams:()=>({}) }));
vi.mock('../state/usePermission',()=>({ usePermission:()=>({ session,isAllowed:true }),useOwnerAccess:()=>({ session,isAllowed:true }) }));
vi.mock('../state/sessionGuard',()=>({ captureSessionFor:()=>({ isStale:()=>false,isStillActive:()=>true,ifLive:(action:()=>void)=>action() }) }));
vi.mock('../state/localeStore',()=>({ useI18n:()=>({ locale:state.locale,formatMoney:(value:number)=>`P${value}`,formatNumber:(value:number)=>String(value),formatDateTime:(value:string)=>value,t:(key:string)=>({ categoryUtilities:state.locale==='bn'?'ইউটিলিটি':'Utilities' } as Record<string,string>)[key]??key }) }));
vi.mock('../db/cash',()=>({ currentBusinessDate:()=> '2026-02-10' }));
vi.mock('../db/reports',()=>({ getReportSnapshot:state.report,getMonthlyReport:state.monthly }));
vi.mock('../db/settings',()=>({ getShopName:vi.fn(async()=> 'Shop') }));
vi.mock('../services/reportExport',()=>({ exportAndShareReport:state.export }));
vi.mock('../native/printer',()=>{
  class PrinterError extends Error { constructor(readonly code:string,message:string){super(message);} }
  return { PrinterError,getPairedPrinter:()=>state.printer,removePairedPrinter:()=>{state.printer=null;},savePairedPrinter:(device:{id:string;name:string})=>(state.printer={...device,pairedAt:'now'}),scanBlePrinters:state.scan,printEscPos:state.print };
});
vi.mock('../domain/escpos',()=>({ buildMonthlyPnlPrint:()=>new Uint8Array([1]),buildTestPrint:()=>new Uint8Array([1]) }));

const ReportScreen=(await import('../app/reports/report')).default;
const MonthlyReportScreen=(await import('../app/reports/monthly-report')).default;
const DataExportScreen=(await import('../app/reports/data-export')).default;
const PrinterSettingsScreen=(await import('../app/settings/printer-settings')).default;
const { PrinterError }=await import('../native/printer');

function fixture(overrides:Partial<ReportSnapshot['totals']>={}):ReportSnapshot {
  return { range:{startDate:'2026-02-10',endDate:'2026-02-10'},previousNetSales:asPaisa(0),changeBp:null,trend:[],topMedicines:[],expensesByCategory:[],totals:{
    grossSales:asPaisa(100),discounts:asPaisa(0),refunds:asPaisa(0),netSales:asPaisa(100),taxCollected:asPaisa(0),netRevenue:asPaisa(100),
    cogs:asPaisa(40),grossProfit:asPaisa(60),expenses:asPaisa(0),netProfit:asPaisa(60),cashSales:asPaisa(100),creditSales:asPaisa(0),
    transactions:1,refundsCount:0,averageSale:asPaisa(100),isCogsPartial:false,missingCogsMedicines:[],...overrides,
  } };
}
function deferred<T>() { let resolve!:(value:T)=>void;let reject!:(error:unknown)=>void;const promise=new Promise<T>((ok,no)=>{resolve=ok;reject=no;});return {promise,resolve,reject}; }

beforeEach(()=>{state.locale='en';state.report.mockReset();state.monthly.mockReset();state.export.mockReset();state.scan.mockReset();state.print.mockReset();state.printer=null;});
afterEach(()=>cleanup());

describe('B3 report/export/printer final states',()=>{
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
