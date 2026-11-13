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
    expect(copyFor(ONBOARDING_VALUES, "SSN")).toBe("000-00-0000");
    expect(copyFor(ONBOARDING_VALUES, "Routing number")).toBe("110000000");
    expect(copyFor(ONBOARDING_VALUES, "Account number")).toBe("000123456789");
  });

  it("keeps the step and tip counts", () => {
    expect(QUICK_START).toHaveLength(4);
    expect(TESTING_TIPS).toHaveLength(4);
  });
});
