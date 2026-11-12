import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fulfillCheckoutSession } from "@/lib/fulfillment";
import { AppScopeUnavailableError } from "@/lib/stripe/app-scope";
import { handleStripeEvent } from "@/lib/stripe/webhook-handler";

vi.mock("@/lib/fulfillment", () => ({ fulfillCheckoutSession: vi.fn() }));

const LISTING_ID = "11111111-1111-4111-8111-111111111111";
const HOLD_TOKEN = "22222222-2222-4222-8222-222222222222";
const APP_SCOPE = "xyz.supabase.co";

type RpcCall = { name: string; args: Record<string, unknown> };

function fakeAdmin(rpcError: string | null = null) {
  const rpcCalls: RpcCall[] = [];
  const admin = {
    async rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args });
      return { data: null, error: rpcError ? { message: rpcError } : null };
    },
  };
  return { admin: admin as unknown as SupabaseClient, rpcCalls };
}

function event(type: string, object: Record<string, unknown>): Stripe.Event {
  return { id: "evt_test_1", object: "event", type, data: { object } } as unknown as Stripe.Event;
}

const stripe = {} as Stripe;

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("APP_SCOPE", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", `https://${APP_SCOPE}`);
  vi.mocked(fulfillCheckoutSession).mockReset();
  vi.mocked(fulfillCheckoutSession).mockResolvedValue({
    outcome: "recorded",
    listingId: LISTING_ID,
    amountCents: 1999,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("handleStripeEvent", () => {
  it("fulfils checkout.session.completed with the session id", async () => {
    const { admin } = fakeAdmin();
    const outcome = await handleStripeEvent(
      event("checkout.session.completed", { id: "cs_test_1" }),
      { stripe, admin },
    );
    expect(outcome).toBe("fulfilled");
    expect(fulfillCheckoutSession).toHaveBeenCalledWith("cs_test_1", { stripe, admin });
  });

  it("fulfils checkout.session.async_payment_succeeded", async () => {
    const { admin } = fakeAdmin();
    const outcome = await handleStripeEvent(
      event("checkout.session.async_payment_succeeded", { id: "cs_test_2" }),
      { stripe, admin },
    );
    expect(outcome).toBe("fulfilled");
    expect(fulfillCheckoutSession).toHaveBeenCalledWith("cs_test_2", { stripe, admin });
  });

  it("releases the hold named in the expired session metadata", async () => {
    const { admin, rpcCalls } = fakeAdmin();
    const outcome = await handleStripeEvent(
      event("checkout.session.expired", {
        id: "cs_test_3",
        metadata: { listing_id: LISTING_ID, hold_token: HOLD_TOKEN, app_scope: APP_SCOPE },
      }),
      { stripe, admin },
    );
    expect(outcome).toBe("released");
    expect(rpcCalls).toEqual([
      {
        name: "release_listing_hold",
        args: { p_listing_id: LISTING_ID, p_hold_token: HOLD_TOKEN },
      },
    ]);
    expect(fulfillCheckoutSession).not.toHaveBeenCalled();
  });

  it("ignores unknown event types", async () => {
    const { admin, rpcCalls } = fakeAdmin();
    const outcome = await handleStripeEvent(
      event("customer.created", { id: "cus_test_1" }),
      { stripe, admin },
    );
    expect(outcome).toBe("ignored");
    expect(rpcCalls).toEqual([]);
    expect(fulfillCheckoutSession).not.toHaveBeenCalled();
  });

  it("returns ignored when fulfilment ignores a session without app metadata", async () => {
    vi.mocked(fulfillCheckoutSession).mockResolvedValue({
      outcome: "ignored",
      listingId: null,
      amountCents: 500,
    });
    const { admin } = fakeAdmin();
    const outcome = await handleStripeEvent(
      event("checkout.session.completed", { id: "cs_test_other" }),
      { stripe, admin },
    );
    expect(outcome).toBe("ignored");
  });

  it.each(["duplicate", "refunded", "refunded_unavailable"] as const)(
    "treats a %s fulfilment as handled",
    async (fulfilOutcome) => {
      vi.mocked(fulfillCheckoutSession).mockResolvedValue({
        outcome: fulfilOutcome,
        listingId: LISTING_ID,
        amountCents: 1999,
      });
      const { admin } = fakeAdmin();
      const outcome = await handleStripeEvent(
        event("checkout.session.completed", { id: "cs_test_1" }),
        { stripe, admin },
      );
      expect(outcome).toBe("fulfilled");
    },
  );

  it("throws for expired sessions when this deployment has no app scope so Stripe retries", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    const { admin, rpcCalls } = fakeAdmin();
    await expect(
      handleStripeEvent(
        event("checkout.session.expired", {
          id: "cs_test_6",
          metadata: { listing_id: LISTING_ID, hold_token: HOLD_TOKEN, app_scope: APP_SCOPE },
        }),
        { stripe, admin },
      ),
    ).rejects.toBeInstanceOf(AppScopeUnavailableError);
    expect(rpcCalls).toEqual([]);
  });

  it("propagates fulfilment errors so the webhook is retried", async () => {
    vi.mocked(fulfillCheckoutSession).mockRejectedValue(new Error("db down"));
    const { admin } = fakeAdmin();
    await expect(
      handleStripeEvent(event("checkout.session.completed", { id: "cs_test_1" }), {
        stripe,
        admin,
      }),
    ).rejects.toThrow("db down");
  });

  it.each([
    ["no metadata", undefined],
    ["a non-uuid listing_id", { listing_id: "abc", hold_token: HOLD_TOKEN, app_scope: APP_SCOPE }],
    ["a non-uuid hold_token", { listing_id: LISTING_ID, hold_token: "h", app_scope: APP_SCOPE }],
    ["a missing hold_token", { listing_id: LISTING_ID, app_scope: APP_SCOPE }],
    ["a missing app_scope", { listing_id: LISTING_ID, hold_token: HOLD_TOKEN }],
    [
      "another deployment's app_scope",
      { listing_id: LISTING_ID, hold_token: HOLD_TOKEN, app_scope: "other.supabase.co" },
    ],
  ])("ignores an expired session with %s", async (_label, metadata) => {
    const { admin, rpcCalls } = fakeAdmin();
    const outcome = await handleStripeEvent(
      event("checkout.session.expired", { id: "cs_test_4", metadata }),
      { stripe, admin },
    );
    expect(outcome).toBe("ignored");
    expect(rpcCalls).toEqual([]);
  });

  it("throws when releasing the expired session's hold fails", async () => {
    const { admin } = fakeAdmin("db down");
    await expect(
      handleStripeEvent(
        event("checkout.session.expired", {
          id: "cs_test_5",
          metadata: { listing_id: LISTING_ID, hold_token: HOLD_TOKEN, app_scope: APP_SCOPE },
        }),
        { stripe, admin },
      ),
    ).rejects.toThrow("Failed to release hold: db down");
  });
});
