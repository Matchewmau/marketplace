import { beforeEach, describe, expect, it, vi } from "vitest";

import { cancelCheckoutHold } from "@/lib/checkout";
import { StripeConfigError } from "@/lib/stripe/config";
import { getStripe } from "@/lib/stripe/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

import { POST } from "./route";

vi.mock("@/lib/supabase-admin", () => ({ getSupabaseAdmin: vi.fn() }));
vi.mock("@/lib/stripe/server", () => ({ getStripe: vi.fn() }));
vi.mock("@/lib/checkout", () => ({ cancelCheckoutHold: vi.fn() }));

const LISTING_ID = "11111111-1111-4111-8111-111111111111";
const HOLD = "22222222-2222-4222-8222-222222222222";

function post(body: string) {
  return new Request("http://localhost:3000/api/checkout/cancel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

const stripe = { tag: "stripe" } as unknown as ReturnType<typeof getStripe>;
const admin = { tag: "admin" } as unknown as ReturnType<typeof getSupabaseAdmin>;

beforeEach(() => {
  vi.mocked(getStripe).mockReset();
  vi.mocked(getSupabaseAdmin).mockReset();
  vi.mocked(cancelCheckoutHold).mockReset();
  vi.mocked(getStripe).mockReturnValue(stripe);
  vi.mocked(getSupabaseAdmin).mockReturnValue(admin);
  vi.mocked(cancelCheckoutHold).mockResolvedValue("cancelled");
});

describe("POST /api/checkout/cancel", () => {
  it.each([
    ["invalid JSON", "{not json"],
    ["a missing hold token", JSON.stringify({ listingId: LISTING_ID })],
    ["a non-uuid hold token", JSON.stringify({ listingId: LISTING_ID, holdToken: "h" })],
    ["a non-uuid listing id", JSON.stringify({ listingId: "abc", holdToken: HOLD })],
    ["a non-object body", JSON.stringify("x")],
  ])("returns 400 for %s", async (_label, body) => {
    const res = await POST(post(body));
    expect(res.status).toBe(400);
    expect(cancelCheckoutHold).not.toHaveBeenCalled();
  });

  it("returns 503 when Stripe is not configured", async () => {
    vi.mocked(getStripe).mockImplementation(() => {
      throw new StripeConfigError("missing key");
    });
    const res = await POST(post(JSON.stringify({ listingId: LISTING_ID, holdToken: HOLD })));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "Payments are not configured." });
    expect(cancelCheckoutHold).not.toHaveBeenCalled();
  });

  it("returns 503 when the Supabase admin client is not configured", async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue(null);
    const res = await POST(post(JSON.stringify({ listingId: LISTING_ID, holdToken: HOLD })));
    expect(res.status).toBe(503);
    expect(cancelCheckoutHold).not.toHaveBeenCalled();
  });

  it.each(["cancelled", "already_paid", "refunded", "unknown"] as const)(
    "returns { result: %s } from cancelCheckoutHold",
    async (result) => {
      vi.mocked(cancelCheckoutHold).mockResolvedValue(result);
      const res = await POST(post(JSON.stringify({ listingId: LISTING_ID, holdToken: HOLD })));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ result });
      expect(cancelCheckoutHold).toHaveBeenCalledWith(LISTING_ID, HOLD, { stripe, admin });
    },
  );
});
