// @vitest-environment jsdom
//
// The dosage-form tag, icon and picker (founder, 2026-11-27: Telmepress 20
// tablet vs capsule must be told apart on sight, and picked, never typed).
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

interface StubProps {
  children?: ReactNode;
  testID?: string;
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityState?: { selected?: boolean };
}

vi.mock("react-native", () => ({
  View: (p: StubProps) => createElement("div", { "data-testid": p.testID }, p.children),
  Text: (p: StubProps) => createElement("span", null, p.children),
  Pressable: (p: StubProps) =>
    createElement(
      "button",
      { onClick: p.onPress, "aria-label": p.accessibilityLabel, "aria-selected": p.accessibilityState?.selected },
      p.children,
    ),
}));

const { DosageFormIcon, DosageFormTag } = await import("./DosageFormBadge");
const { DosageFormPicker } = await import("./DosageFormPicker");
const { DOSAGE_FORMS } = await import("../../domain/dosageForm");
const { useLocaleStore } = await import("../../state/localeStore");

beforeEach(() => useLocaleStore.setState({ locale: "en" }));
afterEach(cleanup);

describe("DosageFormTag", () => {
  it("shows the form label and the strength", () => {
    render(createElement(DosageFormTag, { type: "capsule", strength: "20mg" }));
    expect(screen.getByText("Capsule")).toBeTruthy();
    expect(screen.getByText("20mg")).toBeTruthy();
  });

  it("reads an old free-text form ('Caps') as its canonical form", () => {
    render(createElement(DosageFormTag, { type: "Caps", strength: null }));
    expect(screen.getByText("Capsule")).toBeTruthy();
  });

  it("speaks Bangla in the Bangla app", () => {
    useLocaleStore.setState({ locale: "bn" });
    render(createElement(DosageFormTag, { type: "tablet", strength: null }));
    expect(screen.getByText("ট্যাবলেট")).toBeTruthy();
  });

  it("shows the strength alone when no form was recorded", () => {
    render(createElement(DosageFormTag, { type: null, strength: "500mg" }));
    expect(screen.getByText("500mg")).toBeTruthy();
    expect(screen.queryByText("Other")).toBeNull();
  });

  it("renders nothing when neither form nor strength was recorded", () => {
    render(createElement(DosageFormTag, { type: "  ", strength: "  " }));
    expect(screen.queryByTestId("dosage-form-tag")).toBeNull();
  });
});

describe("DosageFormIcon", () => {
  it("draws each form's own icon", () => {
    render(createElement(DosageFormIcon, { type: "Insulin Injection" }));
    expect(screen.getByTestId("dosage-form-icon-insulin")).toBeTruthy();
  });

  it("draws the neutral icon for an unknown or missing form", () => {
    render(createElement(DosageFormIcon, { type: null }));
    expect(screen.getByTestId("dosage-form-icon-other")).toBeTruthy();
  });
});

describe("DosageFormPicker", () => {
  function renderPicker(value: string | null) {
    const onChange = vi.fn();
    render(createElement(DosageFormPicker, { value, onChange }));
    return onChange;
  }

  it("offers every form as a chip, none chosen when empty", () => {
    renderPicker("");
    expect(screen.getAllByRole("button")).toHaveLength(DOSAGE_FORMS.length);
    for (const chip of screen.getAllByRole("button")) {
      expect(chip.getAttribute("aria-selected")).toBe("false");
    }
  });

  it("writes the canonical key, never the label", () => {
    const onChange = renderPicker("");
    fireEvent.click(screen.getByLabelText("Capsule"));
    expect(onChange).toHaveBeenCalledWith("capsule");
  });

  it("marks an old free-text value's form as chosen", () => {
    renderPicker("Tab.");
    expect(screen.getByLabelText("Tablet").getAttribute("aria-selected")).toBe("true");
    expect(screen.getByLabelText("Capsule").getAttribute("aria-selected")).toBe("false");
  });

  it("clears the form when the chosen chip is tapped again — the field is optional", () => {
    const onChange = renderPicker("tablet");
    fireEvent.click(screen.getByLabelText("Tablet"));
    expect(onChange).toHaveBeenCalledWith("");
  });
});
