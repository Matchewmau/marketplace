import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fulfillCheckoutSession } from "@/lib/fulfillment";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

import { POST } from "./route";

vi.mock("@/lib/supabase-admin", () => ({ getSupabaseAdmin: vi.fn() }));
vi.mock("@/lib/fulfillment", () => ({ fulfillCheckoutSession: vi.fn() }));

const SECRET = "whsec_test_secret";
const signer = new Stripe("sk_test_x");

const payload = JSON.stringify({
  id: "evt_test_1",
  object: "event",
  type: "checkout.session.completed",
  data: { object: { id: "cs_test_1", object: "checkout.session" } },
});

function post(body: string, signature?: string) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (signature) headers.set("stripe-signature", signature);
  return new Request("http://localhost:3000/api/stripe/webhook", {
    method: "POST",
    headers,
    body,
  });
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_x");
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", SECRET);
  vi.stubEnv("APP_SCOPE", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://xyz.supabase.co");
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(getSupabaseAdmin).mockReset();
  vi.mocked(getSupabaseAdmin).mockReturnValue({} as ReturnType<typeof getSupabaseAdmin>);
  vi.mocked(fulfillCheckoutSession).mockReset();
  vi.mocked(fulfillCheckoutSession).mockResolvedValue({
    outcome: "recorded",
    listingId: null,
    amountCents: 1999,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/stripe/webhook", () => {
  it("accepts a correctly signed event and fulfils the session", async () => {
    const signature = signer.webhooks.generateTestHeaderString({ payload, secret: SECRET });
    const res = await POST(post(payload, signature));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    expect(vi.mocked(fulfillCheckoutSession).mock.calls[0][0]).toBe("cs_test_1");
  });

  it("rejects a tampered body with 400", async () => {
    const signature = signer.webhooks.generateTestHeaderString({ payload, secret: SECRET });
    const tampered = payload.replace("cs_test_1", "cs_test_2");
    const res = await POST(post(tampered, signature));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid signature." });
    expect(fulfillCheckoutSession).not.toHaveBeenCalled();
  });

  it("rejects a request without a signature header with 400", async () => {
    const res = await POST(post(payload));
    expect(res.status).toBe(400);
    expect(fulfillCheckoutSession).not.toHaveBeenCalled();
  });

  it("returns 503 when no webhook secret is configured", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    const signature = signer.webhooks.generateTestHeaderString({ payload, secret: SECRET });
    const res = await POST(post(payload, signature));
    expect(res.status).toBe(503);
    expect(fulfillCheckoutSession).not.toHaveBeenCalled();
  });

  it.each([
    ["no Supabase URL", "", ""],
    ["a local Supabase without APP_SCOPE", "", "http://127.0.0.1:54321"],
    ["an invalid APP_SCOPE", "-bad scope", "https://xyz.supabase.co"],
  ])("returns 503 without handling when the app scope is unavailable (%s)", async (_label, scope, url) => {
    vi.stubEnv("APP_SCOPE", scope);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
    const signature = signer.webhooks.generateTestHeaderString({ payload, secret: SECRET });
    const res = await POST(post(payload, signature));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "Payments are not configured." });
    expect(fulfillCheckoutSession).not.toHaveBeenCalled();
  });

  it("returns 500 when handling fails so Stripe retries delivery", async () => {
    vi.mocked(fulfillCheckoutSession).mockRejectedValue(new Error("db down sk_test_secret123"));
    const signature = signer.webhooks.generateTestHeaderString({ payload, secret: SECRET });
    const res = await POST(post(payload, signature));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Webhook handling failed." });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("sk_test_secret123");
  });

  it("returns 200 for a paid session that fulfilment ignores", async () => {
    vi.mocked(fulfillCheckoutSession).mockResolvedValue({
      outcome: "ignored",
      listingId: null,
      amountCents: 500,
    });
    const signature = signer.webhooks.generateTestHeaderString({ payload, secret: SECRET });
    const res = await POST(post(payload, signature));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
  });
});
