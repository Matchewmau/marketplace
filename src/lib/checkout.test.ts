import type { SupabaseClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  cancelCheckoutHold,
  CHECKOUT_SESSION_TTL_SECONDS,
  createCheckoutForListing,
  HOLD_TTL_SECONDS,
} from "@/lib/checkout";
import { fulfillCheckoutSession } from "@/lib/fulfillment";
import { PURCHASE_REASON_TEXT } from "@/lib/purchase";

vi.mock("@/lib/fulfillment", () => ({ fulfillCheckoutSession: vi.fn() }));

const LISTING_ID = "11111111-1111-4111-8111-111111111111";
const HOLD_TOKEN = "22222222-2222-4222-8222-222222222222";
const SELLER = "seller@example.com";
const ACCOUNT = "acct_seller_1";
const ORIGIN = "https://shop.example.com";
const NOW_MS = Date.UTC(2026, 10, 12, 12, 0, 0);

type Row = Record<string, unknown>;
type RpcCall = { name: string; args: Record<string, unknown> };

/** Chainable fake of the Supabase queries and RPCs used by checkout. */
function fakeAdmin(
  tables: Record<string, Row[]>,
  rpcResults: Record<string, unknown> = {},
  rpcErrors: Record<string, string> = {},
) {
  const rpcCalls: RpcCall[] = [];

  function query(table: string, columns: string) {
    const filters: Array<(row: Row) => boolean> = [];
    const builder = {
      eq(column: string, value: unknown) {
        filters.push((row) => row[column] === value);
        return builder;
      },
      gt(column: string, value: string) {
        filters.push((row) => String(row[column]) > value);
        return builder;
      },
      async maybeSingle() {
        const row = (tables[table] ?? []).find((r) => filters.every((f) => f(r)));
        if (!row) return { data: null, error: null };
        const picked = Object.fromEntries(
          columns.split(",").map((c) => [c.trim(), row[c.trim()]]),
        );
        return { data: picked, error: null };
      },
    };
    return builder;
  }

  const admin = {
    from(table: string) {
      return {
        select: (columns: string) => query(table, columns),
        update: (patch: Row) => {
          const filters: Array<(row: Row) => boolean> = [];
          const builder = {
            eq(column: string, value: unknown) {
              filters.push((row) => row[column] === value);
              return builder;
            },
            then<T>(resolve: (value: { error: null }) => T) {
              for (const r of tables[table] ?? []) {
                if (filters.every((f) => f(r))) Object.assign(r, patch);
              }
              return Promise.resolve({ error: null }).then(resolve);
            },
          };
          return builder;
        },
      };
    },
    async rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args });
      if (name in rpcErrors) {
        return { data: null, error: { message: rpcErrors[name] } };
      }
      return { data: name in rpcResults ? rpcResults[name] : null, error: null };
    },
  };
  return { admin: admin as unknown as SupabaseClient, rpcCalls };
}

function listing(overrides: Row = {}): Row {
  return {
    id: LISTING_ID,
    title: "Desk lamp",
    price: 19.99,
    image_url: "https://images.example.com/lamp.jpg",
    seller_email: "Seller@Example.com ",
    status: "active",
    ...overrides,
  };
}

function sellerRow(): Row {
  return { seller_email: SELLER, stripe_account_id: ACCOUNT, details_submitted: true };
}

const create = vi.fn();
const retrieve = vi.fn();
const expire = vi.fn();
const accountRetrieve = vi.fn();
let transfersStatus = "active";

function fakeStripe(): Stripe {
  return {
    checkout: { sessions: { create, retrieve, expire } },
    v2: { core: { accounts: { retrieve: accountRetrieve } } },
  } as unknown as Stripe;
}

beforeEach(() => {
  create.mockReset();
  retrieve.mockReset();
  expire.mockReset();
  accountRetrieve.mockReset();
  vi.mocked(fulfillCheckoutSession).mockReset();
  vi.mocked(fulfillCheckoutSession).mockResolvedValue({
    outcome: "recorded",
    listingId: LISTING_ID,
    amountCents: 1999,
  });
  expire.mockImplementation(async (id: string) => ({ id, status: "expired", url: null }));
  transfersStatus = "active";
  vi.spyOn(console, "error").mockImplementation(() => {}).mockClear();
  create.mockImplementation(async () => ({
    id: "cs_test_new",
    url: "https://checkout.stripe.com/c/pay/cs_test_new",
  }));
  accountRetrieve.mockImplementation(async (id: string) => ({
    id,
    object: "v2.core.account",
    configuration: {
      recipient: {
        applied: true,
        capabilities: {
          stripe_balance: { stripe_transfers: { status: transfersStatus, status_details: [] } },
        },
      },
    },
    requirements: { entries: [] },
  }));
});

function setup(
  opts: {
    listing?: Row | null;
    holds?: Row[];
    reserve?: boolean;
    rpcErrors?: Record<string, string>;
  } = {},
) {
  return fakeAdmin(
    {
      listings: opts.listing === null ? [] : [opts.listing ?? listing()],
      seller_accounts: [sellerRow()],
      listing_holds: opts.holds ?? [],
    },
    { reserve_listing: opts.reserve ?? true },
    opts.rpcErrors,
  );
}

function holdRow(sessionId: string | null): Row {
  return {
    listing_id: LISTING_ID,
    hold_token: HOLD_TOKEN,
    checkout_session_id: sessionId,
    expires_at: new Date(NOW_MS + 600_000).toISOString(),
  };
}

function deps(admin: SupabaseClient, feeBps = 0) {
  return { stripe: fakeStripe(), admin, feeBps, now: () => NOW_MS };
}

describe("createCheckoutForListing", () => {
  it("rejects an invalid listing id with 400", async () => {
    const { admin } = setup();
    const result = await createCheckoutForListing("not-a-uuid", ORIGIN, deps(admin));
    expect(result).toEqual({ ok: false, status: 400, error: "Invalid listing." });
    expect(create).not.toHaveBeenCalled();
  });

  it("blocks a free listing with 409 free", async () => {
    const { admin, rpcCalls } = setup({ listing: listing({ price: 0 }) });
    const result = await createCheckoutForListing(LISTING_ID, ORIGIN, deps(admin));
    expect(result).toMatchObject({ ok: false, status: 409, reason: "free" });
    expect(rpcCalls).toEqual([]);
  });

  it("charges the DB price in cents and creates a session with a fresh hold", async () => {
    const { admin, rpcCalls } = setup();
    const result = await createCheckoutForListing(LISTING_ID, ORIGIN, deps(admin));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.url).toBe("https://checkout.stripe.com/c/pay/cs_test_new");
    const [params, options] = create.mock.calls[0];
    expect(params.line_items[0].price_data.unit_amount).toBe(1999);
    expect(params.line_items[0].price_data.product_data).toEqual({
      name: "Desk lamp",
      images: ["https://images.example.com/lamp.jpg"],
    });
    expect(params.allowed_payment_method_types).toEqual(["card"]);
    expect(params.client_reference_id).toBe(LISTING_ID);
    expect(params.success_url).toBe(
      `${ORIGIN}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    );
    const metadata = {
      listing_id: LISTING_ID,
      hold_token: result.holdToken,
      seller_account_id: ACCOUNT,
    };
    expect(params.metadata).toEqual(metadata);
    expect(params.payment_intent_data.metadata).toEqual(metadata);
    expect(params.cancel_url).toBe(
      `${ORIGIN}/checkout/cancel?listing=${LISTING_ID}&hold=${result.holdToken}`,
    );
    expect(options).toEqual({ idempotencyKey: `checkout:${result.holdToken}` });
    expect(rpcCalls.map((c) => c.name)).toEqual(["reserve_listing", "attach_hold_session"]);
    expect(rpcCalls[0].args).toEqual({
      p_listing_id: LISTING_ID,
      p_hold_token: result.holdToken,
      p_ttl_seconds: HOLD_TTL_SECONDS,
    });
  });

  it("blocks with 409 seller_not_onboarded when transfers are not active", async () => {
    transfersStatus = "pending";
    const { admin, rpcCalls } = setup();
    const result = await createCheckoutForListing(LISTING_ID, ORIGIN, deps(admin));
    expect(result).toMatchObject({ ok: false, status: 409, reason: "seller_not_onboarded" });
    expect(rpcCalls).toEqual([]);
  });

  it("returns 409 reserved and does not create a session when the hold is taken", async () => {
    const { admin } = setup({ reserve: false });
    const result = await createCheckoutForListing(LISTING_ID, ORIGIN, deps(admin));
    expect(result).toMatchObject({ ok: false, status: 409, reason: "reserved" });
    expect(create).not.toHaveBeenCalled();
  });

  it("releases the same hold and returns 502 when session creation throws", async () => {
    create.mockRejectedValue(new Error("boom sk_test_secret123"));
    const { admin, rpcCalls } = setup();
    const result = await createCheckoutForListing(LISTING_ID, ORIGIN, deps(admin));

    expect(result).toEqual({
      ok: false,
      status: 502,
      error: "Could not start checkout. Try again.",
    });
    const reserve = rpcCalls.find((c) => c.name === "reserve_listing");
    const release = rpcCalls.find((c) => c.name === "release_listing_hold");
    expect(release?.args).toEqual({
      p_listing_id: LISTING_ID,
      p_hold_token: reserve?.args.p_hold_token,
    });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("sk_test_secret123");
  });

  it("adds a 500 bps platform fee of 99 cents on 1999", async () => {
    const { admin } = setup();
    await createCheckoutForListing(LISTING_ID, ORIGIN, deps(admin, 500));
    expect(create.mock.calls[0][0].payment_intent_data.application_fee_amount).toBe(99);
  });

  it("omits application_fee_amount when the fee is 0", async () => {
    const { admin } = setup();
    await createCheckoutForListing(LISTING_ID, ORIGIN, deps(admin, 0));
    expect(create.mock.calls[0][0].payment_intent_data).not.toHaveProperty(
      "application_fee_amount",
    );
  });

  it("routes funds to the seller account and expires the session after the TTL", async () => {
    const { admin } = setup();
    await createCheckoutForListing(LISTING_ID, ORIGIN, deps(admin));
    const params = create.mock.calls[0][0];
    expect(params.payment_intent_data.transfer_data).toEqual({ destination: ACCOUNT });
    expect(params.expires_at - Math.floor(NOW_MS / 1000)).toBe(1980);
    expect(CHECKOUT_SESSION_TTL_SECONDS).toBe(1980);
    expect(HOLD_TTL_SECONDS).toBeGreaterThan(CHECKOUT_SESSION_TTL_SECONDS);
  });

  it("resumes an open session for a matching hold without reserving again", async () => {
    retrieve.mockResolvedValue({
      id: "cs_test_open",
      status: "open",
      url: "https://checkout.stripe.com/c/pay/cs_test_open",
    });
    const { admin, rpcCalls } = setup({
      holds: [
        {
          listing_id: LISTING_ID,
          hold_token: HOLD_TOKEN,
          checkout_session_id: "cs_test_open",
          expires_at: new Date(NOW_MS + 600_000).toISOString(),
        },
      ],
    });

    const result = await createCheckoutForListing(LISTING_ID, ORIGIN, deps(admin), HOLD_TOKEN);

    expect(result).toEqual({
      ok: true,
      url: "https://checkout.stripe.com/c/pay/cs_test_open",
      holdToken: HOLD_TOKEN,
    });
    expect(retrieve).toHaveBeenCalledWith("cs_test_open");
    expect(rpcCalls.some((c) => c.name === "reserve_listing")).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it("releases an expired session's hold and reserves anew", async () => {
    retrieve.mockResolvedValue({ id: "cs_test_old", status: "expired", url: null });
    const { admin, rpcCalls } = setup({
      holds: [
        {
          listing_id: LISTING_ID,
          hold_token: HOLD_TOKEN,
          checkout_session_id: "cs_test_old",
          expires_at: new Date(NOW_MS + 600_000).toISOString(),
        },
      ],
    });

    const result = await createCheckoutForListing(LISTING_ID, ORIGIN, deps(admin), HOLD_TOKEN);

    expect(result.ok).toBe(true);
    expect(rpcCalls.map((c) => c.name)).toEqual([
      "release_listing_hold",
      "reserve_listing",
      "attach_hold_session",
    ]);
    expect(rpcCalls[0].args).toEqual({ p_listing_id: LISTING_ID, p_hold_token: HOLD_TOKEN });
    expect(rpcCalls[1].args.p_hold_token).not.toBe(HOLD_TOKEN);
  });

  it("returns 404 when the listing does not exist", async () => {
    const { admin, rpcCalls } = setup({ listing: null });
    const result = await createCheckoutForListing(LISTING_ID, ORIGIN, deps(admin));
    expect(result).toEqual({ ok: false, status: 404, error: "Listing not found." });
    expect(rpcCalls).toEqual([]);
    expect(create).not.toHaveBeenCalled();
  });

  it("returns 500 when reserve_listing fails", async () => {
    const { admin } = setup({ rpcErrors: { reserve_listing: "db down" } });
    const result = await createCheckoutForListing(LISTING_ID, ORIGIN, deps(admin));
    expect(result).toEqual({ ok: false, status: 500, error: "Could not start checkout." });
    expect(create).not.toHaveBeenCalled();
  });

  it("returns 409 seller_not_onboarded when the seller's Stripe account is gone", async () => {
    accountRetrieve.mockRejectedValue(
      new Stripe.errors.StripeInvalidRequestError({
        type: "invalid_request_error",
        code: "resource_missing",
        message: "No such account",
      }),
    );
    const { admin, rpcCalls } = setup();
    const result = await createCheckoutForListing(LISTING_ID, ORIGIN, deps(admin));
    expect(result).toEqual({
      ok: false,
      status: 409,
      error: PURCHASE_REASON_TEXT.seller_not_onboarded,
      reason: "seller_not_onboarded",
    });
    expect(rpcCalls).toEqual([]);
  });

  it("returns 502 and logs redacted when refreshing the seller hits a Stripe error", async () => {
    accountRetrieve.mockRejectedValue(
      new Stripe.errors.StripeAPIError({ type: "api_error", message: "down sk_test_secret123" }),
    );
    const { admin, rpcCalls } = setup();
    const result = await createCheckoutForListing(LISTING_ID, ORIGIN, deps(admin));
    expect(result).toEqual({
      ok: false,
      status: 502,
      error: "Could not start checkout. Try again.",
    });
    expect(rpcCalls).toEqual([]);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("sk_test_secret123");
  });

  it("expires the session, releases the hold and returns 502 when attaching fails", async () => {
    const { admin, rpcCalls } = setup({ rpcErrors: { attach_hold_session: "db down" } });
    const result = await createCheckoutForListing(LISTING_ID, ORIGIN, deps(admin));
    expect(result).toEqual({
      ok: false,
      status: 502,
      error: "Could not start checkout. Try again.",
    });
    expect(expire).toHaveBeenCalledWith("cs_test_new");
    const reserve = rpcCalls.find((c) => c.name === "reserve_listing");
    expect(rpcCalls.map((c) => c.name)).toEqual([
      "reserve_listing",
      "attach_hold_session",
      "release_listing_hold",
    ]);
    expect(rpcCalls[2].args).toEqual({
      p_listing_id: LISTING_ID,
      p_hold_token: reserve?.args.p_hold_token,
    });
  });

  it("still releases the hold when expiring after a failed attach throws", async () => {
    expire.mockRejectedValue(new Error("stripe down"));
    const { admin, rpcCalls } = setup({ rpcErrors: { attach_hold_session: "db down" } });
    const result = await createCheckoutForListing(LISTING_ID, ORIGIN, deps(admin));
    expect(result).toMatchObject({ ok: false, status: 502 });
    expect(rpcCalls.some((c) => c.name === "release_listing_hold")).toBe(true);
  });

  it("expires an open session without a url, releases the own hold and reserves anew", async () => {
    retrieve.mockResolvedValue({ id: "cs_test_nourl", status: "open", url: null });
    const { admin, rpcCalls } = setup({ holds: [holdRow("cs_test_nourl")] });

    const result = await createCheckoutForListing(LISTING_ID, ORIGIN, deps(admin), HOLD_TOKEN);

    expect(result.ok).toBe(true);
    expect(expire).toHaveBeenCalledWith("cs_test_nourl");
    expect(rpcCalls.map((c) => c.name)).toEqual([
      "release_listing_hold",
      "reserve_listing",
      "attach_hold_session",
    ]);
    expect(rpcCalls[0].args).toEqual({ p_listing_id: LISTING_ID, p_hold_token: HOLD_TOKEN });
  });
});

describe("cancelCheckoutHold", () => {
  function cancelDeps(admin: SupabaseClient) {
    return { stripe: fakeStripe(), admin };
  }

  it("expires an open session, releases the hold and reports cancelled", async () => {
    retrieve.mockResolvedValue({ id: "cs_test_open", status: "open", url: "https://x" });
    const { admin, rpcCalls } = setup({ holds: [holdRow("cs_test_open")] });
    const result = await cancelCheckoutHold(LISTING_ID, HOLD_TOKEN, cancelDeps(admin));
    expect(result).toBe("cancelled");
    expect(expire).toHaveBeenCalledWith("cs_test_open");
    expect(rpcCalls).toEqual([
      { name: "release_listing_hold", args: { p_listing_id: LISTING_ID, p_hold_token: HOLD_TOKEN } },
    ]);
  });

  it("releases the hold of an already expired session without expiring again", async () => {
    retrieve.mockResolvedValue({ id: "cs_test_old", status: "expired", url: null });
    const { admin, rpcCalls } = setup({ holds: [holdRow("cs_test_old")] });
    const result = await cancelCheckoutHold(LISTING_ID, HOLD_TOKEN, cancelDeps(admin));
    expect(result).toBe("cancelled");
    expect(expire).not.toHaveBeenCalled();
    expect(rpcCalls.map((c) => c.name)).toEqual(["release_listing_hold"]);
  });

  it("keeps the hold and reports unknown when expiring fails", async () => {
    retrieve.mockResolvedValue({ id: "cs_test_open", status: "open", url: "https://x" });
    expire.mockRejectedValue(new Error("stripe down sk_test_secret123"));
    const { admin, rpcCalls } = setup({ holds: [holdRow("cs_test_open")] });
    const result = await cancelCheckoutHold(LISTING_ID, HOLD_TOKEN, cancelDeps(admin));
    expect(result).toBe("unknown");
    expect(rpcCalls).toEqual([]);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("sk_test_secret123");
  });

  it("keeps the hold and reports unknown when retrieving the session fails", async () => {
    retrieve.mockRejectedValue(new Error("stripe down"));
    const { admin, rpcCalls } = setup({ holds: [holdRow("cs_test_open")] });
    const result = await cancelCheckoutHold(LISTING_ID, HOLD_TOKEN, cancelDeps(admin));
    expect(result).toBe("unknown");
    expect(expire).not.toHaveBeenCalled();
    expect(rpcCalls).toEqual([]);
  });

  it("fulfils a completed session, keeps the hold and reports already_paid", async () => {
    retrieve.mockResolvedValue({ id: "cs_test_paid", status: "complete", url: null });
    const { admin, rpcCalls } = setup({ holds: [holdRow("cs_test_paid")] });
    const result = await cancelCheckoutHold(LISTING_ID, HOLD_TOKEN, cancelDeps(admin));
    expect(result).toBe("already_paid");
    expect(fulfillCheckoutSession).toHaveBeenCalledWith("cs_test_paid", expect.anything());
    expect(expire).not.toHaveBeenCalled();
    expect(rpcCalls).toEqual([]);
  });

  it("still reports already_paid when fulfilment throws", async () => {
    retrieve.mockResolvedValue({ id: "cs_test_paid", status: "complete", url: null });
    vi.mocked(fulfillCheckoutSession).mockRejectedValue(new Error("db down"));
    const { admin, rpcCalls } = setup({ holds: [holdRow("cs_test_paid")] });
    const result = await cancelCheckoutHold(LISTING_ID, HOLD_TOKEN, cancelDeps(admin));
    expect(result).toBe("already_paid");
    expect(rpcCalls).toEqual([]);
    expect(console.error).toHaveBeenCalled();
  });

  it("releases a hold without a session and reports cancelled", async () => {
    const { admin, rpcCalls } = setup({ holds: [holdRow(null)] });
    const result = await cancelCheckoutHold(LISTING_ID, HOLD_TOKEN, cancelDeps(admin));
    expect(result).toBe("cancelled");
    expect(retrieve).not.toHaveBeenCalled();
    expect(rpcCalls.map((c) => c.name)).toEqual(["release_listing_hold"]);
  });

  it("reports unknown when the hold no longer exists", async () => {
    const { admin, rpcCalls } = setup();
    const result = await cancelCheckoutHold(LISTING_ID, HOLD_TOKEN, cancelDeps(admin));
    expect(result).toBe("unknown");
    expect(rpcCalls).toEqual([]);
  });
});
