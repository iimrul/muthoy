// @vitest-environment jsdom
import { createElement, type CSSProperties, type ReactNode } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { colors } from "@muthoy/constants";

const motion = vi.hoisted(() => ({
  reduce: false,
  start: vi.fn(),
  stop: vi.fn(),
}));

vi.mock("react-native", () => {
  class Value {
    constructor(public value: number) {}
  }
  const flatten = (style: unknown): CSSProperties =>
    Array.isArray(style) ? Object.assign({}, ...style.map(flatten)) : (style as CSSProperties) ?? {};
  return {
    Animated: {
      Value,
      View: ({ style, testID }: { style: unknown; testID?: string; children?: ReactNode }) => {
        const flat = flatten(style) as Omit<CSSProperties, "opacity"> & { opacity?: object };
        return createElement("div", {
          "data-testid": testID,
          "data-color": String(flat.backgroundColor),
          "data-animated": String(flat.opacity instanceof Value),
        });
      },
      loop: () => ({ start: motion.start, stop: motion.stop }),
      sequence: (steps: unknown[]) => steps,
      timing: () => ({}),
    },
    AccessibilityInfo: { isReduceMotionEnabled: async () => motion.reduce },
  };
});

const { SyncStatusDot, syncButtonLabel } = await import("./SyncStatusDot");

beforeEach(() => { vi.clearAllMocks(); motion.reduce = false; });
afterEach(cleanup);

describe("header sync dot", () => {
  it.each(["sent", "unavailable"] as const)("draws nothing when the queue is %s", (state) => {
    render(createElement(SyncStatusDot, { state }));
    expect(screen.queryByTestId("sync-status-dot")).toBeNull();
  });

  it("blinks yellow while changes wait to be sent", async () => {
    render(createElement(SyncStatusDot, { state: "waiting" }));
    const dot = screen.getByTestId("sync-status-dot");
    expect(dot.dataset.color).toBe(colors.syncPendingDot);
    expect(dot.dataset.animated).toBe("true");
    await waitFor(() => expect(motion.start).toHaveBeenCalledOnce());
  });

  it("blinks red when changes cannot be sent, and stops blinking when it goes away", async () => {
    const view = render(createElement(SyncStatusDot, { state: "failing" }));
    expect(screen.getByTestId("sync-status-dot").dataset.color).toBe(colors.syncFailedDot);
    await waitFor(() => expect(motion.start).toHaveBeenCalledOnce());
    view.rerender(createElement(SyncStatusDot, { state: "sent" }));
    expect(screen.queryByTestId("sync-status-dot")).toBeNull();
    expect(motion.stop).toHaveBeenCalled();
  });

  it("keeps the dot but not the blink under Reduce Motion", async () => {
    motion.reduce = true;
    render(createElement(SyncStatusDot, { state: "waiting" }));
    expect(screen.getByTestId("sync-status-dot")).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(motion.start).not.toHaveBeenCalled();
  });

  it("says the state out loud, not only in colour", () => {
    const t = (key: string) => ({
      sync: "Sync",
      syncDotWaiting: "Changes waiting to be sent",
      syncDotFailing: "Some changes could not be sent",
    } as Record<string, string>)[key] ?? key;
    expect(syncButtonLabel(t as never, "waiting")).toBe("Sync. Changes waiting to be sent");
    expect(syncButtonLabel(t as never, "failing")).toBe("Sync. Some changes could not be sent");
    expect(syncButtonLabel(t as never, "sent")).toBe("Sync");
  });
});
