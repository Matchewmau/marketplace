import { describe, expect, it } from "vitest";
import {
  applicationFeeCents,
  dollarsToCents,
  safeProductImage,
} from "@/lib/stripe/amount";

describe("dollarsToCents", () => {
  it("converts a decimal string", () => {
    expect(dollarsToCents("19.99")).toBe(1999);
  });

  it("converts a number", () => {
    expect(dollarsToCents(19.99)).toBe(1999);
  });

  it("avoids floating point drift", () => {
    expect(dollarsToCents(0.1 + 0.2)).toBe(30);
  });

  it("converts a whole-number string", () => {
    expect(dollarsToCents("10")).toBe(1000);
  });

  it("rejects more than two decimals", () => {
    expect(dollarsToCents("1.234")).toBeNull();
  });

  it("rejects negative values", () => {
    expect(dollarsToCents(-1)).toBeNull();
  });

  it("rejects values too large to represent safely", () => {
    expect(dollarsToCents(1e21)).toBeNull();
  });
});

describe("applicationFeeCents", () => {
  it("floors basis-point fee", () => {
    expect(applicationFeeCents(1000, 250)).toBe(25);
  });
});

describe("safeProductImage", () => {
  it("rejects http URLs", () => {
    expect(safeProductImage("http://x.test/a.jpg")).toBeUndefined();
  });

  it("accepts https URLs", () => {
    expect(safeProductImage("https://x.test/y.jpg")).toEqual([
      "https://x.test/y.jpg",
    ]);
  });

  it("returns undefined for null", () => {
    expect(safeProductImage(null)).toBeUndefined();
  });
});
