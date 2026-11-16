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
const { SyncExposureStatus } = await import("./SyncExposureStatus");
const { useLocaleStore } = await import("../../state/localeStore");
const session: Session = {shopId:"shop-a",userId:"owner",role:"owner"};
beforeEach(()=>{
  vi.clearAllMocks();mocks.live=true;mocks.completion=null;
  mocks.read.mockReturnValue({pending:2,failed:1});useLocaleStore.setState({locale:"en"});
});
afterEach(cleanup);
describe("sync exposure presentation",()=>{
  it("refreshes on focus and completion, and never labels an empty queue as backup",async()=>{
    render(createElement(SyncExposureStatus,{session}));
    expect(mocks.read).toHaveBeenCalledWith("shop-a");
    expect(screen.getByText(/Pending: 2 · Failed: 1/)).toBeTruthy();
    mocks.read.mockReturnValue({pending:0,failed:0});
    await act(async()=>{await mocks.completion?.()});
    expect(screen.getByText(/Pending: 0 · Failed: 0/)).toBeTruthy();
    expect(screen.getByText(/empty queue does not prove/)).toBeTruthy();
    expect(screen.getByText(/app data is lost/)).toBeTruthy();
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
  it("shows rows that keep retrying as stuck, and hides the figure when there are none",()=>{
    mocks.read.mockReturnValue({pending:3,failed:0,stuck:2});
    const view=render(createElement(SyncExposureStatus,{session}));
    expect(screen.getByText(/Pending: 3 · Failed: 0 · Stuck: 2/)).toBeTruthy();
    view.unmount();
    mocks.read.mockReturnValue({pending:3,failed:0,stuck:0});
    render(createElement(SyncExposureStatus,{session}));
    expect(screen.queryByText(/Stuck/)).toBeNull();
    cleanup();
    useLocaleStore.setState({locale:"bn"});
    mocks.read.mockReturnValue({pending:3,failed:0,stuck:2});
    render(createElement(SyncExposureStatus,{session}));
    expect(screen.getByText(/অপেক্ষমাণ: ৩ · ব্যর্থ: ০ · আটকে আছে: ২/)).toBeTruthy();
  });
  it("refreshes for the new shop and renders the warnings in Bangla",()=>{
    useLocaleStore.setState({locale:"bn"});
    const view=render(createElement(SyncExposureStatus,{session}));
    expect(screen.getByText(/অ্যাপের তথ্য হারালে/)).toBeTruthy();
    mocks.read.mockReturnValue({pending:9,failed:0});
    view.rerender(createElement(SyncExposureStatus,{session:{...session,shopId:"shop-b"}}));
    expect(mocks.read).toHaveBeenLastCalledWith("shop-b");
    expect(screen.getByText(/অপেক্ষমাণ: ৯ · ব্যর্থ: ০/)).toBeTruthy();
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();
  });
});
