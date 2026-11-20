// @vitest-environment jsdom
//
// Founder decision 2026-11-20 — the sale scan is LIVE: a confident strip goes
// straight into the cart (components/scanner/LiveStripScanner.tsx, whose own
// tests drive the camera loop). This file pins the two screens that open it.
//
// The property that matters most here is the one the W2-01 confirm gate taught:
// app/scan.tsx and the Sale tab must not disagree about what a scan means. Both
// now render the SAME LiveStripScanner, and neither keeps a private matching
// path of its own. app/(tabs)/sale.tsx has no render harness in this repo, so
// it is pinned at source level the way tests/localization-and-ui-consistency
// does it.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

vi.mock("react-native", () => ({
  View: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
}));

const routerMock = vi.hoisted(() => ({ replace: vi.fn(), back: vi.fn(), push: vi.fn() }));
vi.mock("expo-router", () => ({ router: routerMock }));

interface ScannerProps {
  visible: boolean;
  shopId: string;
  userId: string;
  onClose: () => void;
  onDone: () => void;
  onManualSearch?: () => void;
}
const scanner = vi.hoisted(() => ({ props: null as ScannerProps | null }));
vi.mock("../../components/scanner/LiveStripScanner", () => ({
  LiveStripScanner: (props: ScannerProps) => {
    scanner.props = props;
    return null;
  },
}));

const { useSessionStore } = await import("../../state/sessionStore");
const ScanSaleScreen = (await import("../../app/scan")).default;

const SESSION = {
  shopId: "7c5e1a20-0000-4000-8000-000000000001",
  userId: "7c5e1a20-0000-4000-8000-000000000002",
  role: "owner" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  scanner.props = null;
  useSessionStore.setState({ session: SESSION });
});

afterEach(() => cleanup());

describe("app/scan.tsx opens the live scanner for the signed-in shop", () => {
  it("scans this shop's inventory as this user", () => {
    render(createElement(ScanSaleScreen));
    expect(scanner.props).toMatchObject({ visible: true, shopId: SESSION.shopId, userId: SESSION.userId });
  });

  it("renders nothing without a session", () => {
    useSessionStore.setState({ session: null });
    render(createElement(ScanSaleScreen));
    expect(scanner.props).toBeNull();
  });

  it("Done REPLACES the route with the cart, so the modal cannot sit on top of it", () => {
    render(createElement(ScanSaleScreen));
    scanner.props?.onDone();
    expect(routerMock.replace).toHaveBeenCalledWith("/sale/cart");
    expect(routerMock.push).not.toHaveBeenCalled();
  });

  it("manual search replaces the route with the Sale tab; close goes back", () => {
    render(createElement(ScanSaleScreen));
    scanner.props?.onManualSearch?.();
    expect(routerMock.replace).toHaveBeenCalledWith("/sale");
    scanner.props?.onClose();
    expect(routerMock.back).toHaveBeenCalledTimes(1);
  });
});

describe("the Sale tab uses the same scanner", () => {
  /** Comments out, so prose naming a function cannot satisfy or break a check. */
  const code = (text: string): string =>
    text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");
  const read = (relative: string) => code(readFileSync(resolve(process.cwd(), relative), "utf8"));
  const saleTab = read("apps/mobile/app/(tabs)/sale.tsx");
  const scanScreen = read("apps/mobile/app/scan.tsx");

  it("renders LiveStripScanner on both scan paths", () => {
    expect(saleTab).toContain("<LiveStripScanner");
    expect(scanScreen).toContain("<LiveStripScanner");
  });

  it("keeps no private OCR matching path on either screen", () => {
    for (const source of [saleTab, scanScreen]) {
      expect(source).not.toContain("findExactNameMatch(");
      expect(source).not.toContain("extractMedicineNameCandidate(");
      expect(source).not.toContain("MedicineTextScanner");
      expect(source).not.toContain("ScanConfirmSheet");
    }
  });

  it("closes the scanner before pushing the cart from the Sale tab", () => {
    const onDone = saleTab.slice(saleTab.indexOf("onDone={() => {"), saleTab.indexOf("onBarcodeRecognized={handleBarcode}"));
    expect(onDone.indexOf("setIsScannerVisible(false)")).toBeGreaterThan(-1);
    expect(onDone.indexOf("setIsScannerVisible(false)")).toBeLessThan(onDone.indexOf('router.push("/sale/cart")'));
  });
});
