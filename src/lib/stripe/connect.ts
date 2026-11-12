import Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { PublicSellerStatus, SellerPaymentStatus } from "@/lib/types";

export const ACCOUNT_INCLUDE: ReadonlyArray<Stripe.V2.Core.AccountRetrieveParams.Include> = [
  "configuration.recipient",
  "identity",
  "requirements",
];

type SellerFlags = Omit<SellerPaymentStatus, "stripe_account_id">;

/** Thrown when the account bound to an email no longer exists in Stripe. */
export class SellerAccountMissingError extends Error {
  constructor(readonly accountId: string) {
    super("Bound Stripe account no longer exists");
    this.name = "SellerAccountMissingError";
  }
}

/**
 * Maps an Accounts v2 recipient account onto the flags stored in seller_accounts.
 * details_submitted means the seller has nothing left to do right now: transfers are
 * active or pending (Stripe may still be verifying) and no currently/past-due requirement
 * is awaiting action from the user. Stripe's terms-of-service attestation is a permanent
 * submission signal, so an attested account counts as submitted regardless of requirements.
 * v2 responses use null for unset fields.
 */
export function normalizeAccountStatus(
  account: Stripe.V2.Core.Account,
): SellerFlags {
  const tosAccepted = account.identity?.attestations?.terms_of_service?.account?.date != null;
  const recipient = account.configuration?.recipient;
  if (!recipient) {
    return { charges_enabled: false, payouts_enabled: false, details_submitted: tosAccepted };
  }

  const stripeBalance = recipient.capabilities?.stripe_balance;
  const transfersStatus = stripeBalance?.stripe_transfers?.status;
  const chargesEnabled = transfersStatus === "active";

  const requirements = account.requirements;
  const detailsSubmitted =
    tosAccepted ||
    (requirements != null &&
      (transfersStatus === "active" || transfersStatus === "pending") &&
      !(requirements.entries ?? []).some((entry) => {
        if (entry.awaiting_action_from !== "user") return false;
        const status = entry.minimum_deadline?.status;
        return status === "currently_due" || status === "past_due";
      }));

  const payouts = stripeBalance?.payouts;
  const payoutsEnabled = payouts != null
    ? payouts.status === "active"
    : chargesEnabled && detailsSubmitted;

  return {
    charges_enabled: chargesEnabled,
    payouts_enabled: payoutsEnabled,
    details_submitted: detailsSubmitted,
  };
}

/**
 * Creates a recipient account for the email. No idempotency key: a replayed key would resurrect a
 * deleted account after an unbind, and concurrent creates are resolved by the unique constraint.
 */
export async function createSellerAccount(
  stripe: Stripe,
  email: string,
): Promise<{ id: string; flags: SellerFlags }> {
  const account = await stripe.v2.core.accounts.create({
    contact_email: email,
    display_name: email,
    dashboard: "express",
    identity: { country: "us" },
    configuration: {
      recipient: {
        capabilities: { stripe_balance: { stripe_transfers: { requested: true } } },
      },
    },
    defaults: {
      responsibilities: { fees_collector: "application", losses_collector: "application" },
    },
    metadata: { seller_email: email },
    include: [...ACCOUNT_INCLUDE],
  });
  return { id: account.id, flags: normalizeAccountStatus(account) };
}

export async function createOnboardingLink(
  stripe: Stripe,
  accountId: string,
  origin: string,
): Promise<string> {
  const link = await stripe.v2.core.accountLinks.create({
    account: accountId,
    use_case: {
      type: "account_onboarding",
      account_onboarding: {
        return_url: `${origin}/seller/payments?onboarding=return`,
        refresh_url: `${origin}/seller/payments?onboarding=refresh`,
      },
    },
  });
  return link.url;
}

/**
 * Re-reads the seller's account from Stripe and persists the flags. Null if the email has no account.
 * details_submitted is sticky: once true it never flips back, so onboarding links stay closed.
 * Writes are scoped to the bound account id, and details_submitted is only ever written as true.
 * Throws SellerAccountMissingError when the bound account no longer exists in Stripe.
 */
export async function refreshSellerAccount(
  stripe: Stripe,
  admin: SupabaseClient,
  email: string,
): Promise<SellerPaymentStatus | null> {
  const { data, error } = await admin
    .from("seller_accounts")
    .select("stripe_account_id, details_submitted")
    .eq("seller_email", email)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load seller account: ${error.message}`);
  }
  if (!data) return null;

  const previous = data as { stripe_account_id: string; details_submitted: boolean | null };
  const stripeAccountId = previous.stripe_account_id;
  let account: Stripe.V2.Core.Account;
  try {
    account = await stripe.v2.core.accounts.retrieve(stripeAccountId, {
      include: [...ACCOUNT_INCLUDE],
    });
  } catch (err) {
    if (err instanceof Stripe.errors.StripeError && err.code === "resource_missing") {
      throw new SellerAccountMissingError(stripeAccountId);
    }
    throw err;
  }
  const fresh = normalizeAccountStatus(account);
  const flags: SellerFlags = {
    ...fresh,
    details_submitted: previous.details_submitted === true || fresh.details_submitted,
  };
  const patch: Partial<SellerFlags> = {
    charges_enabled: flags.charges_enabled,
    payouts_enabled: flags.payouts_enabled,
  };
  if (flags.details_submitted) patch.details_submitted = true;

  const { error: updateError } = await admin
    .from("seller_accounts")
    .update(patch)
    .eq("seller_email", email)
    .eq("stripe_account_id", stripeAccountId);

  if (updateError) {
    throw new Error(`Failed to update seller account: ${updateError.message}`);
  }

  return { stripe_account_id: stripeAccountId, ...flags };
}

/** Drops the stripe_account_id before a status is returned from a public route. */
export function toPublicSellerStatus(status: SellerPaymentStatus): PublicSellerStatus {
  return {
    charges_enabled: status.charges_enabled,
    payouts_enabled: status.payouts_enabled,
    details_submitted: status.details_submitted,
  };
}

/** Removes the binding between an email and a specific connected account that no longer exists in Stripe. */
export async function unbindSellerAccount(
  admin: SupabaseClient,
  email: string,
  missingAccountId: string,
): Promise<void> {
  console.warn("stripe connect: unbinding missing account", { accountId: missingAccountId });
  const { error } = await admin
    .from("seller_accounts")
    .delete()
    .eq("seller_email", email)
    .eq("stripe_account_id", missingAccountId);
  if (error) {
    throw new Error(`Failed to unbind seller account: ${error.message}`);
  }
}

const SECRET_PATTERNS = [
  /\b(?:sk|rk|pk|whsec)_[A-Za-z0-9_*]+/g,
  /\bsb_(?:secret|publishable)_[A-Za-z0-9_-]+/g,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g,
];

/** Error message safe for server logs: never the full error object, with key-like tokens redacted. */
export function safeErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return SECRET_PATTERNS.reduce((text, pattern) => text.replace(pattern, "[redacted]"), message);
}
