import { describe, expect, it } from "vitest";
import { formatPrice } from "@/lib/format";

describe("formatPrice", () => {
  it("returns Free for zero", () => {
    expect(formatPrice(0)).toBe("Free");
  });

  it("keeps two decimal places for fractional amounts", () => {
    expect(formatPrice(19.5)).toBe("$19.50");
  });

  it("formats numeric strings as whole dollars", () => {
    expect(formatPrice("12")).toBe("$12");
  });
});
