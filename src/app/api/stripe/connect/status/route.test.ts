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
  created_at?: string;
};

type ListingRow = { seller_email: string; status: "active" | "sold" };
type ListingsOptions = { listings?: ListingRow[]; countError?: boolean };

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
/** Fake of the head-only exact count query on listings: counts rows matching every .eq(). */
function listingsCount(options: ListingsOptions) {
  return {
    select: (columns: string, opts: { count: string; head: boolean }) => {
      if (columns !== "id" || opts.count !== "exact" || opts.head !== true) {
        throw new Error("unexpected listings select");
      }
      const filters: Array<[keyof ListingRow, string]> = [];
      const builder = {
        eq(column: keyof ListingRow, value: string) {
          filters.push([column, value]);
          return builder;
        },
        then<T>(resolve: (value: { count: number | null; error: { message: string } | null }) => T) {
          const result = options.countError
            ? { count: null, error: { message: "listings down" } }
            : {
                count: (options.listings ?? []).filter((l) =>
                  filters.every(([c, v]) => l[c] === v),
                ).length,
                error: null,
              };
          return Promise.resolve(result).then(resolve);
        },
      };
      return builder;
    },
  };
}

function fakeAdmin(
  rows: Row[],
  deleteCalls: EqCall[][] = [],
  updateCalls: EqCall[][] = [],
  listings: ListingsOptions = {},
) {
  return {
    from(table: string) {
      if (table === "listings") return listingsCount(listings);
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
        stripe_account_id: "acct_1Known9xYz",
        charges_enabled: false,
        payouts_enabled: false,
        details_submitted: false,
        created_at: "2026-03-04T05:06:07.000Z",
      },
    ];
    const updateCalls: EqCall[][] = [];
    const listings: ListingRow[] = [
      { seller_email: "seller@example.com", status: "active" },
      { seller_email: "seller@example.com", status: "active" },
      { seller_email: "seller@example.com", status: "sold" },
      { seller_email: "other@example.com", status: "active" },
    ];
    vi.mocked(getSupabaseAdmin).mockReturnValue(
      fakeAdmin(rows, [], updateCalls, { listings }) as unknown as ReturnType<
        typeof getSupabaseAdmin
      >,
    );

    const res = await GET(get("Seller@Example.com"));

    expect(res.status).toBe(200);
    const flags = {
      charges_enabled: true,
      payouts_enabled: false,
      details_submitted: true,
    };
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({
      status: {
        ...flags,
        account_hint: "•••• 9xYz",
        connected_at: "2026-03-04T05:06:07.000Z",
        active_listings: 2,
      },
    });
    expect(text).not.toContain("stripe_account_id");
    expect(text).not.toContain("acct_");
    expect(text).not.toContain("1Known");
    expect(retrieve).toHaveBeenCalledWith("acct_1Known9xYz", {
      include: ["configuration.recipient", "identity", "requirements"],
    });
    expect(updateCalls).toEqual([
      [
        ["seller_email", "seller@example.com"],
        ["stripe_account_id", "acct_1Known9xYz"],
      ],
    ]);
    expect(rows[0]).toEqual({
      seller_email: "seller@example.com",
      stripe_account_id: "acct_1Known9xYz",
      created_at: "2026-03-04T05:06:07.000Z",
      ...flags,
    });
  });

  it("returns a zero listing count and a null connected_at when there is nothing to report", async () => {
    const rows: Row[] = [
      {
        seller_email: "seller@example.com",
        stripe_account_id: "acct_emptyAB12",
        charges_enabled: false,
        payouts_enabled: false,
        details_submitted: false,
      },
    ];
    vi.mocked(getSupabaseAdmin).mockReturnValue(
      fakeAdmin(rows) as unknown as ReturnType<typeof getSupabaseAdmin>,
    );

    const res = await GET(get("seller@example.com"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status.account_hint).toBe("•••• AB12");
    expect(body.status.connected_at).toBeNull();
    expect(body.status.active_listings).toBe(0);
  });

  it("omits active_listings but still succeeds when the listings count fails", async () => {
    const rows: Row[] = [
      {
        seller_email: "seller@example.com",
        stripe_account_id: "acct_countFail",
        charges_enabled: false,
        payouts_enabled: false,
        details_submitted: false,
      },
    ];
    vi.mocked(getSupabaseAdmin).mockReturnValue(
      fakeAdmin(rows, [], [], { countError: true }) as unknown as ReturnType<
        typeof getSupabaseAdmin
      >,
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await GET(get("seller@example.com"));

    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text);
    expect(body.status).not.toHaveProperty("active_listings");
    expect(body.status.account_hint).toBe("•••• Fail");
    expect(text).not.toContain("acct_countFail");
    expect(error).toHaveBeenCalledWith(
      "stripe connect status failed:",
      "active listings count:",
      "listings down",
    );
    error.mockRestore();
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
