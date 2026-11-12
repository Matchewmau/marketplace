import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { SellerPaymentStatus } from "@/lib/types";

export const ACCOUNT_INCLUDE: ReadonlyArray<Stripe.V2.Core.AccountRetrieveParams.Include> = [
  "configuration.recipient",
  "requirements",
];

/** Maps an Accounts v2 recipient account onto the flags stored in seller_accounts. */
export function normalizeAccountStatus(
  account: Stripe.V2.Core.Account,
): Omit<SellerPaymentStatus, "stripe_account_id"> {
  const recipient = account.configuration?.recipient;
  if (!recipient) {
    return { charges_enabled: false, payouts_enabled: false, details_submitted: false };
  }

  const stripeBalance = recipient.capabilities?.stripe_balance;
  const chargesEnabled = stripeBalance?.stripe_transfers?.status === "active";

  const requirements = account.requirements;
  const detailsSubmitted =
    requirements !== undefined &&
    !(requirements.entries ?? []).some((entry) => {
      const status = entry.minimum_deadline?.status;
      return status === "currently_due" || status === "past_due";
    });

  const payouts = stripeBalance?.payouts;
  const payoutsEnabled = payouts
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
  });
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

/** Re-reads the seller's account from Stripe and persists the flags. Null if the email has no account. */
export async function refreshSellerAccount(
  stripe: Stripe,
  admin: SupabaseClient,
  email: string,
): Promise<SellerPaymentStatus | null> {
  const { data, error } = await admin
    .from("seller_accounts")
    .select("stripe_account_id")
    .eq("seller_email", email)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load seller account: ${error.message}`);
  }
  if (!data) return null;

  const stripeAccountId = (data as { stripe_account_id: string }).stripe_account_id;
  const account = await stripe.v2.core.accounts.retrieve(stripeAccountId, {
    include: [...ACCOUNT_INCLUDE],
  });
  const flags = normalizeAccountStatus(account);

  const { error: updateError } = await admin
    .from("seller_accounts")
    .update(flags)
    .eq("seller_email", email);

  if (updateError) {
    throw new Error(`Failed to update seller account: ${updateError.message}`);
  }

  return { stripe_account_id: stripeAccountId, ...flags };
}
