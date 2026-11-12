import { beforeEach, describe, expect, it, vi } from "vitest";

import { createCheckoutForListing } from "@/lib/checkout";
import { StripeConfigError } from "@/lib/stripe/config";
import { getStripe } from "@/lib/stripe/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

import { POST } from "./route";

vi.mock("@/lib/supabase-admin", () => ({ getSupabaseAdmin: vi.fn() }));
vi.mock("@/lib/stripe/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/stripe/server")>()),
  getStripe: vi.fn(),
}));
vi.mock("@/lib/checkout", () => ({ createCheckoutForListing: vi.fn() }));

const LISTING_ID = "11111111-1111-4111-8111-111111111111";
const HOLD = "22222222-2222-4222-8222-222222222222";

function post(body: string) {
  return new Request("http://localhost:3000/api/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_x");
  vi.stubEnv("PLATFORM_FEE_BPS", "250");
  vi.stubEnv("APP_URL", "");
  vi.mocked(getStripe).mockReset();
  vi.mocked(getSupabaseAdmin).mockReset();
  vi.mocked(createCheckoutForListing).mockReset();
  vi.mocked(getStripe).mockReturnValue({} as ReturnType<typeof getStripe>);
  vi.mocked(getSupabaseAdmin).mockReturnValue({} as ReturnType<typeof getSupabaseAdmin>);
});

describe("POST /api/checkout", () => {
  it("returns 503 when Stripe is not configured", async () => {
    vi.mocked(getStripe).mockImplementation(() => {
      throw new StripeConfigError("missing key");
    });
    const res = await POST(post(JSON.stringify({ listingId: LISTING_ID })));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "Payments are not configured." });
    expect(createCheckoutForListing).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid JSON", async () => {
    const res = await POST(post("{not json"));
    expect(res.status).toBe(400);
    expect(createCheckoutForListing).not.toHaveBeenCalled();
  });

  it("maps an ok result to { url, holdToken }", async () => {
    vi.mocked(createCheckoutForListing).mockResolvedValue({
      ok: true,
      url: "https://checkout.stripe.com/c/pay/cs_test_1",
      holdToken: HOLD,
    });
    const res = await POST(post(JSON.stringify({ listingId: LISTING_ID, holdToken: HOLD, price: 1 })));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      url: "https://checkout.stripe.com/c/pay/cs_test_1",
      holdToken: HOLD,
    });
    expect(createCheckoutForListing).toHaveBeenCalledWith(
      LISTING_ID,
      "http://localhost:3000",
      expect.objectContaining({ feeBps: 250 }),
      HOLD,
    );
  });

  it("returns buyers to the request origin even when APP_URL differs", async () => {
    vi.stubEnv("APP_URL", "https://other.example");
    vi.mocked(createCheckoutForListing).mockResolvedValue({
      ok: true,
      url: "https://checkout.stripe.com/c/pay/cs_test_2",
      holdToken: HOLD,
    });
    const req = new Request("https://shop-git-preview.vercel.app/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ listingId: LISTING_ID }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(createCheckoutForListing).toHaveBeenCalledWith(
      LISTING_ID,
      "https://shop-git-preview.vercel.app",
      expect.anything(),
      undefined,
    );
  });
});
