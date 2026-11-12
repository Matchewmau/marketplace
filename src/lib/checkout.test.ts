import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CHECKOUT_SESSION_TTL_SECONDS,
  createCheckoutForListing,
  HOLD_TTL_SECONDS,
} from "@/lib/checkout";

const LISTING_ID = "11111111-1111-4111-8111-111111111111";
const HOLD_TOKEN = "22222222-2222-4222-8222-222222222222";
const SELLER = "seller@example.com";
const ACCOUNT = "acct_seller_1";
const ORIGIN = "https://shop.example.com";
const NOW_MS = Date.UTC(2026, 10, 12, 12, 0, 0);

type Row = Record<string, unknown>;
type RpcCall = { name: string; args: Record<string, unknown> };

/** Chainable fake of the Supabase queries and RPCs used by checkout. */
function fakeAdmin(tables: Record<string, Row[]>, rpcResults: Record<string, unknown> = {}) {
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
        update: (patch: Row) => ({
          eq: async (column: string, value: unknown) => {
            for (const r of tables[table] ?? []) if (r[column] === value) Object.assign(r, patch);
            return { error: null };
          },
        }),
      };
    },
    async rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args });
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
const accountRetrieve = vi.fn();
let transfersStatus = "active";

function fakeStripe(): Stripe {
  return {
    checkout: { sessions: { create, retrieve } },
    v2: { core: { accounts: { retrieve: accountRetrieve } } },
  } as unknown as Stripe;
}

beforeEach(() => {
  create.mockReset();
  retrieve.mockReset();
  accountRetrieve.mockReset();
  transfersStatus = "active";
  vi.spyOn(console, "error").mockImplementation(() => {});
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

function setup(opts: { listing?: Row; holds?: Row[]; reserve?: boolean } = {}) {
  return fakeAdmin(
    {
      listings: [opts.listing ?? listing()],
      seller_accounts: [sellerRow()],
      listing_holds: opts.holds ?? [],
    },
    { reserve_listing: opts.reserve ?? true },
  );
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
    expect(params.metadata.hold_token).toBe(result.holdToken);
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
    expect(params.expires_at - Math.floor(NOW_MS / 1000)).toBe(1860);
    expect(CHECKOUT_SESSION_TTL_SECONDS).toBe(1860);
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
});
