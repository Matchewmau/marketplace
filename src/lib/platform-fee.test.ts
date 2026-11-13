import { describe, expect, it } from "vitest";
import { formatFeePercent, platformFeeNotice } from "./platform-fee";

describe("formatFeePercent", () => {
  it("formats basis points as a percent", () => {
    expect(formatFeePercent(1000)).toBe("10%");
    expect(formatFeePercent(250)).toBe("2.5%");
    expect(formatFeePercent(1)).toBe("0.01%");
    expect(formatFeePercent(10000)).toBe("100%");
  });
});

describe("platformFeeNotice", () => {
  it("returns null when there is no fee", () => {
    expect(platformFeeNotice(0)).toBeNull();
    expect(platformFeeNotice(-5)).toBeNull();
    expect(platformFeeNotice(NaN)).toBeNull();
  });

  it("returns the sentence for a positive fee", () => {
    expect(platformFeeNotice(1000)).toBe(
      "The marketplace keeps a 10% platform fee on each sale; the rest goes to your Stripe account.",
    );
  });
});
