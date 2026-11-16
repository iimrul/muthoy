// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { sqlite } from "../db/test/expo-sqlite";
import type { Paisa } from "@muthoy/types";
import type { Session } from "../state/sessionStore";

vi.mock("react-native", async () => (await import("./support/reactNativeMock")).createReactNativeMock());
vi.mock("expo-router", async () => ({
  router: {push:vi.fn(),back:vi.fn(),replace:vi.fn()},
  useFocusEffect: (callback:()=>void|(()=>void)) => { const {useEffect}=awaitImport; useEffect(callback,[callback]); },
}));
// Keep hook identity and all business reads/writes real; only navigation/native
// boundaries are replaced. Import React outside the hoisted factory via importActual.
const awaitImport = await import("react");
vi.mock("../sync",()=>({triggerSyncNow:vi.fn(),subscribeToSyncCompletion:()=>()=>undefined}));
const cashDb=await import("../db/cash");
const openingWriter=vi.spyOn(cashDb,"setOpeningCash");
const withdrawalWriter=vi.spyOn(cashDb,"recordWithdrawal");
const reconcileWriter=vi.spyOn(cashDb,"reconcileCashDrawer");
const { OpeningCashModal }=await import("../components/cash/OpeningCashModal");
const { WithdrawSheet }=await import("../components/cash/WithdrawSheet");
const { ManagerDashboard }=await import("../components/staff/ManagerDashboard");
const CashSummaryScreen=(await import("../app/cash-summary")).default;
const {setOpeningCash,recordWithdrawal,currentBusinessDate}=await import("../db/cash");
const {useSessionStore}=await import("../state/sessionStore");
const {useLocaleStore}=await import("../state/localeStore");
const {catalog}=await import("../i18n/catalog");
let seq=0;
beforeAll(()=>{
  const journal=JSON.parse(readFileSync("apps/mobile/db/migrations/meta/_journal.json","utf8")) as {entries:{tag:string}[]};
  for(const {tag} of journal.entries) sqlite.exec(readFileSync("apps/mobile/db/migrations/"+tag+".sql","utf8"));
});
afterEach(()=>{cleanup();vi.clearAllMocks();});
async function submitAndFlush(submit:()=>unknown) {
  await act(async()=>{submit();await new Promise<void>(resolve=>setTimeout(resolve,0));});
}
function fixture(manager=false) {
  const key="cash-precision-"+(++seq),shopId=key+"-shop",userId=key+"-user",role=manager?"manager":"owner";
  sqlite.prepare("INSERT INTO shops(id,owner_id,name,phone) VALUES(?,?,?,?)").run(shopId,userId,"Synthetic cash precision","01700000000");
  sqlite.prepare("INSERT INTO roles(id,shop_id,name,is_system) VALUES(?,?,?,1)").run(key+"-role",shopId,role);
  sqlite.prepare("INSERT INTO users(id,shop_id,name,pin_hash,pin_set_at,role_id,is_active) VALUES(?,?,'Synthetic cash actor','synthetic',?,?,1)").run(userId,shopId,new Date().toISOString(),key+"-role");
  const session:Session={shopId,userId,role,permissions:{cash_drawer:true}};
  useSessionStore.setState({session});return {shopId,userId,session};
}
function snapshot(shop:string) {
  return ["cash_drawer","payments","inventory_movements","audit_logs","sync_queue"].map(table=>({table,rows:sqlite.prepare("SELECT * FROM "+table+" WHERE shop_id=? ORDER BY id").all(shop)}));
}
async function open(kind:"opening"|"withdraw"|"manager"|"reconcile",locale:"en"|"bn") {
  const f=fixture(kind==="manager"); useLocaleStore.setState({locale});const t=(key:keyof typeof catalog.en)=>catalog[locale][key];
  const context={shopId:f.shopId,staffId:f.userId,isStillActive:()=>true,businessDate:currentBusinessDate()};
  const callback=vi.fn(async(amount:Paisa):Promise<void>=>{
    if(kind==="withdraw") await recordWithdrawal({...context,amount});
    else await setOpeningCash({...context,openingCash:amount});
  });
  if(kind==="opening")render(createElement(OpeningCashModal,{visible:true,isDismissable:false,onClose:vi.fn(),onSubmit:callback}));
  else if(kind==="withdraw")render(createElement(WithdrawSheet,{visible:true,onClose:vi.fn(),onSubmit:callback}));
  else if(kind==="manager")render(createElement(ManagerDashboard));
  else render(createElement(CashSummaryScreen));
  const label=kind==="opening"?t("orEnterAmount"):kind==="withdraw"?t("withdraw"):kind==="manager"?t("openingCash"):t("actualCashQuestion");
  const input=await screen.findByLabelText(label) as HTMLInputElement;
  const saveLabel=kind==="opening"?t("saveOpeningCash"):kind==="manager"?t("save"):kind==="withdraw"?t("save"):t("reconcile");
  return {...f,t,input,callback,writer:kind==="withdraw"?withdrawalWriter:kind==="reconcile"?reconcileWriter:openingWriter,save:()=>fireEvent.click(screen.getByRole("button",{name:saveLabel}))};
}
describe.each(["opening","withdraw","manager","reconcile"] as const)("%s raw cash input",kind=>{
  it.each(["12.345","0.005","0.004","1.000"])("refuses %s without callback or ledger changes",async raw=>{
    const f=await open(kind,"en");fireEvent.change(f.input,{target:{value:raw}});const before=snapshot(f.shopId);
    expect(f.input.value).toBe(raw);
    await submitAndFlush(f.save);
    expect(f.writer).not.toHaveBeenCalled();
    expect(snapshot(f.shopId)).toEqual(before);
    if(kind==="opening"||kind==="withdraw")expect(f.callback).not.toHaveBeenCalled();
    expect(screen.getAllByText(f.t("moneyPrecisionLabel")).length).toBeGreaterThan(0);
  });
  it("shows explicit Bangla precision validation",async()=>{
    const f=await open(kind,"bn");fireEvent.change(f.input,{target:{value:"1.000"}});
    const before=snapshot(f.shopId);await submitAndFlush(f.save);
    expect(f.writer).not.toHaveBeenCalled();expect(snapshot(f.shopId)).toEqual(before);
    if(kind==="opening"||kind==="withdraw")expect(f.callback).not.toHaveBeenCalled();
    expect(screen.getAllByText("দশমিকের পরে সর্বোচ্চ দুইটি অঙ্ক লিখুন।").length).toBeGreaterThan(0);
  });
  it.each([["1.15",115],["0.10",10],["1.",100],["1.00",100]] as const)("persists %s as exactly %s integer paisa",async(raw,expected)=>{
    const f=await open(kind,"en");fireEvent.change(f.input,{target:{value:raw}});expect(f.input.value).toBe(raw);
    await submitAndFlush(f.save);
    expect(f.writer).toHaveBeenCalledOnce();
    if(kind==="opening")expect(f.callback).toHaveBeenCalledExactlyOnceWith(expected);
    if(kind==="withdraw")expect(f.callback).toHaveBeenCalledExactlyOnceWith(expected,undefined);
    const column=kind==="withdraw"?"amount":kind==="reconcile"?"reconciled_counted_amount":"opening_cash";
    const table=kind==="withdraw"?"payments":"cash_drawer";
    await waitFor(()=>expect(sqlite.prepare("SELECT "+column+" amount,typeof("+column+") stored FROM "+table+" WHERE shop_id=?").all(f.shopId)).toEqual([{amount:expected,stored:"integer"}]));
    expect(sqlite.prepare("SELECT id FROM inventory_movements WHERE shop_id=?").all(f.shopId)).toEqual([]);
    const payments=sqlite.prepare("SELECT type,amount FROM payments WHERE shop_id=?").all(f.shopId);
    expect(payments).toEqual(kind==="withdraw"?[{type:"withdrawal",amount:expected}]:[]);
  });
});


describe("Manager explicit opening-cash choice",()=>{
  it.each(["en","bn"] as const)("refuses blank in %s with localized feedback and no write",async locale=>{
    const f=await open("manager",locale);fireEvent.change(f.input,{target:{value:""}});const before=snapshot(f.shopId);
    expect((screen.getByRole("button",{name:f.t("save")}) as HTMLButtonElement).disabled).toBe(true);
    await submitAndFlush(f.save);expect(f.writer).not.toHaveBeenCalled();expect(snapshot(f.shopId)).toEqual(before);
    expect(screen.getByText(f.t("openingCashInvalid"))).toBeTruthy();
  });
  it("accepts an explicit zero as zero integer paisa",async()=>{
    const f=await open("manager","en");fireEvent.change(f.input,{target:{value:"0"}});await submitAndFlush(f.save);
    expect(f.writer).toHaveBeenCalledOnce();
    expect(sqlite.prepare("SELECT opening_cash amount,typeof(opening_cash) stored FROM cash_drawer WHERE shop_id=?").all(f.shopId)).toEqual([{amount:0,stored:"integer"}]);
  });
});
