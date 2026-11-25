import { describe, expect, it } from "vitest";
import { extractOtpCode } from "./otpCode";

describe("finding the code in an SMS or a pasted text", () => {
  it("reads Muthoy's own message", () => {
    expect(extractOtpCode("Muthoy code: 482913. Valid 5 minutes. Never share this code.")).toBe("482913");
  });

  it("accepts the code alone, with spaces or dashes", () => {
    expect(extractOtpCode("482913")).toBe("482913");
    expect(extractOtpCode(" 482 913 ")).toBe("482913");
    expect(extractOtpCode("482-913")).toBe("482913");
  });

  it("never takes six digits out of a longer number such as a phone", () => {
    expect(extractOtpCode("Call 01700000000 for help")).toBeNull();
    expect(extractOtpCode("01700000000")).toBeNull();
  });

  it("refuses to guess between two different codes", () => {
    expect(extractOtpCode("code 111111 or 222222")).toBeNull();
    expect(extractOtpCode("code 111111, again 111111")).toBe("111111");
  });

  it("returns null for nothing useful", () => {
    expect(extractOtpCode("")).toBeNull();
    expect(extractOtpCode(null)).toBeNull();
    expect(extractOtpCode("12345")).toBeNull();
    expect(extractOtpCode("hello")).toBeNull();
  });
});
