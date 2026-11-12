import { describe, expect, it } from "vitest";
import { decideOnboarding, normalizeSellerEmail } from "@/lib/seller-claim";

describe("decideOnboarding", () => {
  it("creates a new account when no row exists", () => {
    expect(decideOnboarding(null)).toEqual({ action: "create" });
  });

  it("links the existing account while details are not submitted", () => {
    expect(
      decideOnboarding({ stripe_account_id: "acct_1", details_submitted: false }),
    ).toEqual({ action: "link", accountId: "acct_1" });
  });

  it("returns status only once details are submitted", () => {
    expect(
      decideOnboarding({ stripe_account_id: "acct_1", details_submitted: true }),
    ).toEqual({ action: "status_only", accountId: "acct_1" });
  });
});

describe("normalizeSellerEmail", () => {
  it("trims and lowercases a valid email", () => {
    expect(normalizeSellerEmail(" A@B.Co ")).toBe("a@b.co");
  });

  it("rejects an invalid email", () => {
    expect(normalizeSellerEmail("x")).toBeNull();
  });

  it("rejects non-string input", () => {
    expect(normalizeSellerEmail(123)).toBeNull();
  });

  it("rejects emails longer than 255 characters", () => {
    expect(normalizeSellerEmail("a".repeat(250) + "@b.com")).toBeNull();
  });
});
