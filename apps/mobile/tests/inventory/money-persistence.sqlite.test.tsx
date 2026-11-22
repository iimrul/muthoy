// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { sqlite } from "../../db/test/expo-sqlite";
import type { Session } from "../../state/sessionStore";

vi.mock("react-native", async () => ({
  ...(await import("../support/reactNativeMock")).createReactNativeMock(),
  Switch: () => null,
}));
vi.mock("expo-router", () => ({ router:{push:vi.fn(),back:vi.fn()} }));
vi.mock("../../sync", () => ({ triggerSyncNow:vi.fn() }));
vi.mock("../../components/scanner/MedicineTextScanner", () => ({ MedicineTextScanner:()=>null }));
// The calendar (components/ui/DateField.tsx) has its own tests; the date is
// entered directly here so the money-to-SQLite path stays the thing under test.
vi.mock("../../components/ui/DateField", () => ({ DateField:({value,onChange,accessibilityLabel}:{value:string;onChange:(v:string)=>void;accessibilityLabel:string}) =>
  createElement("input",{value,"aria-label":accessibilityLabel,onChange:(e:{target:{value:string}})=>onChange(e.target.value)}) }));
const inventoryDb=await import("../../db/inventory");
const receiptlessWriter=vi.spyOn(inventoryDb,"addBatchToMedicine");
const manualWriter=vi.spyOn(inventoryDb,"createMedicineWithPurchase");
const { ReceiptlessBatchForm }=await import("../../components/inventory/ReceiptlessBatchForm");
const { ManualEntryForm }=await import("../../components/inventory/ManualEntryForm");
const { useSessionStore }=await import("../../state/sessionStore");
const { useLocaleStore }=await import("../../state/localeStore");
const { catalog }=await import("../../i18n/catalog");
let seq=0;
beforeAll(()=>{
  const journal=JSON.parse(readFileSync("apps/mobile/db/migrations/meta/_journal.json","utf8")) as {entries:{tag:string}[]};
  for(const {tag} of journal.entries) sqlite.exec(readFileSync("apps/mobile/db/migrations/"+tag+".sql","utf8"));
});
afterEach(()=>{cleanup();vi.clearAllMocks();});
async function submitAndFlush(submit:()=>unknown) {
  await act(async()=>{submit();await new Promise<void>(resolve=>setTimeout(resolve,0));});
}
function fixture() {
  const prefix="money-form-"+(++seq),shop=prefix+"-shop",owner=prefix+"-owner",med=prefix+"-med",supplier=prefix+"-supplier";
  sqlite.prepare("INSERT INTO shops(id,owner_id,name,phone) VALUES(?,?,?,?)").run(shop,owner,"Synthetic money forms","01700000000");
  sqlite.prepare("INSERT INTO roles(id,shop_id,name,is_system) VALUES(?,?,'owner',1)").run(prefix+"-role",shop);
  sqlite.prepare("INSERT INTO users(id,shop_id,name,pin_hash,pin_set_at,role_id,is_active) VALUES(?,?,'Synthetic Owner','synthetic',?,?,1)").run(owner,shop,new Date().toISOString(),prefix+"-role");
  sqlite.prepare("INSERT INTO medicines(id,shop_id,name) VALUES(?,?,'Synthetic existing')").run(med,shop);
  sqlite.prepare("INSERT INTO suppliers(id,shop_id,name) VALUES(?,?,'Synthetic supplier')").run(supplier,shop);
  const session:Session={shopId:shop,userId:owner,role:"owner"};useSessionStore.setState({session});useLocaleStore.setState({locale:"en"});
  return {shop,owner,med,supplier,session,prefix};
}
function snapshot(shop:string) {
  return ["medicines","batches","inventory_movements","purchases","purchase_items","payments","cash_drawer","audit_logs","sync_queue"].map(table=>({table,rows:sqlite.prepare("SELECT * FROM "+table+" WHERE shop_id=? ORDER BY id").all(shop)}));
}
async function form(kind:"receiptless"|"manual",price:string,priceField:"purchase"|"sale"="purchase",locale:"en"|"bn"="en") {
  const f=fixture(),saved=vi.fn();useLocaleStore.setState({locale});const t=(key:keyof typeof catalog.en)=>catalog[locale][key];
  render(kind==="receiptless"?createElement(ReceiptlessBatchForm,{session:f.session,medicineId:f.med,onSaved:saved}):createElement(ManualEntryForm,{session:f.session,onSaved:saved}));
  if(kind==="receiptless") await screen.findByText("Synthetic existing");
  const suffix=kind==="manual"?" *":"";
  const fill=(label:string,value:string)=>fireEvent.change(screen.getByLabelText(label),{target:{value}});
  if(kind==="manual") {
    fill(t("medicineNameLabel")+suffix,"SYNTH-"+f.prefix);
    fill(t("genericNameLabel")+suffix,"Synthetic generic");
    fill(t("manufacturerLabel"),"Synthetic manufacturer");
  }
  fill(t("batchNumberLabel")+suffix,"SYNTH-BATCH");fill(t("quantityLabel")+suffix,"1");
  fill(t("expiryDateLabel")+suffix,"2099-01-01");
  fill(t("purchasePriceLabel")+suffix,priceField==="purchase"?price:"1.00");
  fill(t("salePriceLabel")+suffix,priceField==="sale"?price:"20.00");
  if(kind==="manual") { fireEvent.click(screen.getByLabelText(t("selectSupplierLabel")));fireEvent.click(await screen.findByLabelText("Synthetic supplier")); }
  return {...f,saved,t,writer:kind==="receiptless"?receiptlessWriter:manualWriter,submit:()=>fireEvent.click(screen.getByLabelText(kind==="receiptless"?t("saveBatchLabel"):t("save")))};
}

describe.each(["receiptless","manual"] as const)("%s form to real SQLite",kind=>{
  it.each([["1.15",115],["0.10",10],["1.",100],["1.00",100]] as const)("saves entered %s as %s integer paisa",async(text,expected)=>{
    const f=await form(kind,text);f.submit();await waitFor(()=>expect(f.saved).toHaveBeenCalledOnce());expect(f.writer).toHaveBeenCalledOnce();
    expect(sqlite.prepare("SELECT purchase_price,sale_price,typeof(purchase_price) stored FROM batches WHERE shop_id=?").all(f.shop)).toEqual([{purchase_price:expected,sale_price:2000,stored:"integer"}]);
    expect(sqlite.prepare("SELECT change_qty,reason FROM inventory_movements WHERE shop_id=?").all(f.shop)).toEqual([{change_qty:1,reason:"purchase"}]);
    if(kind==="receiptless") for(const table of ["purchases","purchase_items","payments","cash_drawer"]) expect(sqlite.prepare("SELECT id FROM "+table+" WHERE shop_id=?").all(f.shop)).toEqual([]);
    else {
      expect(sqlite.prepare("SELECT total,paid_amount FROM purchases WHERE shop_id=?").all(f.shop)).toEqual([{total:expected,paid_amount:expected}]);
      expect(sqlite.prepare("SELECT amount,method,type FROM payments WHERE shop_id=?").all(f.shop)).toEqual([{amount:expected,method:"cash",type:"supplier_payment"}]);
    }
  });
  it.each(["12.345","0.005","0.004","1.000"])("refuses %s with every ledger and outbox unchanged",async text=>{
    const f=await form(kind,text),before=snapshot(f.shop);await submitAndFlush(f.submit);
    expect(f.writer).not.toHaveBeenCalled();expect(snapshot(f.shop)).toEqual(before);
    expect(f.saved).not.toHaveBeenCalled();expect(screen.getByText(f.t("moneyPrecisionLabel"))).toBeTruthy();
  });
  it.each(["en","bn"] as const)("rejects excess sale-price decimals in %s without a write",async locale=>{
    const f=await form(kind,"12.345","sale",locale),before=snapshot(f.shop);await submitAndFlush(f.submit);
    expect(f.writer).not.toHaveBeenCalled();expect(snapshot(f.shop)).toEqual(before);
    expect(f.saved).not.toHaveBeenCalled();expect(screen.getByText(f.t("moneyPrecisionLabel"))).toBeTruthy();
  });
});
