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
                  data: opts.hold ? { listing_id: ID } : null,
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

async function call() {
  const res = await GET(new Request("http://localhost/api/listings/x"), {
    params: Promise.resolve({ id: ID }),
  });
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
});
