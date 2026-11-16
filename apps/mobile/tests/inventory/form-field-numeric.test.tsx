// @vitest-environment jsdom
import { createElement, useEffect, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useForm, type UseFormReturn } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fromTaka } from "@muthoy/types";

interface Props {
  children?: ReactNode; value?: string; accessibilityLabel?: string;
  onChangeText?: (text: string) => void; onBlur?: () => void;
}
vi.mock("react-native", () => ({
  View: ({ children }: Props) => createElement("div", null, children),
  Text: ({ children }: Props) => createElement("span", null, children),
  TextInput: ({ value, accessibilityLabel, onChangeText, onBlur }: Props) =>
    createElement("input", {
      value, "aria-label": accessibilityLabel, onBlur,
      onChange: (event: { target: { value: string } }) => onChangeText?.(event.target.value),
    }),
}));
const { FormField, NumericTextInput } = await import("../../components/forms/FormField");
const { useLocaleStore } = await import("../../state/localeStore");
let form: UseFormReturn<{ price?: number; name: string }>;
function Harness() {
  const methods = useForm<{ price?: number; name: string }>({ defaultValues: { price: undefined as number | undefined, name: "" } });
  useEffect(() => { form = methods; }, [methods]);
  return createElement(FormField<{ price?: number; name: string }>, {
    control: methods.control, name: "price", label: "Price", numeric: true, money: true,
  });
}
function field() { return screen.getByLabelText("Price") as HTMLInputElement; }
function type(text: string) {
  for (const character of text) {
    fireEvent.change(field(), { target: { value: field().value + character } });
  }
}
beforeEach(() => useLocaleStore.setState({ locale: "en" }));
afterEach(cleanup);
describe("numeric FormField editing and unchanged numeric boundary", () => {
  it.each(["1.00", "0.10", "1."])("preserves every typed character in %s", (text) => {
    render(createElement(Harness));
    type(text);
    expect(field().value).toBe(text);
    expect(form.getValues("price")).toBe(Number(text));
    fireEvent.blur(field());
    expect(field().value).toBe(text);
  });
  it("submits one taka as exactly 100 integer paisa after typing 1.00", async () => {
    render(createElement(Harness)); type("1.00");
    const saved = vi.fn();
    await act(async () => { await form.handleSubmit(values => saved(fromTaka(values.price!)))(); });
    expect(field().value).toBe("1.00");
    expect(saved).toHaveBeenCalledExactlyOnceWith(100);
    expect(Number.isInteger(saved.mock.calls[0]![0])).toBe(true);
  });
  it("preserves deletion, including trailing decimal and empty numeric value", () => {
    render(createElement(Harness)); type("0.10");
    for (const text of ["0.1", "0.", "0", ""]) {
      fireEvent.change(field(), { target: { value: text } });
      expect(field().value).toBe(text);
      expect(form.getValues("price")).toBe(text === "" ? undefined : Number(text));
    }
  });
  it("renders external setValue and resets, including the same numeric value", async () => {
    render(createElement(Harness)); type("1.00");
    act(() => form.reset({ price: 1, name: "" }));
    await waitFor(() => expect(field().value).toBe("1"));
    act(() => form.setValue("price", 0.25));
    await waitFor(() => expect(field().value).toBe("0.25"));
    act(() => form.reset({ price: undefined, name: "" }));
    await waitFor(() => expect(field().value).toBe(""));
    expect(form.getValues("price")).toBeUndefined();
  });
  it("retains invalid numeric input for existing validation rather than silently repairing it", () => {
    render(createElement(Harness));
    fireEvent.change(field(), { target: { value: "1..2" } });
    expect(field().value).toBe("1..2");
    expect(Number.isNaN(form.getValues("price"))).toBe(true);
  });
});


describe("money precision is explicit without losing editable characters", () => {
  it.each(["12.345", "0.005", "0.004", "1.000", "12.3400"])("keeps invalid %s visible and refuses submit", async text => {
    render(createElement(Harness)); type(text);
    expect(field().value).toBe(text);
    expect(form.getValues("price")).toBeNaN();
    expect(screen.getByText("Use no more than two decimal places.")).toBeTruthy();
    const saved = vi.fn();
    await act(() => form.handleSubmit(saved)());
    expect(saved).not.toHaveBeenCalled();
  });
  it("localizes precision errors in Bangla and clears them when corrected", () => {
    useLocaleStore.setState({ locale: "bn" }); render(createElement(Harness)); type("1.001");
    expect(screen.getByText("দশমিকের পরে সর্বোচ্চ দুইটি অঙ্ক লিখুন।")).toBeTruthy();
    fireEvent.change(field(), { target: { value: "1.00" } });
    expect(form.getValues("price")).toBe(1);
    expect(screen.queryByText("দশমিকের পরে সর্বোচ্চ দুইটি অঙ্ক লিখুন।")).toBeNull();
  });
});


describe("delayed native numeric echoes", () => {
  it.each([
    [["1","1.2","1.20"],1,"1.20",1.2],
    [["12","12.3","12.34","12.345"],12.34,"12.345",NaN],
  ] as const)("keeps the exact current draft when an older own value arrives",(drafts,oldValue,expected,lastValue)=>{
    const onChangeText=vi.fn(),reset={};
    const props={value:undefined as unknown,money:true,resetValues:reset,accessibilityLabel:"Deferred money",onChangeText};
    const view=render(createElement(NumericTextInput,props));
    for(const text of drafts) fireEvent.change(screen.getByLabelText("Deferred money"),{target:{value:text}});
    view.rerender(createElement(NumericTextInput,{...props,value:oldValue}));
    expect((screen.getByLabelText("Deferred money") as HTMLInputElement).value).toBe(expected);
    view.rerender(createElement(NumericTextInput,{...props,value:lastValue}));
    expect((screen.getByLabelText("Deferred money") as HTMLInputElement).value).toBe(expected);
    if(Number.isNaN(lastValue)) expect(screen.getByText("Use no more than two decimal places.")).toBeTruthy();
    view.rerender(createElement(NumericTextInput,{...props,value:0.25,resetValues:{price:0.25}}));
    expect((screen.getByLabelText("Deferred money") as HTMLInputElement).value).toBe("0.25");
  });
});
