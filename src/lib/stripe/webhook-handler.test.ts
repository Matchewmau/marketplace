import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fulfillCheckoutSession } from "@/lib/fulfillment";
import { handleStripeEvent } from "@/lib/stripe/webhook-handler";

vi.mock("@/lib/fulfillment", () => ({ fulfillCheckoutSession: vi.fn() }));

const LISTING_ID = "11111111-1111-4111-8111-111111111111";
const HOLD_TOKEN = "22222222-2222-4222-8222-222222222222";

type RpcCall = { name: string; args: Record<string, unknown> };

function fakeAdmin() {
  const rpcCalls: RpcCall[] = [];
  const admin = {
    async rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args });
      return { data: null, error: null };
    },
  };
  return { admin: admin as unknown as SupabaseClient, rpcCalls };
}

function event(type: string, object: Record<string, unknown>): Stripe.Event {
  return { id: "evt_test_1", object: "event", type, data: { object } } as unknown as Stripe.Event;
}

const stripe = {} as Stripe;

beforeEach(() => {
  vi.mocked(fulfillCheckoutSession).mockReset();
  vi.mocked(fulfillCheckoutSession).mockResolvedValue({
    outcome: "recorded",
    listingId: LISTING_ID,
    amountCents: 1999,
  });
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
        metadata: { listing_id: LISTING_ID, hold_token: HOLD_TOKEN },
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
});
