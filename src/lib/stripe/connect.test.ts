import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";

import { ACCOUNT_INCLUDE, createSellerAccount, normalizeAccountStatus } from "@/lib/stripe/connect";

type Capability = { status: string; status_details: unknown[] };

function account(opts: {
  recipient?: boolean;
  transfers?: string;
  payouts?: string;
  requirements?: boolean;
  dueStatuses?: string[];
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
      opts.requirements === false
        ? undefined
        : {
            entries: (opts.dueStatuses ?? []).map((status) => ({
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
  });
});
