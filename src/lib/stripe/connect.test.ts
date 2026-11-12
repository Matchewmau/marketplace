import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";

import {
  ACCOUNT_INCLUDE,
  createSellerAccount,
  normalizeAccountStatus,
  refreshSellerAccount,
} from "@/lib/stripe/connect";

type Capability = { status: string; status_details: unknown[] };

function account(opts: {
  recipient?: boolean;
  transfers?: string;
  payouts?: string;
  requirements?: boolean | null;
  dueStatuses?: string[];
  awaiting?: "user" | "stripe";
}): Stripe.V2.Core.Account {
  const stripeBalance: { stripe_transfers?: Capability; payouts?: Capability } = {};
  if (opts.transfers) stripeBalance.stripe_transfers = { status: opts.transfers, status_details: [] };
  if (opts.payouts) stripeBalance.payouts = { status: opts.payouts, status_details: [] };

  const raw = {
    id: "acct_test_1",
    object: "v2.core.account",
    applied_configurations: opts.recipient === false ? [] : ["recipient"],
    created: "2026-11-12T00:00:00.000Z",
    livemode: false,
    configuration:
      opts.recipient === false
        ? {}
        : { recipient: { applied: true, capabilities: { stripe_balance: stripeBalance } } },
    requirements:
      opts.requirements === null
        ? null
        : opts.requirements === false
        ? undefined
        : {
            entries: (opts.dueStatuses ?? []).map((status) => ({
              awaiting_action_from: opts.awaiting ?? "user",
              description: "x",
              errors: [],
              minimum_deadline: { status },
              requested_reasons: [],
            })),
          },
  };
  return raw as unknown as Stripe.V2.Core.Account;
}

describe("normalizeAccountStatus", () => {
  it("is fully enabled when transfers and payouts are active with no due requirements", () => {
    expect(
      normalizeAccountStatus(
        account({ transfers: "active", payouts: "active", dueStatuses: ["eventually_due"] }),
      ),
    ).toEqual({ charges_enabled: true, payouts_enabled: true, details_submitted: true });
  });

  it("reports charges disabled while transfers are pending", () => {
    expect(normalizeAccountStatus(account({ transfers: "pending" })).charges_enabled).toBe(false);
  });

  it("reports details not submitted when an entry is past due", () => {
    expect(
      normalizeAccountStatus(account({ transfers: "active", dueStatuses: ["past_due"] }))
        .details_submitted,
    ).toBe(false);
  });

  it("treats requirements: null as details not submitted without throwing", () => {
    expect(() =>
      normalizeAccountStatus(account({ transfers: "active", requirements: null })),
    ).not.toThrow();
    expect(
      normalizeAccountStatus(account({ transfers: "active", requirements: null })),
    ).toEqual({ charges_enabled: true, payouts_enabled: false, details_submitted: false });
  });

  it("reports details submitted while only Stripe is verifying and transfers are pending", () => {
    expect(
      normalizeAccountStatus(
        account({ transfers: "pending", dueStatuses: ["currently_due"], awaiting: "stripe" }),
      ),
    ).toEqual({ charges_enabled: false, payouts_enabled: false, details_submitted: true });
  });

  it("reports details not submitted for a restricted account with no entries", () => {
    expect(
      normalizeAccountStatus(account({ transfers: "restricted" })).details_submitted,
    ).toBe(false);
  });

  it("reports details not submitted when the transfers capability is absent", () => {
    expect(normalizeAccountStatus(account({})).details_submitted).toBe(false);
  });

  it("is all false without a recipient configuration", () => {
    expect(normalizeAccountStatus(account({ recipient: false }))).toEqual({
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: false,
    });
  });

  it("derives payouts from charges and details when no payouts capability exists", () => {
    expect(normalizeAccountStatus(account({ transfers: "active" })).payouts_enabled).toBe(true);
    expect(
      normalizeAccountStatus(account({ transfers: "active", dueStatuses: ["currently_due"] }))
        .payouts_enabled,
    ).toBe(false);
    expect(
      normalizeAccountStatus(account({ transfers: "active", requirements: false })),
    ).toEqual({ charges_enabled: true, payouts_enabled: false, details_submitted: false });
  });
});

describe("createSellerAccount", () => {
  it("creates an express recipient account and returns its id", async () => {
    const create = vi.fn().mockResolvedValue({ id: "acct_new_1" });
    const stripe = { v2: { core: { accounts: { create } } } } as unknown as Stripe;

    await expect(createSellerAccount(stripe, "seller@example.com")).resolves.toBe("acct_new_1");

    expect(create).toHaveBeenCalledTimes(1);
    const params = create.mock.calls[0][0];
    expect(params.dashboard).toBe("express");
    expect(params.contact_email).toBe("seller@example.com");
    expect(
      params.configuration.recipient.capabilities.stripe_balance.stripe_transfers.requested,
    ).toBe(true);
    expect(params.defaults.responsibilities).toEqual({
      fees_collector: "application",
      losses_collector: "application",
    });
    expect(params.include).toEqual([...ACCOUNT_INCLUDE]);
    expect(params.include).toEqual(["configuration.recipient", "requirements"]);
    expect(params.identity.country).toBe("us");
    expect(params.display_name).toBe("seller@example.com");
    expect(params.metadata).toEqual({ seller_email: "seller@example.com" });
    expect(create.mock.calls[0][1]).toEqual({
      idempotencyKey: "seller-account:seller@example.com",
    });
  });
});

describe("refreshSellerAccount", () => {
  function fakeAdmin(row: { stripe_account_id: string; details_submitted: boolean }) {
    const updates: Record<string, unknown>[] = [];
    const selected: string[] = [];
    const admin = {
      from: () => ({
        select: (columns: string) => {
          selected.push(columns);
          return {
            eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }),
          };
        },
        update: (patch: Record<string, unknown>) => {
          updates.push(patch);
          return { eq: async () => ({ error: null }) };
        },
      }),
    };
    return { admin: admin as unknown as SupabaseClient, updates, selected };
  }

  it("keeps details_submitted true once set even if Stripe now reports otherwise", async () => {
    const { admin, updates, selected } = fakeAdmin({
      stripe_account_id: "acct_sticky",
      details_submitted: true,
    });
    const retrieve = vi
      .fn()
      .mockResolvedValue(account({ transfers: "pending", dueStatuses: ["currently_due"] }));
    const stripe = { v2: { core: { accounts: { retrieve } } } } as unknown as Stripe;

    const status = await refreshSellerAccount(stripe, admin, "seller@example.com");

    expect(selected[0]).toContain("details_submitted");
    expect(status).toEqual({
      stripe_account_id: "acct_sticky",
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: true,
    });
    expect(updates).toEqual([
      { charges_enabled: false, payouts_enabled: false, details_submitted: true },
    ]);
  });

  it("stores the fresh value when details were not previously submitted", async () => {
    const { admin, updates } = fakeAdmin({
      stripe_account_id: "acct_new",
      details_submitted: false,
    });
    const retrieve = vi
      .fn()
      .mockResolvedValue(account({ transfers: "pending", dueStatuses: ["currently_due"] }));
    const stripe = { v2: { core: { accounts: { retrieve } } } } as unknown as Stripe;

    const status = await refreshSellerAccount(stripe, admin, "seller@example.com");

    expect(status?.details_submitted).toBe(false);
    expect(updates[0]).toMatchObject({ details_submitted: false });
  });
});
