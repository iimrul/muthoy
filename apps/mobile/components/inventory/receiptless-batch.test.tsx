// @vitest-environment jsdom
import { createElement, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "../../state/sessionStore";

const m=vi.hoisted(()=>({
  get:vi.fn(),add:vi.fn(),sync:vi.fn(),saved:vi.fn(),live:true,
  params:{medicineId:"medicine",mode:undefined as string|undefined},
  session:{shopId:"shop-a",userId:"owner",role:"owner"} as Session,
  edit:true,receive:true,tier:"free",loading:false,
}));
interface Props {children?:ReactNode;value?:string;onChangeText?:(text:string)=>void;onPress?:()=>void;disabled?:boolean;accessibilityLabel?:string}
vi.mock("react-native",()=>({
  View:({children}:Props)=>createElement("div",null,children),
  ScrollView:({children}:Props)=>createElement("div",null,children),
  Text:({children}:Props)=>createElement("span",null,children),
  Pressable:({children,onPress,disabled,accessibilityLabel}:Props)=>createElement("button",{onClick:onPress,disabled,"aria-label":accessibilityLabel},children),
  TextInput:({value,onChangeText,accessibilityLabel}:Props)=>createElement("input",{
    value:value??"","aria-label":accessibilityLabel,onChange:(e:{target:{value:string}})=>onChangeText?.(e.target.value),
  }),
}));
vi.mock("expo-router",()=>({useLocalSearchParams:()=>m.params,router:{back:vi.fn()}}));
vi.mock("../../db/inventory",()=>({getMedicine:m.get,addBatchToMedicine:m.add}));
vi.mock("../../sync",()=>({triggerSyncNow:m.sync}));
vi.mock("../../state/sessionGuard",()=>({
  captureSessionFor:()=>m.live?{isStillActive:()=>m.live,assertLive:()=>{if(!m.live)throw Error("stale")},ifLive:(fn:()=>void)=>{if(m.live)fn()}}:null,
}));
vi.mock("../../state/usePermission",()=>({usePermission:(key:string)=>({session:m.session,isAllowed:key==="inventory_edit"?m.edit:m.receive})}));
vi.mock("../../state/usePlan",()=>({usePlan:()=>({effectiveTier:m.tier,loading:m.loading})}));
vi.mock("./ManualEntryForm",()=>({ManualEntryForm:()=>createElement("div",null,"Supplier receipt form")}));
vi.mock("../ui/StandardHeader",()=>({StandardHeader:()=>null}));
vi.mock("../ui/AccessDenied",()=>({AccessDenied:()=>createElement("div",null,"Denied")}));
// The calendar (components/ui/DateField.tsx) has its own tests; here the date is
// entered directly so the form's own validation stays under test.
vi.mock("../ui/DateField",()=>({DateField:({value,onChange,accessibilityLabel}:{value:string;onChange:(v:string)=>void;accessibilityLabel:string})=>
  createElement("input",{value,"aria-label":accessibilityLabel,onChange:(e:{target:{value:string}})=>onChange(e.target.value)})}));
const {ReceiptlessBatchForm}=await import("./ReceiptlessBatchForm");
const {default:AddBatchScreen}=await import("../../app/inventory/add-batch");
const {useLocaleStore}=await import("../../state/localeStore");
beforeEach(()=>{
  vi.clearAllMocks();m.live=true;m.session={shopId:"shop-a",userId:"owner",role:"owner"};
  m.params={medicineId:"medicine",mode:undefined};m.edit=true;m.receive=true;m.tier="free";m.loading=false;
  m.get.mockResolvedValue({id:"medicine",name:"Synthetic medicine"});m.add.mockResolvedValue({batchId:"batch"});
  useLocaleStore.setState({locale:"en"});
});
afterEach(cleanup);
async function form(){
  render(createElement(ReceiptlessBatchForm,{session:m.session,medicineId:"medicine",onSaved:m.saved}));
  await screen.findByText("Synthetic medicine");
  for(const [label,value] of [["Batch number","NEW"],["Quantity","7"],["Purchase price (৳)","1.25"],["Sale price (৳)","2.50"]])
    fireEvent.change(screen.getByLabelText(label!),{target:{value}});
}
describe("receipt-less restock UI",()=>{
  it("converts prices to exact paisa and locks duplicate taps while saving",async()=>{
    let finish!:(value:{batchId:string})=>void;m.add.mockImplementation(()=>new Promise(resolve=>{finish=resolve}));
    await form();const button=screen.getByRole("button",{name:"Save batch"});
    fireEvent.click(button);fireEvent.click(button);
    await waitFor(()=>expect(m.add).toHaveBeenCalledOnce());
    expect(m.add).toHaveBeenCalledWith(expect.objectContaining({shopId:"shop-a",actorUserId:"owner",medicineId:"medicine",batchNo:"NEW",quantity:7,purchasePrice:125,salePrice:250}));
    await act(async()=>finish({batchId:"batch"}));expect(m.saved).toHaveBeenCalledOnce();
  });
  it.each(["0","-1","1.5"])("rejects quantity %s before the writer",async value=>{
    await form();fireEvent.change(screen.getByLabelText("Quantity"),{target:{value}});fireEvent.click(screen.getByRole("button",{name:"Save batch"}));
    await waitFor(()=>expect(screen.getByText(value==="1.5"?"Quantity must be a whole number.":"Quantity must be at least 1.")).toBeTruthy());
    expect(m.add).not.toHaveBeenCalled();
  });
  it("rejects an impossible expiry before the writer",async()=>{
    await form();fireEvent.change(screen.getByLabelText("Expiry date"),{target:{value:"2099-02-31"}});
    fireEvent.click(screen.getByRole("button",{name:"Save batch"}));
    await waitFor(()=>expect(screen.getByText("Enter a valid date (YYYY-MM-DD).")).toBeTruthy());
    expect(m.add).not.toHaveBeenCalled();
  });
  it("localizes a duplicate-batch failure and leaves the form available",async()=>{
    const error=new Error("synthetic private SQL detail");error.name="DuplicateBatchError";
    m.add.mockRejectedValue(error);await form();fireEvent.click(screen.getByRole("button",{name:"Save batch"}));
    await waitFor(()=>expect(screen.getByText(/batch number already|batch.*already exists/i)).toBeTruthy());
    expect(screen.queryByText("synthetic private SQL detail")).toBeNull();expect(m.saved).not.toHaveBeenCalled();
  });
  it("disables submission when the selected medicine is absent",async()=>{
    m.get.mockResolvedValue(null);render(createElement(ReceiptlessBatchForm,{session:m.session,medicineId:"foreign",onSaved:m.saved}));
    await screen.findByText(/Could not load|Unable to load|not load|লোড/i);
    expect((screen.getByRole("button",{name:"Save batch"}) as HTMLButtonElement).disabled).toBe(true);expect(m.add).not.toHaveBeenCalled();
  });
  it("rechecks the medicine and session before writing",async()=>{
    await form();m.get.mockImplementation(async()=>{m.live=false;return {id:"medicine",name:"Synthetic"}});
    fireEvent.click(screen.getByRole("button",{name:"Save batch"}));
    await waitFor(()=>expect(m.get).toHaveBeenCalledTimes(2));expect(m.add).not.toHaveBeenCalled();expect(m.saved).not.toHaveBeenCalled();
  });
  it("renders the receipt-less scope in Bangla",async()=>{
    useLocaleStore.setState({locale:"bn"});
    render(createElement(ReceiptlessBatchForm,{session:m.session,medicineId:"medicine",onSaved:m.saved}));
    await screen.findByText("Synthetic medicine");
    expect(screen.getByText(/চালান বা নগদ পেমেন্ট/)).toBeTruthy();
  });
  it("admits Free Owner and granted Staff to receipt-less restocking",async()=>{
    const view=render(createElement(AddBatchScreen));expect(await screen.findByText("Synthetic medicine")).toBeTruthy();
    view.unmount();m.session={...m.session,userId:"staff",role:"staff"};
    render(createElement(AddBatchScreen));expect(await screen.findByText("Synthetic medicine")).toBeTruthy();
  });
  it("denies missing edit permission, invalid mode, Free receipt and Staff receipt",()=>{
    m.edit=false;let view=render(createElement(AddBatchScreen));expect(screen.getByText("Denied")).toBeTruthy();view.unmount();
    m.edit=true;m.params.mode="unknown";view=render(createElement(AddBatchScreen));expect(screen.getByText("Denied")).toBeTruthy();view.unmount();
    m.params.mode="receipt";view=render(createElement(AddBatchScreen));expect(screen.getByText("Denied")).toBeTruthy();view.unmount();
    m.tier="pro";m.session={...m.session,role:"staff"};render(createElement(AddBatchScreen));expect(screen.getByText("Denied")).toBeTruthy();
  });
  it("retains the separate premium Owner supplier receipt path",()=>{
    m.params.mode="receipt";m.tier="pro";render(createElement(AddBatchScreen));
    expect(screen.getByText("Supplier receipt form")).toBeTruthy();expect(m.add).not.toHaveBeenCalled();
  });
});
