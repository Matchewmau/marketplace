import type { SupabaseClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fulfillCheckoutSession } from "@/lib/fulfillment";
import { AppScopeUnavailableError } from "@/lib/stripe/app-scope";

const LISTING_ID = "11111111-1111-4111-8111-111111111111";
const HOLD_TOKEN = "22222222-2222-4222-8222-222222222222";
const SESSION_ID = "cs_test_paid";
const APP_SCOPE = "xyz.supabase.co";

type RegistryRow = {
  listing_id: string;
  amount_cents: number;
  seller_stripe_account_id: string;
  application_fee_cents: number;
};

const REGISTRY: RegistryRow = {
  listing_id: LISTING_ID,
  amount_cents: 1999,
  seller_stripe_account_id: "acct_seller_1",
  application_fee_cents: 99,
};

type RpcCall = { name: string; args: Record<string, unknown> };

function fakeAdmin(
  recordResults: string[],
  opts: { listingExists?: boolean; markError?: string; registry?: RegistryRow | null } = {},
) {
  const rpcCalls: RpcCall[] = [];
  const listingQueries: unknown[] = [];
  const registryQueries: unknown[] = [];
  const admin = {
    from(table: string) {
      const builder = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          (table === "checkout_sessions" ? registryQueries : listingQueries).push({
            table,
            column,
            value,
          });
          return builder;
        },
        maybeSingle: async () => {
          if (table === "checkout_sessions") {
            return { data: opts.registry === undefined ? REGISTRY : opts.registry, error: null };
          }
          return { data: opts.listingExists === false ? null : { id: LISTING_ID }, error: null };
        },
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
  return { admin: admin as unknown as SupabaseClient, rpcCalls, listingQueries, registryQueries };
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
        : {
            listing_id: LISTING_ID,
            hold_token: HOLD_TOKEN,
            seller_account_id: "acct_seller_1",
            app_scope: APP_SCOPE,
          },
    payment_intent: {
      id: "pi_test_1",
      application_fee_amount: opts.fee === undefined ? 99 : opts.fee,
      transfer_data: { destination: "acct_seller_1" },
    },
  };
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("APP_SCOPE", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", `https://${APP_SCOPE}`);
  retrieve.mockReset();
  refundCreate.mockReset();
  refundList.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {}).mockClear();
  retrieve.mockResolvedValue(session());
  refundCreate.mockResolvedValue({ id: "re_test_1", status: "succeeded" });
  refundList.mockResolvedValue({ data: [] });
});

afterEach(() => {
  vi.unstubAllEnvs();
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
    const { admin } = fakeAdmin(["refund_pending"], {
      registry: { ...REGISTRY, application_fee_cents: 0 },
    });
    await fulfillCheckoutSession(SESSION_ID, { stripe: fakeStripe(), admin });
    expect(refundCreate.mock.calls[0][0]).toEqual({
      payment_intent: "pi_test_1",
      reverse_transfer: true,
    });
  });

  it.each([
    ["no metadata", null],
    ["a missing app_scope", { listing_id: LISTING_ID, seller_account_id: "acct_seller_1" }],
    [
      "another deployment's app_scope",
      { listing_id: LISTING_ID, seller_account_id: "acct_seller_1", app_scope: "other.supabase.co" },
    ],
  ])("ignores a paid session with %s", async (_label, metadata) => {
    retrieve.mockResolvedValue(session({ metadata }));
    const { admin, rpcCalls, listingQueries, registryQueries } = fakeAdmin(["recorded"]);
    const result = await fulfillCheckoutSession(SESSION_ID, { stripe: fakeStripe(), admin });
    expect(result.outcome).toBe("ignored");
    expect(rpcCalls).toEqual([]);
    expect(listingQueries).toEqual([]);
    expect(registryQueries).toEqual([]);
    expect(refundCreate).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("ignores a forged paid session that is not in the registry, without refunding", async () => {
    const { admin, rpcCalls, listingQueries, registryQueries } = fakeAdmin(["recorded"], {
      registry: null,
    });
    const result = await fulfillCheckoutSession(SESSION_ID, { stripe: fakeStripe(), admin });
    expect(result).toEqual({ outcome: "ignored", listingId: null, amountCents: 1999 });
    expect(registryQueries).toEqual([
      { table: "checkout_sessions", column: "stripe_checkout_session_id", value: SESSION_ID },
    ]);
    expect(listingQueries).toEqual([]);
    expect(rpcCalls).toEqual([]);
    expect(refundCreate).not.toHaveBeenCalled();
  });

  it("uses the registry listing, not the metadata listing", async () => {
    const forged = "33333333-3333-4333-8333-333333333333";
    retrieve.mockResolvedValue(
      session({
        metadata: { listing_id: forged, hold_token: HOLD_TOKEN, app_scope: APP_SCOPE },
      }),
    );
    const { admin, rpcCalls } = fakeAdmin(["recorded"]);
    const result = await fulfillCheckoutSession(SESSION_ID, { stripe: fakeStripe(), admin });
    expect(result.listingId).toBe(LISTING_ID);
    expect(rpcCalls[0].args).toMatchObject({
      p_listing_id: LISTING_ID,
      p_amount_cents: 1999,
      p_fee_cents: 99,
      p_seller_account_id: "acct_seller_1",
    });
  });

  it.each([
    ["amount", { ...REGISTRY, amount_cents: 2500 }],
    ["destination", { ...REGISTRY, seller_stripe_account_id: "acct_other" }],
    ["fee", { ...REGISTRY, application_fee_cents: 0 }],
  ])("ignores a registered session whose %s does not match", async (_label, registry) => {
    const { admin, rpcCalls, listingQueries } = fakeAdmin(["recorded"], { registry });
    const result = await fulfillCheckoutSession(SESSION_ID, { stripe: fakeStripe(), admin });
    expect(result.outcome).toBe("ignored");
    expect(rpcCalls).toEqual([]);
    expect(listingQueries).toEqual([]);
    expect(refundCreate).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("treats a missing platform fee as 0 when comparing with the registry", async () => {
    retrieve.mockResolvedValue(session({ fee: null }));
    const { admin } = fakeAdmin(["recorded"], {
      registry: { ...REGISTRY, application_fee_cents: 0 },
    });
    const result = await fulfillCheckoutSession(SESSION_ID, { stripe: fakeStripe(), admin });
    expect(result.outcome).toBe("recorded");
  });

  it("maps an unrecognized record_paid_order result to ignored without refunding", async () => {
    const { admin, rpcCalls } = fakeAdmin(["unrecognized"]);
    const result = await fulfillCheckoutSession(SESSION_ID, { stripe: fakeStripe(), admin });
    expect(result.outcome).toBe("ignored");
    expect(rpcCalls.map((c) => c.name)).toEqual(["record_paid_order"]);
    expect(refundCreate).not.toHaveBeenCalled();
  });

  it("ignores another deployment's session even when its listing is missing here", async () => {
    retrieve.mockResolvedValue(
      session({
        metadata: { listing_id: LISTING_ID, hold_token: HOLD_TOKEN, app_scope: "other.supabase.co" },
      }),
    );
    const { admin, rpcCalls, listingQueries } = fakeAdmin([], { listingExists: false });
    const result = await fulfillCheckoutSession(SESSION_ID, { stripe: fakeStripe(), admin });
    expect(result).toEqual({ outcome: "ignored", listingId: null, amountCents: 1999 });
    expect(listingQueries).toEqual([]);
    expect(rpcCalls).toEqual([]);
    expect(refundCreate).not.toHaveBeenCalled();
  });

  it("ignores an unpaid session from another deployment", async () => {
    retrieve.mockResolvedValue(
      session({ paid: false, metadata: { listing_id: LISTING_ID, app_scope: "other.supabase.co" } }),
    );
    const { admin, rpcCalls } = fakeAdmin([]);
    const result = await fulfillCheckoutSession(SESSION_ID, { stripe: fakeStripe(), admin });
    expect(result.outcome).toBe("ignored");
    expect(rpcCalls).toEqual([]);
  });

  it("throws AppScopeUnavailableError without touching anything when there is no app scope", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    const { admin, rpcCalls, listingQueries } = fakeAdmin(["recorded"]);
    await expect(
      fulfillCheckoutSession(SESSION_ID, { stripe: fakeStripe(), admin }),
    ).rejects.toBeInstanceOf(AppScopeUnavailableError);
    expect(retrieve).not.toHaveBeenCalled();
    expect(listingQueries).toEqual([]);
    expect(rpcCalls).toEqual([]);
    expect(refundCreate).not.toHaveBeenCalled();
  });

  it("never refunds another developer's session when both use the default local Supabase", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    retrieve.mockResolvedValue(
      session({
        metadata: { listing_id: LISTING_ID, hold_token: HOLD_TOKEN, app_scope: "127.0.0.1:54321" },
      }),
    );
    const { admin, rpcCalls, listingQueries } = fakeAdmin([], { listingExists: false });
    await expect(
      fulfillCheckoutSession(SESSION_ID, { stripe: fakeStripe(), admin }),
    ).rejects.toBeInstanceOf(AppScopeUnavailableError);
    expect(retrieve).not.toHaveBeenCalled();
    expect(listingQueries).toEqual([]);
    expect(rpcCalls).toEqual([]);
    expect(refundCreate).not.toHaveBeenCalled();
  });

  it("refunds without recording an order when the listing was deleted", async () => {
    const { admin, rpcCalls, listingQueries } = fakeAdmin(["recorded"], { listingExists: false });
    const result = await fulfillCheckoutSession(SESSION_ID, { stripe: fakeStripe(), admin });
    expect(result).toEqual({
      outcome: "refunded_unavailable",
      listingId: LISTING_ID,
      amountCents: 1999,
    });
    expect(listingQueries).toEqual([{ table: "listings", column: "id", value: LISTING_ID }]);
    expect(refundCreate).toHaveBeenCalledWith(
      { payment_intent: "pi_test_1", reverse_transfer: true, refund_application_fee: true },
      { idempotencyKey: `refund:${SESSION_ID}` },
    );
    expect(rpcCalls).toEqual([]);
  });

  it("omits refund_application_fee for a deleted listing without a platform fee", async () => {
    retrieve.mockResolvedValue(session({ fee: 0 }));
    const { admin } = fakeAdmin([], {
      listingExists: false,
      registry: { ...REGISTRY, application_fee_cents: 0 },
    });
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
