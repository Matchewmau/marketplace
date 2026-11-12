import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fulfillCheckoutSession } from "@/lib/fulfillment";

const LISTING_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "cs_test_paid";

type RpcCall = { name: string; args: Record<string, unknown> };

function fakeAdmin(recordResults: string[]) {
  const rpcCalls: RpcCall[] = [];
  const admin = {
    async rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args });
      if (name === "record_paid_order") {
        return { data: recordResults.shift() ?? null, error: null };
      }
      return { data: null, error: null };
    },
  };
  return { admin: admin as unknown as SupabaseClient, rpcCalls };
}

const retrieve = vi.fn();
const refundCreate = vi.fn();

function fakeStripe(): Stripe {
  return {
    checkout: { sessions: { retrieve } },
    refunds: { create: refundCreate },
  } as unknown as Stripe;
}

function session(opts: { paid?: boolean; fee?: number | null } = {}) {
  return {
    id: SESSION_ID,
    payment_status: opts.paid === false ? "unpaid" : "paid",
    amount_total: 1999,
    customer_details: { email: "buyer@example.com" },
    metadata: { listing_id: LISTING_ID, hold_token: "h", seller_account_id: "acct_seller_1" },
    payment_intent: {
      id: "pi_test_1",
      application_fee_amount: opts.fee === undefined ? 99 : opts.fee,
      transfer_data: { destination: "acct_seller_1" },
    },
  };
}

beforeEach(() => {
  retrieve.mockReset();
  refundCreate.mockReset();
  retrieve.mockResolvedValue(session());
  refundCreate.mockResolvedValue({ id: "re_test_1" });
});

describe("fulfillCheckoutSession", () => {
  it("records a paid session as an order", async () => {
    const { admin, rpcCalls } = fakeAdmin(["recorded"]);
    const result = await fulfillCheckoutSession(SESSION_ID, { stripe: fakeStripe(), admin });

    expect(result).toEqual({ outcome: "recorded", listingId: LISTING_ID, amountCents: 1999 });
    expect(retrieve).toHaveBeenCalledWith(SESSION_ID, { expand: ["payment_intent"] });
    expect(rpcCalls).toEqual([
      {
        name: "record_paid_order",
        args: {
          p_session_id: SESSION_ID,
          p_payment_intent_id: "pi_test_1",
          p_listing_id: LISTING_ID,
          p_buyer_email: "buyer@example.com",
          p_amount_cents: 1999,
          p_fee_cents: 99,
          p_seller_account_id: "acct_seller_1",
        },
      },
    ]);
  });

  it("returns duplicate without refunding", async () => {
    const { admin } = fakeAdmin(["duplicate"]);
    const result = await fulfillCheckoutSession(SESSION_ID, { stripe: fakeStripe(), admin });
    expect(result.outcome).toBe("duplicate");
    expect(refundCreate).not.toHaveBeenCalled();
  });

  it("refunds a session that lost the listing and marks the order refunded", async () => {
    const { admin, rpcCalls } = fakeAdmin(["refund_pending"]);
    const result = await fulfillCheckoutSession(SESSION_ID, { stripe: fakeStripe(), admin });

    expect(result.outcome).toBe("refunded");
    expect(refundCreate).toHaveBeenCalledTimes(1);
    expect(refundCreate).toHaveBeenCalledWith(
      { payment_intent: "pi_test_1", reverse_transfer: true, refund_application_fee: true },
      { idempotencyKey: `refund:${SESSION_ID}` },
    );
    expect(rpcCalls.map((c) => c.name)).toEqual(["record_paid_order", "mark_order_refunded"]);
    expect(rpcCalls[1].args).toEqual({ p_session_id: SESSION_ID, p_refund_id: "re_test_1" });
  });

  it("retries the refund on a later call when the previous refund failed", async () => {
    const { admin, rpcCalls } = fakeAdmin(["refund_pending", "refund_pending"]);
    refundCreate.mockRejectedValueOnce(new Error("stripe down"));

    await expect(
      fulfillCheckoutSession(SESSION_ID, { stripe: fakeStripe(), admin }),
    ).rejects.toThrow("stripe down");
    expect(rpcCalls.some((c) => c.name === "mark_order_refunded")).toBe(false);

    const result = await fulfillCheckoutSession(SESSION_ID, { stripe: fakeStripe(), admin });
    expect(result.outcome).toBe("refunded");
    expect(refundCreate).toHaveBeenCalledTimes(2);
    expect(rpcCalls.filter((c) => c.name === "mark_order_refunded")).toHaveLength(1);
  });

  it("returns not_paid for an unpaid session without touching the database", async () => {
    retrieve.mockResolvedValue(session({ paid: false }));
    const { admin, rpcCalls } = fakeAdmin([]);
    const result = await fulfillCheckoutSession(SESSION_ID, { stripe: fakeStripe(), admin });
    expect(result.outcome).toBe("not_paid");
    expect(rpcCalls).toEqual([]);
  });

  it("omits refund_application_fee when there was no platform fee", async () => {
    retrieve.mockResolvedValue(session({ fee: null }));
    const { admin } = fakeAdmin(["refund_pending"]);
    await fulfillCheckoutSession(SESSION_ID, { stripe: fakeStripe(), admin });
    expect(refundCreate.mock.calls[0][0]).toEqual({
      payment_intent: "pi_test_1",
      reverse_transfer: true,
    });
  });
});
