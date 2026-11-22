// @vitest-environment jsdom
import { createElement, useEffect, type ReactNode } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "../../state/sessionStore";

const mocks = vi.hoisted(() => ({
  read: vi.fn(), completion: null as (() => Promise<void>) | null,
  unsubscribe: vi.fn(), live: true,
}));
vi.mock("react-native", () => ({
  View: ({ children }: {children:ReactNode}) => createElement("div",null,children),
  Text: ({ children }: {children:ReactNode}) => createElement("span",null,children),
}));
vi.mock("expo-router", () => ({ useFocusEffect: (fn:()=>void|(()=>void)) => useEffect(fn,[fn]) }));
vi.mock("../../db/sync-helpers", () => ({ getSyncExposure: mocks.read }));
vi.mock("../../sync", () => ({
  subscribeToSyncCompletion: (_shop:string, fn:()=>Promise<void>) => {
    mocks.completion=fn;return mocks.unsubscribe;
  },
}));
vi.mock("../../state/sessionGuard", () => ({
  captureSessionFor: () => mocks.live ? {ifLive:(fn:()=>void)=>fn()} : null,
}));
const { SyncExposureStatus, syncStateOf } = await import("./SyncExposureStatus");
const { useLocaleStore } = await import("../../state/localeStore");
const session: Session = {shopId:"shop-a",userId:"owner",role:"owner"};
beforeEach(()=>{
  vi.clearAllMocks();mocks.live=true;mocks.completion=null;
  mocks.read.mockReturnValue({pending:2,failed:1,stuck:0});useLocaleStore.setState({locale:"en"});
});
afterEach(cleanup);

describe("sync state at a glance",()=>{
  it("reads failing before waiting, and waiting before sent",()=>{
    expect(syncStateOf(null)).toBe("unavailable");
    expect(syncStateOf({pending:0,failed:0,stuck:0})).toBe("sent");
    expect(syncStateOf({pending:4,failed:0,stuck:0})).toBe("waiting");
    expect(syncStateOf({pending:4,failed:0,stuck:1})).toBe("failing");
    expect(syncStateOf({pending:0,failed:2,stuck:0})).toBe("failing");
  });
});

describe("sync exposure presentation",()=>{
  it("refreshes on focus and completion, and never labels an empty queue as a backup",async()=>{
    render(createElement(SyncExposureStatus,{session}));
    expect(mocks.read).toHaveBeenCalledWith("shop-a");
    expect(screen.getByText("1 could not be sent")).toBeTruthy();
    expect(screen.getByText("Pending: 2 · Failed: 1")).toBeTruthy();
    expect(screen.getByText(/Tell Muthoy support/)).toBeTruthy();
    mocks.read.mockReturnValue({pending:0,failed:0,stuck:0});
    await act(async()=>{await mocks.completion?.()});
    expect(screen.getByText("All changes reached the server")).toBeTruthy();
    expect(screen.getByText("Nothing on this phone is waiting to be sent.")).toBeTruthy();
    // The empty queue is still explicitly NOT a backup.
    expect(screen.getByText("This is not a backup. See Settings for backup status.")).toBeTruthy();
    expect(screen.queryByText(/Pending:/)).toBeNull();
  });
  it("tells the owner what to do while changes are still waiting",()=>{
    mocks.read.mockReturnValue({pending:3,failed:0,stuck:0});
    render(createElement(SyncExposureStatus,{session}));
    expect(screen.getByText("3 waiting to be sent")).toBeTruthy();
    expect(screen.getByText(/do not delete the app or change phones, or they will be lost/)).toBeTruthy();
    expect(screen.queryByText(/Stuck/)).toBeNull();
  });
  it("unsubscribes on blur/unmount and ignores a late completion",async()=>{
    const view=render(createElement(SyncExposureStatus,{session}));
    const callback=mocks.completion;view.unmount();const calls=mocks.read.mock.calls.length;
    await act(async()=>{await callback?.()});
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();expect(mocks.read).toHaveBeenCalledTimes(calls);
  });
  it("never reads with a stale session and reports unavailable on projection failure",()=>{
    mocks.live=false;
    const view=render(createElement(SyncExposureStatus,{session}));
    expect(mocks.read).not.toHaveBeenCalled();
    expect(screen.getByText("Queue status unavailable")).toBeTruthy();
    view.unmount();mocks.live=true;mocks.read.mockImplementation(()=>{throw Error("synthetic")});
    render(createElement(SyncExposureStatus,{session}));
    expect(screen.getByText("Queue status unavailable")).toBeTruthy();
  });
  it("counts rows that keep retrying as not sent, with the figures underneath",()=>{
    mocks.read.mockReturnValue({pending:3,failed:0,stuck:2});
    render(createElement(SyncExposureStatus,{session}));
    expect(screen.getByText("2 could not be sent")).toBeTruthy();
    expect(screen.getByText("Pending: 3 · Failed: 0 · Stuck: 2")).toBeTruthy();
    cleanup();
    useLocaleStore.setState({locale:"bn"});
    render(createElement(SyncExposureStatus,{session}));
    expect(screen.getByText(/২টি পরিবর্তন পাঠানো যাচ্ছে না/)).toBeTruthy();
    expect(screen.getByText(/অপেক্ষমাণ: ৩ · ব্যর্থ: ০ · আটকে আছে: ২/)).toBeTruthy();
  });
  it("refreshes for the new shop and speaks Bangla",()=>{
    useLocaleStore.setState({locale:"bn"});
    mocks.read.mockReturnValue({pending:0,failed:0,stuck:0});
    const view=render(createElement(SyncExposureStatus,{session}));
    expect(screen.getByText("সব পরিবর্তন সার্ভারে পৌঁছেছে")).toBeTruthy();
    mocks.read.mockReturnValue({pending:9,failed:0,stuck:0});
    view.rerender(createElement(SyncExposureStatus,{session:{...session,shopId:"shop-b"}}));
    expect(mocks.read).toHaveBeenLastCalledWith("shop-b");
    expect(screen.getByText(/৯টি পরিবর্তন এখনও পাঠানো/)).toBeTruthy();
    expect(screen.getByText(/ইন্টারনেট চালু রাখুন/)).toBeTruthy();
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();
  });
  it("shows Staff the not-a-backup note without the owner's Settings pointer",()=>{
    mocks.read.mockReturnValue({pending:0,failed:0,stuck:0});
    render(createElement(SyncExposureStatus,{session:{...session,role:"staff"}}));
    expect(screen.getByText("This is not a backup.")).toBeTruthy();
    expect(screen.queryByText(/See Settings/)).toBeNull();
  });
});
