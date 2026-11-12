import type { SupabaseClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";

import {
  ACCOUNT_INCLUDE,
  createSellerAccount,
  normalizeAccountStatus,
  refreshSellerAccount,
  SellerAccountMissingError,
  unbindSellerAccount,
} from "@/lib/stripe/connect";

type Capability = { status: string; status_details: unknown[] };

function account(opts: {
  recipient?: boolean;
  transfers?: string;
  payouts?: string;
  requirements?: boolean | null;
  dueStatuses?: string[];
  awaiting?: "user" | "stripe";
  tos?: boolean;
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
    identity: opts.tos
      ? { attestations: { terms_of_service: { account: { date: "2026-11-12T00:00:00.000Z" } } } }
      : { attestations: { terms_of_service: { account: null } } },
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

  it("reports details submitted once terms of service are attested despite a user-due entry", () => {
    expect(
      normalizeAccountStatus(
        account({ transfers: "pending", dueStatuses: ["currently_due"], tos: true }),
      ),
    ).toEqual({ charges_enabled: false, payouts_enabled: false, details_submitted: true });
    expect(
      normalizeAccountStatus(account({ recipient: false, tos: true })).details_submitted,
    ).toBe(true);
  });

  it("does not treat a missing attestation date as submitted", () => {
    expect(
      normalizeAccountStatus(account({ transfers: "pending", dueStatuses: ["currently_due"] }))
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
  it("creates an express recipient account and returns its id and flags", async () => {
    const create = vi.fn().mockResolvedValue({ id: "acct_new_1" });
    const stripe = { v2: { core: { accounts: { create } } } } as unknown as Stripe;

    await expect(createSellerAccount(stripe, "seller@example.com")).resolves.toEqual({
      id: "acct_new_1",
      flags: { charges_enabled: false, payouts_enabled: false, details_submitted: false },
    });

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
    expect(params.include).toEqual(["configuration.recipient", "identity", "requirements"]);
    expect(params.identity.country).toBe("us");
    expect(params.display_name).toBe("seller@example.com");
    expect(params.metadata).toEqual({ seller_email: "seller@example.com" });
    // No idempotency key: a replay would resurrect a deleted account after an unbind.
    expect(create.mock.calls[0]).toHaveLength(1);
  });

  it("returns submitted flags for an account that is already attested", async () => {
    const create = vi
      .fn()
      .mockResolvedValue(account({ transfers: "pending", dueStatuses: ["currently_due"], tos: true }));
    const stripe = { v2: { core: { accounts: { create } } } } as unknown as Stripe;

    const created = await createSellerAccount(stripe, "seller@example.com");

    expect(created.flags.details_submitted).toBe(true);
  });
});

describe("unbindSellerAccount", () => {
  it("deletes only the row binding the email to the missing account and logs the id", async () => {
    const eqCalls: Array<[string, string]> = [];
    const builder = {
      eq(column: string, value: string) {
        eqCalls.push([column, value]);
        return builder;
      },
      then<T>(resolve: (value: { error: null }) => T) {
        return Promise.resolve({ error: null }).then(resolve);
      },
    };
    const admin = { from: () => ({ delete: () => builder }) } as unknown as SupabaseClient;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await unbindSellerAccount(admin, "seller@example.com", "acct_gone");

    expect(eqCalls).toEqual([
      ["seller_email", "seller@example.com"],
      ["stripe_account_id", "acct_gone"],
    ]);
    expect(warn).toHaveBeenCalledWith("stripe connect: unbinding missing account", {
      accountId: "acct_gone",
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain("seller@example.com");
    warn.mockRestore();
  });

  it("throws when the delete fails", async () => {
    const builder = {
      eq: () => builder,
      then<T>(resolve: (value: { error: { message: string } }) => T) {
        return Promise.resolve({ error: { message: "db down" } }).then(resolve);
      },
    };
    const admin = { from: () => ({ delete: () => builder }) } as unknown as SupabaseClient;
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(unbindSellerAccount(admin, "seller@example.com", "acct_gone")).rejects.toThrow(
      "Failed to unbind seller account: db down",
    );
  });
});

describe("refreshSellerAccount", () => {
  function fakeAdmin(row: { stripe_account_id: string; details_submitted: boolean }) {
    const updates: Record<string, unknown>[] = [];
    const updateFilters: Array<Array<[string, string]>> = [];
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
          const filters: Array<[string, string]> = [];
          updateFilters.push(filters);
          const builder = {
            eq(column: string, value: string) {
              filters.push([column, value]);
              return builder;
            },
            then<T>(resolve: (value: { error: null }) => T) {
              return Promise.resolve({ error: null }).then(resolve);
            },
          };
          return builder;
        },
      }),
    };
    return { admin: admin as unknown as SupabaseClient, updates, updateFilters, selected };
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
    expect(retrieve).toHaveBeenCalledWith("acct_sticky", {
      include: ["configuration.recipient", "identity", "requirements"],
    });
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

  it("never writes details_submitted false when details are not yet submitted", async () => {
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
    expect(updates).toEqual([{ charges_enabled: false, payouts_enabled: false }]);
    expect(updates[0]).not.toHaveProperty("details_submitted");
  });

  it("scopes the update to both the email and the bound account id", async () => {
    const { admin, updateFilters } = fakeAdmin({
      stripe_account_id: "acct_bound",
      details_submitted: false,
    });
    const retrieve = vi.fn().mockResolvedValue(account({ transfers: "active" }));
    const stripe = { v2: { core: { accounts: { retrieve } } } } as unknown as Stripe;

    await refreshSellerAccount(stripe, admin, "seller@example.com");

    expect(updateFilters).toEqual([
      [
        ["seller_email", "seller@example.com"],
        ["stripe_account_id", "acct_bound"],
      ],
    ]);
  });

  it("throws SellerAccountMissingError with the bound id when Stripe has no such account", async () => {
    const { admin, updates } = fakeAdmin({
      stripe_account_id: "acct_gone",
      details_submitted: true,
    });
    const retrieve = vi.fn().mockRejectedValue(
      new Stripe.errors.StripeInvalidRequestError({
        code: "resource_missing",
        message: "No such account",
        type: "invalid_request_error",
      }),
    );
    const stripe = { v2: { core: { accounts: { retrieve } } } } as unknown as Stripe;

    const error = await refreshSellerAccount(stripe, admin, "seller@example.com").catch(
      (err: unknown) => err,
    );

    expect(error).toBeInstanceOf(SellerAccountMissingError);
    expect((error as SellerAccountMissingError).accountId).toBe("acct_gone");
    expect(updates).toEqual([]);
  });
});
