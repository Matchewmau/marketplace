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

  it("accepts trusted hosts regardless of case", () => {
    expect(isTrustedStripeUrl("https://CHECKOUT.STRIPE.COM/c/pay")).toBe(true);
  });

  it("rejects other stripe.com subdomains", () => {
    expect(isTrustedStripeUrl("https://buy.stripe.com/x")).toBe(false);
    expect(isTrustedStripeUrl("https://files.stripe.com/x")).toBe(false);
    expect(isTrustedStripeUrl("https://stripe.com/x")).toBe(false);
  });

  it("rejects URLs with credentials", () => {
    expect(isTrustedStripeUrl("https://evil.test@checkout.stripe.com/x")).toBe(false);
    expect(isTrustedStripeUrl("https://user:pass@checkout.stripe.com/x")).toBe(false);
    expect(isTrustedStripeUrl("https://stripe.com@evil.test")).toBe(false);
  });

  it("rejects non-default ports", () => {
    expect(isTrustedStripeUrl("https://checkout.stripe.com:8443/x")).toBe(false);
  });

  it("accepts an explicit default port", () => {
    expect(isTrustedStripeUrl("https://checkout.stripe.com:443/x")).toBe(true);
  });

  it("rejects hosts that merely end in stripe.com", () => {
    expect(isTrustedStripeUrl("https://evilstripe.com")).toBe(false);
  });

  it("rejects non-string values", () => {
    expect(isTrustedStripeUrl(undefined)).toBe(false);
  });
});
