import { describe, expect, it } from "vitest";

import { isTrustedStripeUrl } from "@/lib/stripe/redirect";

describe("isTrustedStripeUrl", () => {
  it("accepts Stripe Checkout URLs", () => {
    expect(isTrustedStripeUrl("https://checkout.stripe.com/c/pay/cs_test_1")).toBe(true);
  });

  it("accepts Stripe Connect URLs", () => {
    expect(isTrustedStripeUrl("https://connect.stripe.com/setup/e/acct_1/abc")).toBe(true);
  });

  it("rejects non-https Stripe URLs", () => {
    expect(isTrustedStripeUrl("http://checkout.stripe.com/c/pay/cs_test_1")).toBe(false);
  });

  it("rejects look-alike hosts", () => {
    expect(isTrustedStripeUrl("https://stripe.com.evil.test/pay")).toBe(false);
  });

  it("rejects javascript URLs", () => {
    expect(isTrustedStripeUrl("javascript:alert(1)")).toBe(false);
  });
});
