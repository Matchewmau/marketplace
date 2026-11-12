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

/** Minimal chainable fake of the seller_accounts queries used by the route. */
function fakeAdmin(rows: Row[]) {
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
        update: (patch: Partial<Row>) => ({
          eq: async (column: keyof Row, value: string) => {
            for (const r of rows) if (r[column] === value) Object.assign(r, patch);
            return { error: null };
          },
        }),
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
    vi.mocked(getSupabaseAdmin).mockReturnValue(
      fakeAdmin(rows) as unknown as ReturnType<typeof getSupabaseAdmin>,
    );

    const res = await GET(get("Seller@Example.com"));

    expect(res.status).toBe(200);
    const expected = {
      stripe_account_id: "acct_known",
      charges_enabled: true,
      payouts_enabled: false,
      details_submitted: true,
    };
    expect(await res.json()).toEqual({ status: expected });
    expect(retrieve).toHaveBeenCalledWith("acct_known", {
      include: ["configuration.recipient", "requirements"],
    });
    expect(rows[0]).toEqual({ seller_email: "seller@example.com", ...expected });
  });
});
