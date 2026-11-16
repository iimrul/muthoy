// @vitest-environment jsdom
import { createElement, useEffect } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { syntheticRecoveryCode, webRecoveryCipher } from "./recoveryTestSupport";
const deps=vi.hoisted(()=>({status:vi.fn(),confirm:vi.fn(),appListeners:new Set<(state:string)=>void>()}));
vi.mock("react-native",async()=>({... (await import("./support/reactNativeMock")).createReactNativeMock(),AppState:{addEventListener:(_event:string,cb:(state:string)=>void)=>{deps.appListeners.add(cb);return {remove:()=>deps.appListeners.delete(cb)};}}}));
vi.mock("expo-router",()=>({useFocusEffect:(cb:()=>void|(()=>void))=>useEffect(cb,[cb])}));
vi.mock("../db/recoveryCustody",()=>({getOwnerRecoveryStatus:deps.status,confirmOwnerRecoveryCode:deps.confirm}));
vi.mock("../sync",()=>({subscribeToSyncCompletion:()=>()=>undefined,triggerSyncNow:vi.fn()}));
vi.mock("../sync/recoveryCoordinator",()=>({getRecoveryRunState:()=>null,subscribeToRecoveryStatus:()=>()=>undefined}));
vi.mock("../native/recoveryCrypto",()=>({nativeRecoveryCipher:{...webRecoveryCipher,random:async()=>new Uint8Array(32).fill(161)}}));
const {RecoveryBackupSetup}=await import("../components/recovery/RecoveryBackupSetup");
const {useSessionStore}=await import("../state/sessionStore");
const {useLocaleStore}=await import("../state/localeStore");
const {catalog}=await import("../i18n/catalog");
const owner={shopId:"synthetic-ui-shop",userId:"synthetic-ui-owner",role:"owner" as const};
const formatted=syntheticRecoveryCode.match(/.{8}/g)!.join("-");
beforeEach(()=>{vi.clearAllMocks();deps.status.mockResolvedValue({enabled:false,verifiedAt:null,unprotectedChanges:3,pendingJob:false});deps.confirm.mockResolvedValue(undefined);useLocaleStore.setState({locale:"en"});useSessionStore.getState().login(owner);});
afterEach(()=>{cleanup();deps.appListeners.clear();});
async function open() {render(createElement(RecoveryBackupSetup,{session:owner}));fireEvent.click(await screen.findByRole("button",{name:catalog.en.recoverySetup}));return screen.findByTestId("recovery-code");}
describe("Owner recovery setup privacy and truthful status",()=>{
  it("does not persist a displayed code before confirmation and refuses blank submission",async()=>{
    expect((await open()).textContent).toBe(formatted);
    expect(deps.confirm).not.toHaveBeenCalled();
    expect((screen.getByRole("button",{name:catalog.en.recoveryConfirmCode}) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(catalog.en.recoveryHostedInactive)).toBeTruthy();
  });
  it("confirms explicitly with a live Owner guard and immediately removes the visible factor",async()=>{
    await open();fireEvent.change(screen.getByLabelText(catalog.en.recoveryConfirmCode),{target:{value:formatted}});
    fireEvent.click(screen.getByRole("button",{name:catalog.en.recoveryConfirmCode}));
    await waitFor(()=>expect(deps.confirm).toHaveBeenCalledOnce());
    const [actor,code,confirmation]=deps.confirm.mock.calls[0]!;
    expect(actor).toMatchObject({shopId:owner.shopId,ownerId:owner.userId});expect(code).toBe(formatted);expect(confirmation).toBe(formatted);
    await waitFor(()=>expect(screen.queryByTestId("recovery-code")).toBeNull());
  });
  it("shows generic refusal for a mismatched code without leaking it in the error",async()=>{
    deps.confirm.mockRejectedValue(new Error("confirmation"));await open();
    fireEvent.change(screen.getByLabelText(catalog.en.recoveryConfirmCode),{target:{value:"incorrect"}});
    fireEvent.click(screen.getByRole("button",{name:catalog.en.recoveryConfirmCode}));
    expect((await screen.findByRole("alert")).textContent).toBe(catalog.en.recoverySetupError);
  });
  it.each(["cancel","background"])("clears the code on %s without storing it",async action=>{
    await open();if(action==="cancel")fireEvent.click(screen.getByRole("button",{name:catalog.en.cancel}));
    else await act(async()=>{for(const cb of deps.appListeners)cb("background");});
    expect(screen.queryByTestId("recovery-code")).toBeNull();expect(deps.confirm).not.toHaveBeenCalled();
  });
  it("denies Staff and Manager setup without reading private custody",async()=>{
    for(const role of ["staff","manager"] as const) {
      const session={...owner,userId:"synthetic-"+role,role};useSessionStore.getState().login(session);
      const view=render(createElement(RecoveryBackupSetup,{session}));expect(view.container.textContent).toBe("");view.unmount();
    }
    expect(deps.status).not.toHaveBeenCalled();expect(deps.confirm).not.toHaveBeenCalled();
  });
  it("uses the existing Bangla catalog for inactive-backup and loss limitations",async()=>{
    useLocaleStore.setState({locale:"bn"});render(createElement(RecoveryBackupSetup,{session:owner}));
    expect(await screen.findByText(catalog.bn.recoveryHostedInactive)).toBeTruthy();expect(screen.getByText(catalog.bn.recoveryLimits)).toBeTruthy();
  });
});
