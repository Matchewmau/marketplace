import { describe, expect, it } from "vitest";
import {
  ONBOARDING_VALUES,
  QUICK_START,
  TEST_CARDS,
  TESTING_TIPS,
} from "@/lib/testing-guide";

const copyFor = (list: { label: string; copy?: string }[], label: string) =>
  list.find((item) => item.label === label)?.copy;

describe("testing guide data", () => {
  it("has the exact test card numbers to copy", () => {
    expect(copyFor(TEST_CARDS, "Payment succeeds")).toBe("4242424242424242");
    expect(copyFor(TEST_CARDS, "Card is declined")).toBe("4000000000000002");
    expect(copyFor(TEST_CARDS, "Needs 3D Secure")).toBe("4000002760003184");
  });

  it("has the exact Stripe onboarding test values to copy", () => {
    expect(copyFor(ONBOARDING_VALUES, "SMS code")).toBe("000000");
    expect(copyFor(ONBOARDING_VALUES, "Date of birth")).toBe("01/01/1901");
    expect(copyFor(ONBOARDING_VALUES, "SSN")).toBe("000-00-0000");
    expect(copyFor(ONBOARDING_VALUES, "Address line 1")).toBe("address_full_match");
    expect(copyFor(ONBOARDING_VALUES, "Routing number")).toBe("110000000");
    expect(copyFor(ONBOARDING_VALUES, "Account number")).toBe("000123456789");
  });

  it("tags each test card with its outcome tone", () => {
    const toneFor = (label: string) =>
      TEST_CARDS.find((item) => item.label === label)?.tone;
    expect(toneFor("Payment succeeds")).toBe("success");
    expect(toneFor("Card is declined")).toBe("danger");
    expect(toneFor("Needs 3D Secure")).toBe("warning");
    expect(TEST_CARDS.filter((item) => item.tone)).toHaveLength(3);
  });

  it("marks the non-number card fields as instructions", () => {
    expect(
      TEST_CARDS.filter((item) => item.instruction).map((item) => item.label),
    ).toEqual(["Expiry date", "CVC", "Name, country, ZIP"]);
  });

  it("splits onboarding values into identity and bank groups", () => {
    const labelsIn = (group: "identity" | "bank") =>
      ONBOARDING_VALUES.filter((item) => item.group === group).map(
        (item) => item.label,
      );
    expect(labelsIn("identity")).toEqual([
      "Phone",
      "SMS code",
      "Date of birth",
      "SSN",
      "Address line 1",
    ]);
    expect(labelsIn("bank")).toEqual([
      "Payout bank",
      "Routing number",
      "Account number",
    ]);
    expect(ONBOARDING_VALUES.every((item) => item.group)).toBe(true);
  });

  it("keeps the step and tip counts", () => {
    expect(QUICK_START).toHaveLength(4);
    expect(TESTING_TIPS).toHaveLength(4);
  });

  it("uses the assignment's button wording", () => {
    const steps = QUICK_START.join(" ");
    expect(steps).toContain("Buy Now");
    expect(steps).toContain("Connect with Stripe");
  });
});
