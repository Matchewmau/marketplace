import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { PublicSellerStatus, SellerPaymentStatus } from "@/lib/types";

export const ACCOUNT_INCLUDE: ReadonlyArray<Stripe.V2.Core.AccountRetrieveParams.Include> = [
  "configuration.recipient",
  "requirements",
];

/**
 * Maps an Accounts v2 recipient account onto the flags stored in seller_accounts.
 * details_submitted means the seller has nothing left to do right now: transfers are
 * active or pending (Stripe may still be verifying) and no currently/past-due requirement
 * is awaiting action from the user. v2 responses use null for unset fields.
 */
export function normalizeAccountStatus(
  account: Stripe.V2.Core.Account,
): Omit<SellerPaymentStatus, "stripe_account_id"> {
  const recipient = account.configuration?.recipient;
  if (!recipient) {
    return { charges_enabled: false, payouts_enabled: false, details_submitted: false };
  }

  const stripeBalance = recipient.capabilities?.stripe_balance;
  const transfersStatus = stripeBalance?.stripe_transfers?.status;
  const chargesEnabled = transfersStatus === "active";

  const requirements = account.requirements;
  const detailsSubmitted =
    requirements != null &&
    (transfersStatus === "active" || transfersStatus === "pending") &&
    !(requirements.entries ?? []).some((entry) => {
      if (entry.awaiting_action_from !== "user") return false;
      const status = entry.minimum_deadline?.status;
      return status === "currently_due" || status === "past_due";
    });

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

export async function createSellerAccount(stripe: Stripe, email: string): Promise<string> {
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
  }, { idempotencyKey: `seller-account:${email}` });
  return account.id;
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
  const account = await stripe.v2.core.accounts.retrieve(stripeAccountId, {
    include: [...ACCOUNT_INCLUDE],
  });
  const fresh = normalizeAccountStatus(account);
  const flags = {
    ...fresh,
    details_submitted: previous.details_submitted === true || fresh.details_submitted,
  };

  const { error: updateError } = await admin
    .from("seller_accounts")
    .update(flags)
    .eq("seller_email", email);

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

/** Removes the binding for an email whose connected account no longer exists in Stripe. */
export async function unbindSellerAccount(admin: SupabaseClient, email: string): Promise<void> {
  const { error } = await admin.from("seller_accounts").delete().eq("seller_email", email);
  if (error) {
    throw new Error(`Failed to unbind seller account: ${error.message}`);
  }
}

const SECRET_PATTERN = /\b(?:sk|rk|pk|whsec)_[A-Za-z0-9_*]+/g;

/** Error message safe for server logs: never the full error object, with key-like tokens redacted. */
export function safeErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.replace(SECRET_PATTERN, "[redacted]");
}
