import type { SupabaseClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fulfillCheckoutSession } from "@/lib/fulfillment";

const LISTING_ID = "11111111-1111-4111-8111-111111111111";
const HOLD_TOKEN = "22222222-2222-4222-8222-222222222222";
const SESSION_ID = "cs_test_paid";

type RpcCall = { name: string; args: Record<string, unknown> };

function fakeAdmin(
  recordResults: string[],
  opts: { listingExists?: boolean; markError?: string } = {},
) {
  const rpcCalls: RpcCall[] = [];
  const listingQueries: unknown[] = [];
  const admin = {
    from(table: string) {
      const builder = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          listingQueries.push({ table, column, value });
          return builder;
        },
        maybeSingle: async () => ({
          data: opts.listingExists === false ? null : { id: LISTING_ID },
          error: null,
        }),
      };
      return builder;
    },
    async rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args });
      if (name === "record_paid_order") {
        return { data: recordResults.shift() ?? null, error: null };
      }
      if (name === "mark_order_refunded" && opts.markError) {
        return { data: null, error: { message: opts.markError } };
      }
      return { data: null, error: null };
    },
  };
  return { admin: admin as unknown as SupabaseClient, rpcCalls, listingQueries };
}

const retrieve = vi.fn();
const refundCreate = vi.fn();
const refundList = vi.fn();

function fakeStripe(): Stripe {
  return {
    checkout: { sessions: { retrieve } },
    refunds: { create: refundCreate, list: refundList },
  } as unknown as Stripe;
}

function alreadyRefunded() {
  return new Stripe.errors.StripeInvalidRequestError({
    type: "invalid_request_error",
    code: "charge_already_refunded",
    message: "Charge ch_1 has already been refunded.",
  });
}

function session(
  opts: { paid?: boolean; fee?: number | null; metadata?: Record<string, string> | null } = {},
) {
  return {
    id: SESSION_ID,
    payment_status: opts.paid === false ? "unpaid" : "paid",
    amount_total: 1999,
    customer_details: { email: "buyer@example.com" },
    metadata:
      opts.metadata !== undefined
        ? opts.metadata
        : { listing_id: LISTING_ID, hold_token: HOLD_TOKEN, seller_account_id: "acct_seller_1" },
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
  refundList.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {}).mockClear();
  retrieve.mockResolvedValue(session());
  refundCreate.mockResolvedValue({ id: "re_test_1", status: "succeeded" });
  refundList.mockResolvedValue({ data: [] });
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

  it("returns refunded for an already-refunded order without refunding again", async () => {
    const { admin, rpcCalls } = fakeAdmin(["refunded"]);
    const result = await fulfillCheckoutSession(SESSION_ID, { stripe: fakeStripe(), admin });
    expect(result).toEqual({ outcome: "refunded", listingId: LISTING_ID, amountCents: 1999 });
    expect(refundCreate).not.toHaveBeenCalled();
    expect(rpcCalls.map((c) => c.name)).toEqual(["record_paid_order"]);
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

  it.each([
    ["no metadata", null],
    ["a non-uuid listing_id", { listing_id: "abc", hold_token: HOLD_TOKEN }],
    ["a missing hold_token", { listing_id: LISTING_ID }],
    ["a non-uuid hold_token", { listing_id: LISTING_ID, hold_token: "h" }],
  ])("ignores a paid session with %s", async (_label, metadata) => {
    retrieve.mockResolvedValue(session({ metadata }));
    const { admin, rpcCalls, listingQueries } = fakeAdmin(["recorded"]);
    const result = await fulfillCheckoutSession(SESSION_ID, { stripe: fakeStripe(), admin });
    expect(result.outcome).toBe("ignored");
    expect(rpcCalls).toEqual([]);
    expect(listingQueries).toEqual([]);
    expect(refundCreate).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("refunds without recording an order when the listing was deleted", async () => {
    const { admin, rpcCalls, listingQueries } = fakeAdmin(["recorded"], { listingExists: false });
    const result = await fulfillCheckoutSession(SESSION_ID, { stripe: fakeStripe(), admin });
    expect(result).toEqual({ outcome: "refunded", listingId: LISTING_ID, amountCents: 1999 });
    expect(listingQueries).toEqual([{ table: "listings", column: "id", value: LISTING_ID }]);
    expect(refundCreate).toHaveBeenCalledWith(
      { payment_intent: "pi_test_1", reverse_transfer: true, refund_application_fee: true },
      { idempotencyKey: `refund:${SESSION_ID}` },
    );
    expect(rpcCalls).toEqual([]);
  });

  it("omits refund_application_fee for a deleted listing without a platform fee", async () => {
    retrieve.mockResolvedValue(session({ fee: 0 }));
    const { admin } = fakeAdmin([], { listingExists: false });
    await fulfillCheckoutSession(SESSION_ID, { stripe: fakeStripe(), admin });
    expect(refundCreate.mock.calls[0][0]).toEqual({
      payment_intent: "pi_test_1",
      reverse_transfer: true,
    });
  });

  it("throws when marking the order refunded fails", async () => {
    const { admin } = fakeAdmin(["refund_pending"], { markError: "db down" });
    await expect(
      fulfillCheckoutSession(SESSION_ID, { stripe: fakeStripe(), admin }),
    ).rejects.toThrow("Failed to mark order refunded: db down");
  });

  it("reuses a refund made by hand in the Dashboard", async () => {
    refundCreate.mockRejectedValue(alreadyRefunded());
    refundList.mockResolvedValue({ data: [{ id: "re_manual", status: "succeeded" }] });
    const { admin, rpcCalls } = fakeAdmin(["refund_pending"]);
    const result = await fulfillCheckoutSession(SESSION_ID, { stripe: fakeStripe(), admin });
    expect(result.outcome).toBe("refunded");
    expect(refundList).toHaveBeenCalledWith({ payment_intent: "pi_test_1", limit: 1 });
    expect(rpcCalls[1]).toEqual({
      name: "mark_order_refunded",
      args: { p_session_id: SESSION_ID, p_refund_id: "re_manual" },
    });
  });

  it("throws when the charge is reported refunded but no refund is listed", async () => {
    refundCreate.mockRejectedValue(alreadyRefunded());
    const { admin, rpcCalls } = fakeAdmin(["refund_pending"]);
    await expect(
      fulfillCheckoutSession(SESSION_ID, { stripe: fakeStripe(), admin }),
    ).rejects.toThrow("no refund was found");
    expect(rpcCalls.some((c) => c.name === "mark_order_refunded")).toBe(false);
  });

  it.each(["failed", "canceled"])(
    "throws and does not mark refunded when the created refund is %s",
    async (status) => {
      refundCreate.mockResolvedValue({ id: "re_bad", status });
      const { admin, rpcCalls } = fakeAdmin(["refund_pending"]);
      await expect(
        fulfillCheckoutSession(SESSION_ID, { stripe: fakeStripe(), admin }),
      ).rejects.toThrow(`Refund re_bad is ${status}.`);
      expect(rpcCalls.some((c) => c.name === "mark_order_refunded")).toBe(false);
    },
  );

  it("throws when the listed Dashboard refund failed", async () => {
    refundCreate.mockRejectedValue(alreadyRefunded());
    refundList.mockResolvedValue({ data: [{ id: "re_manual", status: "failed" }] });
    const { admin, rpcCalls } = fakeAdmin(["refund_pending"]);
    await expect(
      fulfillCheckoutSession(SESSION_ID, { stripe: fakeStripe(), admin }),
    ).rejects.toThrow("Refund re_manual is failed.");
    expect(rpcCalls.some((c) => c.name === "mark_order_refunded")).toBe(false);
  });
});
