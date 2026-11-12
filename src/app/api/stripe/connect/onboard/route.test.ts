import { beforeEach, describe, expect, it, vi } from "vitest";

import { getStripe } from "@/lib/stripe/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

import { POST } from "./route";

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

type DbError = { code: string; message: string };

/** Minimal chainable fake of the seller_accounts queries used by the route. */
function fakeAdmin(rows: Row[], hooks: { onInsert?: (row: Partial<Row>) => DbError | null } = {}) {
  const inserted: Partial<Row>[] = [];
  const admin = {
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
        insert: async (row: Partial<Row>) => {
          const error = hooks.onInsert?.(row) ?? null;
          if (error) return { error };
          inserted.push(row);
          rows.push({
            charges_enabled: false,
            payouts_enabled: false,
            details_submitted: false,
            ...row,
          } as Row);
          return { error: null };
        },
        update: (patch: Partial<Row>) => ({
          eq: async (column: keyof Row, value: string) => {
            for (const r of rows) if (r[column] === value) Object.assign(r, patch);
            return { error: null };
          },
        }),
      };
    },
  };
  return { admin, inserted };
}

function fakeStripe() {
  return {
    v2: {
      core: {
        accounts: {
          create: vi.fn().mockResolvedValue({ id: "acct_new" }),
          retrieve: vi.fn().mockImplementation(async (id: string) => ({
            id,
            object: "v2.core.account",
            configuration: {
              recipient: {
                applied: true,
                capabilities: {
                  stripe_balance: { stripe_transfers: { status: "active", status_details: [] } },
                },
              },
            },
            requirements: { entries: [] },
          })),
        },
        accountLinks: {
          create: vi
            .fn()
            .mockImplementation(async (params: { account: string }) => ({
              url: `https://connect.stripe.test/setup/${params.account}`,
            })),
        },
      },
    },
  };
}

function post(body: unknown) {
  return new Request("http://localhost:3000/api/stripe/connect/onboard", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

let stripe: ReturnType<typeof fakeStripe>;

beforeEach(() => {
  vi.mocked(getSupabaseAdmin).mockReset();
  vi.mocked(getStripe).mockReset();
  stripe = fakeStripe();
  vi.mocked(getStripe).mockReturnValue(stripe as unknown as ReturnType<typeof getStripe>);
});

function useAdmin(admin: ReturnType<typeof fakeAdmin>["admin"]) {
  vi.mocked(getSupabaseAdmin).mockReturnValue(
    admin as unknown as ReturnType<typeof getSupabaseAdmin>,
  );
}

describe("POST /api/stripe/connect/onboard", () => {
  it("rejects an invalid email with 400", async () => {
    useAdmin(fakeAdmin([]).admin);
    const res = await POST(post({ email: "not-an-email" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Enter a valid email address." });
  });

  it("returns 503 when the admin client is not configured", async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue(null);
    const res = await POST(post({ email: "seller@example.com" }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "Payments are not configured." });
  });

  it("creates an account, stores it and returns an onboarding link for a new email", async () => {
    const { admin, inserted } = fakeAdmin([]);
    useAdmin(admin);

    const res = await POST(post({ email: " Seller@Example.com " }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: "https://connect.stripe.test/setup/acct_new" });
    expect(stripe.v2.core.accounts.create).toHaveBeenCalledTimes(1);
    expect(inserted).toEqual([{ seller_email: "seller@example.com", stripe_account_id: "acct_new" }]);
    const linkParams = stripe.v2.core.accountLinks.create.mock.calls[0][0];
    expect(linkParams.use_case.account_onboarding.return_url).toBe(
      "http://localhost:3000/seller/payments?onboarding=return",
    );
  });

  it("issues a link for an existing account that has not submitted details", async () => {
    const { admin, inserted } = fakeAdmin([
      {
        seller_email: "seller@example.com",
        stripe_account_id: "acct_existing",
        charges_enabled: false,
        payouts_enabled: false,
        details_submitted: false,
      },
    ]);
    useAdmin(admin);

    const res = await POST(post({ email: "seller@example.com" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: "https://connect.stripe.test/setup/acct_existing" });
    expect(stripe.v2.core.accounts.create).not.toHaveBeenCalled();
    expect(inserted).toEqual([]);
  });

  it("returns status only once details are submitted", async () => {
    const { admin } = fakeAdmin([
      {
        seller_email: "seller@example.com",
        stripe_account_id: "acct_done",
        charges_enabled: false,
        payouts_enabled: false,
        details_submitted: true,
      },
    ]);
    useAdmin(admin);

    const res = await POST(post({ email: "seller@example.com" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: {
        stripe_account_id: "acct_done",
        charges_enabled: true,
        payouts_enabled: true,
        details_submitted: true,
      },
    });
    expect(stripe.v2.core.accountLinks.create).not.toHaveBeenCalled();
    expect(stripe.v2.core.accounts.create).not.toHaveBeenCalled();
  });

  it("re-selects the winning row after a unique violation and links that account", async () => {
    const rows: Row[] = [];
    const { admin } = fakeAdmin(rows, {
      onInsert: () => {
        rows.push({
          seller_email: "seller@example.com",
          stripe_account_id: "acct_winner",
          charges_enabled: false,
          payouts_enabled: false,
          details_submitted: false,
        });
        return { code: "23505", message: "duplicate key value" };
      },
    });
    useAdmin(admin);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const res = await POST(post({ email: "seller@example.com" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: "https://connect.stripe.test/setup/acct_winner" });
    expect(stripe.v2.core.accountLinks.create).toHaveBeenCalledTimes(1);
    expect(stripe.v2.core.accountLinks.create.mock.calls[0][0].account).toBe("acct_winner");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
