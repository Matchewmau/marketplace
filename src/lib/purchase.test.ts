import { describe, expect, it } from "vitest";
import { getPurchaseState } from "@/lib/purchase";

const activeListing = { price: 25, status: "active" as const };
const enabledSeller = { charges_enabled: true };

describe("getPurchaseState", () => {
  it("blocks sold listings", () => {
    expect(
      getPurchaseState({ price: 25, status: "sold" }, enabledSeller, false, true),
    ).toEqual({ buyable: false, reason: "sold" });
  });

  it("blocks free listings", () => {
    expect(
      getPurchaseState({ price: 0, status: "active" }, enabledSeller, false, true),
    ).toEqual({ buyable: false, reason: "free" });
  });

  it("blocks prices below the Stripe minimum", () => {
    expect(
      getPurchaseState({ price: 0.49, status: "active" }, enabledSeller, false, true),
    ).toEqual({ buyable: false, reason: "below_minimum" });
  });

  it("blocks prices above the Stripe maximum", () => {
    expect(
      getPurchaseState({ price: 1000000, status: "active" }, enabledSeller, false, true),
    ).toEqual({ buyable: false, reason: "above_maximum" });
  });

  it("reports payments unavailable when not configured", () => {
    expect(getPurchaseState(activeListing, enabledSeller, false, false)).toEqual({
      buyable: false,
      reason: "payments_unavailable",
    });
  });

  it("reports seller not onboarded when the seller has no account", () => {
    expect(getPurchaseState(activeListing, null, false, true)).toEqual({
      buyable: false,
      reason: "seller_not_onboarded",
    });
  });

  it("reports seller not onboarded when charges are disabled", () => {
    expect(
      getPurchaseState(activeListing, { charges_enabled: false }, false, true),
    ).toEqual({ buyable: false, reason: "seller_not_onboarded" });
  });

  it("reports reserved when there is an active hold", () => {
    expect(getPurchaseState(activeListing, enabledSeller, true, true)).toEqual({
      buyable: false,
      reason: "reserved",
    });
  });

  it("is buyable with integer cents when all checks pass", () => {
    expect(
      getPurchaseState({ price: 19.99, status: "active" }, enabledSeller, false, true),
    ).toEqual({ buyable: true, amountCents: 1999 });
  });

  it("accepts a string price from the database without coercion", () => {
    expect(
      getPurchaseState(
        { price: "25.00" as unknown as number, status: "active" },
        enabledSeller,
        false,
        true,
      ),
    ).toEqual({ buyable: true, amountCents: 2500 });
  });
});
