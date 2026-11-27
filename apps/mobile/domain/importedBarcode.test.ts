import { describe, expect, it } from "vitest";
import { hasValidGtinCheckDigit, readImportedBarcode, unwrapExcelText } from "./importedBarcode";

describe("GTIN check digit", () => {
  it("accepts real codes and rejects a one-digit slip", () => {
    expect(hasValidGtinCheckDigit("8941234567896")).toBe(true); // EAN-13
    expect(hasValidGtinCheckDigit("036000291452")).toBe(true); // UPC-A
    expect(hasValidGtinCheckDigit("01234565")).toBe(true); // EAN-8
    expect(hasValidGtinCheckDigit("8941234567890")).toBe(false);
    expect(hasValidGtinCheckDigit("36000291453")).toBe(false);
  });

  it("is unchanged by leading zeros — which is what makes restoring them safe", () => {
    expect(hasValidGtinCheckDigit("36000291452")).toBe(true);
    expect(hasValidGtinCheckDigit("0036000291452")).toBe(true);
  });
});

describe("a barcode from a spreadsheet", () => {
  it("keeps a whole EAN-13 exactly", () => {
    expect(readImportedBarcode("8941234567896")).toEqual({ isLost: false, value: "8941234567896" });
  });

  it("refuses Excel's rounded scientific form: the digits are gone", () => {
    expect(readImportedBarcode("8.94123E+12")).toEqual({ isLost: true });
    expect(readImportedBarcode("8.94123e12")).toEqual({ isLost: true });
    expect(readImportedBarcode("9E+12")).toEqual({ isLost: true });
  });

  it("restores the leading zero Excel dropped from a UPC-A, as the camera reads it", () => {
    expect(readImportedBarcode("36000291452")).toEqual({ isLost: false, value: "036000291452" });
  });

  it("restores an EAN-8's leading zero", () => {
    expect(readImportedBarcode("1234565")).toEqual({ isLost: false, value: "01234565" });
  });

  it("does not pad a number whose check digit fails — it is the shop's own code", () => {
    expect(readImportedBarcode("36000291453")).toEqual({ isLost: false, value: "36000291453" });
    expect(readImportedBarcode("12345")).toEqual({ isLost: false, value: "12345" });
  });

  it("leaves a valid 12-digit code alone (a UPC-A, or a stripped EAN-13 — never guessed)", () => {
    expect(readImportedBarcode("036000291452")).toEqual({ isLost: false, value: "036000291452" });
  });

  it("unwraps Excel's =\"…\" text form and keeps the zeros it protected", () => {
    expect(readImportedBarcode('="036000291452"')).toEqual({ isLost: false, value: "036000291452" });
    expect(unwrapExcelText(' ="0012" ')).toBe("0012");
    expect(unwrapExcelText("NP-0127")).toBe("NP-0127");
  });

  it("keeps a letters-and-digits shop code as typed, and an empty cell as none", () => {
    expect(readImportedBarcode(" SHOP-0042 ")).toEqual({ isLost: false, value: "SHOP-0042" });
    expect(readImportedBarcode("   ")).toEqual({ isLost: false, value: null });
  });
});
