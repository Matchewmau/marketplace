import { beforeEach, describe, expect, it, vi } from "vitest";

import { getSupabaseAdmin } from "@/lib/supabase-admin";

import { GET } from "./route";

const listingRef = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: listingRef.current, error: null }),
        }),
      }),
    }),
  },
}));
vi.mock("@/lib/supabase-admin", () => ({ getSupabaseAdmin: vi.fn() }));

const ID = "11111111-1111-4111-8111-111111111111";
const HOLD_TOKEN = "22222222-2222-4222-8222-222222222222";
const OTHER_TOKEN = "33333333-3333-4333-8333-333333333333";

function makeListing(overrides: Record<string, unknown> = {}) {
  return {
    id: ID,
    title: "Chair",
    description: null,
    price: "25",
    category: "Furniture",
    condition: "Good",
    location: "Austin",
    image_url: null,
    seller_email: " Seller@Example.com ",
    status: "active",
    sold_at: null,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function fakeAdmin(opts: {
  seller: { charges_enabled: boolean } | null;
  hold: boolean;
}) {
  const sellerEmails: string[] = [];
  return {
    sellerEmails,
    from(table: string) {
      if (table === "seller_accounts") {
        return {
          select: () => ({
            eq: (_column: string, value: string) => {
              sellerEmails.push(value);
              return {
                maybeSingle: async () => ({
                  data: opts.seller
                    ? { ...opts.seller, stripe_account_id: "acct_secret" }
                    : null,
                  error: null,
                }),
              };
            },
          }),
        };
      }
      if (table === "listing_holds") {
        return {
          select: () => ({
            eq: () => ({
              gt: () => ({
                maybeSingle: async () => ({
                  data: opts.hold ? { hold_token: HOLD_TOKEN } : null,
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

function useAdmin(admin: ReturnType<typeof fakeAdmin>) {
  vi.mocked(getSupabaseAdmin).mockReturnValue(
    admin as unknown as ReturnType<typeof getSupabaseAdmin>,
  );
}

async function call(opts: { holdToken?: string; query?: string } = {}) {
  const headers: Record<string, string> = {};
  if (opts.holdToken !== undefined) headers["x-hold-token"] = opts.holdToken;
  const res = await GET(
    new Request(`http://localhost/api/listings/x${opts.query ?? ""}`, { headers }),
    { params: Promise.resolve({ id: ID }) },
  );
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text) };
}

beforeEach(() => {
  process.env.STRIPE_SECRET_KEY = "sk_test_x";
  vi.mocked(getSupabaseAdmin).mockReset();
  listingRef.current = makeListing();
});

describe("GET /api/listings/[id] purchase state", () => {
  it("is buyable for an onboarded seller with no hold", async () => {
    const admin = fakeAdmin({ seller: { charges_enabled: true }, hold: false });
    useAdmin(admin);
    const { status, body, text } = await call();
    expect(status).toBe(200);
    expect(body.purchase).toEqual({ buyable: true, amountCents: 2500 });
    expect(admin.sellerEmails).toEqual(["seller@example.com"]);
    expect(text).not.toContain("stripe_account_id");
    expect(text).not.toContain("acct_secret");
  });

  it("reports seller_not_onboarded when there is no seller row", async () => {
    useAdmin(fakeAdmin({ seller: null, hold: false }));
    const { body, text } = await call();
    expect(body.purchase).toEqual({
      buyable: false,
      reason: "seller_not_onboarded",
    });
    expect(text).not.toContain("stripe_account_id");
  });

  it("reports sold for a sold listing", async () => {
    listingRef.current = makeListing({ status: "sold" });
    useAdmin(fakeAdmin({ seller: { charges_enabled: true }, hold: false }));
    const { body, text } = await call();
    expect(body.purchase).toEqual({ buyable: false, reason: "sold" });
    expect(text).not.toContain("stripe_account_id");
  });

  it("reports reserved when an active hold exists", async () => {
    useAdmin(fakeAdmin({ seller: { charges_enabled: true }, hold: true }));
    const { body, text } = await call();
    expect(body.purchase).toEqual({ buyable: false, reason: "reserved" });
    expect(text).not.toContain("stripe_account_id");
  });

  it("is buyable when the x-hold-token header matches the active hold", async () => {
    useAdmin(fakeAdmin({ seller: { charges_enabled: true }, hold: true }));
    const { status, body, text } = await call({ holdToken: HOLD_TOKEN });
    expect(status).toBe(200);
    expect(body.purchase).toEqual({ buyable: true, amountCents: 2500 });
    expect(text).not.toContain(HOLD_TOKEN);
    expect(text).not.toContain("hold_token");
  });

  it("ignores a hold token sent in the query string", async () => {
    useAdmin(fakeAdmin({ seller: { charges_enabled: true }, hold: true }));
    const { body } = await call({ query: `?holdToken=${HOLD_TOKEN}` });
    expect(body.purchase).toEqual({ buyable: false, reason: "reserved" });
  });

  it("stays reserved when the x-hold-token header does not match", async () => {
    useAdmin(fakeAdmin({ seller: { charges_enabled: true }, hold: true }));
    const { body, text } = await call({ holdToken: OTHER_TOKEN });
    expect(body.purchase).toEqual({ buyable: false, reason: "reserved" });
    expect(text).not.toContain(HOLD_TOKEN);
  });

  it("ignores a malformed x-hold-token header", async () => {
    useAdmin(fakeAdmin({ seller: { charges_enabled: true }, hold: true }));
    const { body } = await call({ holdToken: "not-a-uuid" });
    expect(body.purchase).toEqual({ buyable: false, reason: "reserved" });
  });

  it("still returns the listing when purchase state throws", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getSupabaseAdmin).mockImplementation(() => {
      throw new Error("boom");
    });
    const { status, body } = await call();
    expect(status).toBe(200);
    expect(body.listing.id).toBe(ID);
    expect(body.purchase).toEqual({
      buyable: false,
      reason: "payments_unavailable",
    });
    expect(errorSpy).toHaveBeenCalledWith("Purchase state failed:", "boom");
    errorSpy.mockRestore();
  });
});
