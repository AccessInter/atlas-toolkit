import { describe, it, expect } from "vitest";
import {
  toMinor,
  fromMinor,
  addDecimal,
  multiplyDecimal,
  divideTrunc,
  divideRounded,
} from "../src/cobol";

// PIC S9(n)V99 / COMP-3 fixed-point. Golden values reproduce COBOL COMPUTE,
// which TRUNCATES toward zero unless ROUNDED is specified.
describe("Fixed-point decimal parity (scaled BigInt)", () => {
  it("ADD 10.00 + 0.99 = 10.99 (exact)", () => {
    expect(fromMinor(addDecimal(toMinor("10.00"), toMinor("0.99")))).toBe("10.99");
  });

  it("IEEE-754 trap avoided: 0.10 + 0.20 = 0.30 exactly", () => {
    // In JS: 0.1 + 0.2 === 0.30000000000000004 — would corrupt money.
    expect(fromMinor(addDecimal(toMinor("0.10"), toMinor("0.20")))).toBe("0.30");
  });

  it("MULTIPLY 12.50 * 3.00 = 37.50", () => {
    expect(fromMinor(multiplyDecimal(toMinor("12.50"), toMinor("3.00")))).toBe("37.50");
  });

  it("MULTIPLY truncates: 1.10 * 1.05 = 1.15 (1.155 truncated, not rounded)", () => {
    expect(fromMinor(multiplyDecimal(toMinor("1.10"), toMinor("1.05")))).toBe("1.15");
  });

  it("DIVIDE default truncates: 5.00 / 3 = 1.66", () => {
    expect(fromMinor(divideTrunc(toMinor("5.00"), 3n))).toBe("1.66");
  });

  it("DIVIDE ROUNDED: 5.00 / 3 = 1.67", () => {
    expect(fromMinor(divideRounded(toMinor("5.00"), 3n))).toBe("1.67");
  });

  it("negative truncates toward zero, not toward -inf", () => {
    expect(fromMinor(divideTrunc(toMinor("-5.00"), 3n))).toBe("-1.66");
    expect(fromMinor(divideRounded(toMinor("-5.00"), 3n))).toBe("-1.67");
  });
});
