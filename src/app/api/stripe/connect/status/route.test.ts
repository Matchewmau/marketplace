import Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getStripe } from "@/lib/stripe/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

import { GET } from "./route";

vi.mock("@/lib/supabase-admin", () => ({ getSupabaseAdmin: vi.fn() }));
vi.mock("@/lib/stripe/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/stripe/server")>()),
  getStripe: vi.fn(),
}));

type Row = {
  seller_email: string;
  stripe_account_id: string;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
};

type EqCall = [keyof Row, string];

/** Thenable filter chain: applies the action to rows matching every .eq() once awaited. */
function filterChain(rows: Row[], calls: EqCall[][], apply: (index: number) => void) {
  const filters: EqCall[] = [];
  calls.push(filters);
  const builder = {
    eq(column: keyof Row, value: string) {
      filters.push([column, value]);
      return builder;
    },
    then<T>(resolve: (value: { error: null }) => T) {
      for (let i = rows.length - 1; i >= 0; i--) {
        if (filters.every(([c, v]) => rows[i][c] === v)) apply(i);
      }
      return Promise.resolve({ error: null }).then(resolve);
    },
  };
  return builder;
}

/** Minimal chainable fake of the seller_accounts queries used by the route. */
function fakeAdmin(rows: Row[], deleteCalls: EqCall[][] = [], updateCalls: EqCall[][] = []) {
  return {
    from(table: string) {
      if (table !== "seller_accounts") throw new Error(`unexpected table ${table}`);
      return {
        select: (columns: string) => ({
          eq: (column: keyof Row, value: string) => ({
            maybeSingle: async () => {
              const row = rows.find((r) => r[column] === value);
              if (!row) return { data: null, error: null };
              const picked = Object.fromEntries(
                columns.split(",").map((c) => [c.trim(), row[c.trim() as keyof Row]]),
              );
              return { data: picked, error: null };
            },
          }),
        }),
        update: (patch: Partial<Row>) =>
          filterChain(rows, updateCalls, (i) => Object.assign(rows[i], patch)),
        delete: () => filterChain(rows, deleteCalls, (i) => rows.splice(i, 1)),
      };
    },
  };
}

const retrieve = vi.fn();

beforeEach(() => {
  vi.mocked(getSupabaseAdmin).mockReset();
  vi.mocked(getStripe).mockReset();
  retrieve.mockReset();
  retrieve.mockImplementation(async (id: string) => ({
    id,
    object: "v2.core.account",
    configuration: {
      recipient: {
        applied: true,
        capabilities: {
          stripe_balance: {
            stripe_transfers: { status: "active", status_details: [] },
            payouts: { status: "pending", status_details: [] },
          },
        },
      },
    },
    requirements: { entries: [] },
  }));
  vi.mocked(getStripe).mockReturnValue({
    v2: { core: { accounts: { retrieve } } },
  } as unknown as ReturnType<typeof getStripe>);
});

function get(email: string) {
  return new Request(
    `http://localhost:3000/api/stripe/connect/status?email=${encodeURIComponent(email)}`,
  );
}

describe("GET /api/stripe/connect/status", () => {
  it("rejects an invalid email with 400", async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue(
      fakeAdmin([]) as unknown as ReturnType<typeof getSupabaseAdmin>,
    );
    const res = await GET(get("nope"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Enter a valid email address." });
  });

  it("returns a null status for an unknown email", async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue(
      fakeAdmin([]) as unknown as ReturnType<typeof getSupabaseAdmin>,
    );
    const res = await GET(get("unknown@example.com"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: null });
    expect(retrieve).not.toHaveBeenCalled();
  });

  it("refreshes a known account from Stripe and updates the row", async () => {
    const rows: Row[] = [
      {
        seller_email: "seller@example.com",
        stripe_account_id: "acct_known",
        charges_enabled: false,
        payouts_enabled: false,
        details_submitted: false,
      },
    ];
    const updateCalls: EqCall[][] = [];
    vi.mocked(getSupabaseAdmin).mockReturnValue(
      fakeAdmin(rows, [], updateCalls) as unknown as ReturnType<typeof getSupabaseAdmin>,
    );

    const res = await GET(get("Seller@Example.com"));

    expect(res.status).toBe(200);
    const expected = {
      charges_enabled: true,
      payouts_enabled: false,
      details_submitted: true,
    };
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ status: expected });
    expect(text).not.toContain("stripe_account_id");
    expect(text).not.toContain("acct_known");
    expect(retrieve).toHaveBeenCalledWith("acct_known", {
      include: ["configuration.recipient", "identity", "requirements"],
    });
    expect(updateCalls).toEqual([
      [
        ["seller_email", "seller@example.com"],
        ["stripe_account_id", "acct_known"],
      ],
    ]);
    expect(rows[0]).toEqual({
      seller_email: "seller@example.com",
      stripe_account_id: "acct_known",
      ...expected,
    });
  });

  it("unbinds the email and returns a null status when the account no longer exists", async () => {
    const rows: Row[] = [
      {
        seller_email: "seller@example.com",
        stripe_account_id: "acct_gone",
        charges_enabled: false,
        payouts_enabled: false,
        details_submitted: false,
      },
    ];
    const deleteCalls: EqCall[][] = [];
    vi.mocked(getSupabaseAdmin).mockReturnValue(
      fakeAdmin(rows, deleteCalls) as unknown as ReturnType<typeof getSupabaseAdmin>,
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    retrieve.mockRejectedValue(
      new Stripe.errors.StripeInvalidRequestError({
        code: "resource_missing",
        message: "No such account",
        type: "invalid_request_error",
      }),
    );

    const res = await GET(get("seller@example.com"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: null });
    expect(rows).toEqual([]);
    expect(deleteCalls).toEqual([
      [
        ["seller_email", "seller@example.com"],
        ["stripe_account_id", "acct_gone"],
      ],
    ]);
    expect(warn).toHaveBeenCalledWith("stripe connect: unbinding missing account", {
      accountId: "acct_gone",
    });
    warn.mockRestore();
  });

  it("returns 500 with a redacted log when the admin client throws", async () => {
    vi.mocked(getSupabaseAdmin).mockImplementation(() => {
      throw new Error("bad key sk_test_secret123");
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await GET(get("seller@example.com"));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Could not load payout settings." });
    expect(error).toHaveBeenCalledWith("stripe connect status failed:", "bad key [redacted]");
    error.mockRestore();
  });
});
