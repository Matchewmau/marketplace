import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StripeConfigError } from "@/lib/stripe/config";
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
function fakeAdmin(
  rows: Row[],
  hooks: { onInsert?: (row: Partial<Row>) => DbError | null; loadError?: DbError } = {},
) {
  const inserted: Partial<Row>[] = [];
  const admin = {
    from(table: string) {
      if (table !== "seller_accounts") throw new Error(`unexpected table ${table}`);
      return {
        select: (columns: string) => ({
          eq: (column: keyof Row, value: string) => ({
            maybeSingle: async () => {
              if (hooks.loadError) return { data: null, error: hooks.loadError };
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
        delete: () => ({
          eq: async (column: keyof Row, value: string) => {
            for (let i = rows.length - 1; i >= 0; i--) {
              if (rows[i][column] === value) rows.splice(i, 1);
            }
            return { error: null };
          },
        }),
      };
    },
  };
  return { admin, inserted };
}

/** A retrieved v2 account; `userDue` adds a currently_due requirement awaiting the user. */
function accountResponse(id: string, opts: { transfers?: string; userDue?: boolean } = {}) {
  return {
    id,
    object: "v2.core.account",
    configuration: {
      recipient: {
        applied: true,
        capabilities: {
          stripe_balance: {
            stripe_transfers: { status: opts.transfers ?? "active", status_details: [] },
          },
        },
      },
    },
    requirements: {
      entries: opts.userDue
        ? [
            {
              awaiting_action_from: "user",
              description: "individual.id_number",
              errors: [],
              minimum_deadline: { status: "currently_due" },
              requested_reasons: [],
            },
          ]
        : [],
    },
  };
}

function fakeStripe() {
  return {
    v2: {
      core: {
        accounts: {
          create: vi.fn().mockResolvedValue({ id: "acct_new" }),
          retrieve: vi.fn().mockImplementation(async (id: string) => accountResponse(id)),
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

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.stubEnv("APP_URL", "");
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
    expect(linkParams.use_case.type).toBe("account_onboarding");
    expect(linkParams.use_case.account_onboarding.return_url).toBe(
      "http://localhost:3000/seller/payments?onboarding=return",
    );
    expect(linkParams.use_case.account_onboarding.refresh_url).toBe(
      "http://localhost:3000/seller/payments?onboarding=refresh",
    );
  });

  it("issues a link for an existing account that has not submitted details", async () => {
    stripe.v2.core.accounts.retrieve.mockImplementation(async (id: string) =>
      accountResponse(id, { transfers: "pending", userDue: true }),
    );
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
    expect(stripe.v2.core.accounts.retrieve).toHaveBeenCalledWith("acct_existing", {
      include: ["configuration.recipient", "requirements"],
    });
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

  it("rejects invalid JSON with 400", async () => {
    useAdmin(fakeAdmin([]).admin);
    const res = await POST(
      new Request("http://localhost:3000/api/stripe/connect/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not json",
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid request body." });
  });

  it("returns 503 when Stripe is not configured", async () => {
    useAdmin(fakeAdmin([]).admin);
    vi.mocked(getStripe).mockImplementation(() => {
      throw new StripeConfigError("missing key");
    });
    const res = await POST(post({ email: "seller@example.com" }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "Payments are not configured." });
  });

  it("returns 500 and logs when the seller row cannot be loaded", async () => {
    const { admin } = fakeAdmin([], { loadError: { code: "XX000", message: "db down" } });
    useAdmin(admin);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(post({ email: "seller@example.com" }));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Could not load payout settings." });
    expect(error).toHaveBeenCalledWith("stripe connect onboard failed:", "db down");
    expect(stripe.v2.core.accounts.create).not.toHaveBeenCalled();
  });

  it("returns 502 on a Stripe error without logging key material", async () => {
    useAdmin(fakeAdmin([]).admin);
    stripe.v2.core.accountLinks.create.mockRejectedValue(
      new Stripe.errors.StripeAuthenticationError({
        message: "Invalid API Key provided: sk_test_abc123",
        type: "authentication_error",
      }),
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(post({ email: "seller@example.com" }));

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Could not reach Stripe. Try again." });
    expect(error).toHaveBeenCalled();
    expect(JSON.stringify(error.mock.calls)).not.toContain("sk_");
  });

  it("returns status without a link when a refresh shows details were submitted", async () => {
    const rows: Row[] = [
      {
        seller_email: "seller@example.com",
        stripe_account_id: "acct_finished",
        charges_enabled: false,
        payouts_enabled: false,
        details_submitted: false,
      },
    ];
    stripe.v2.core.accounts.retrieve.mockImplementation(async (id: string) =>
      accountResponse(id, { transfers: "pending" }),
    );
    useAdmin(fakeAdmin(rows).admin);

    const res = await POST(post({ email: "seller@example.com" }));

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({
      status: { charges_enabled: false, payouts_enabled: false, details_submitted: true },
    });
    expect(text).not.toContain("acct_finished");
    expect(stripe.v2.core.accountLinks.create).not.toHaveBeenCalled();
    expect(rows[0].details_submitted).toBe(true);
  });

  it("unbinds the email and returns 409 when the bound account no longer exists", async () => {
    const rows: Row[] = [
      {
        seller_email: "seller@example.com",
        stripe_account_id: "acct_gone",
        charges_enabled: false,
        payouts_enabled: false,
        details_submitted: false,
      },
    ];
    stripe.v2.core.accounts.retrieve.mockRejectedValue(
      new Stripe.errors.StripeInvalidRequestError({
        code: "resource_missing",
        message: "No such account",
        type: "invalid_request_error",
      }),
    );
    useAdmin(fakeAdmin(rows).admin);

    const res = await POST(post({ email: "seller@example.com" }));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "The Stripe account linked to this email no longer exists. Start setup again.",
    });
    expect(rows).toEqual([]);
    expect(stripe.v2.core.accountLinks.create).not.toHaveBeenCalled();
  });
});
