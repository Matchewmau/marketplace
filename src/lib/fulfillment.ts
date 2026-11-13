import type { SupabaseClient } from "@supabase/supabase-js";
import Stripe from "stripe";


export type FulfillOutcome =
  | "recorded"
  | "duplicate"
  | "refunded"
  | "refunded_unavailable"
  | "not_paid"
  | "ignored";
export type FulfillResult = {
  outcome: FulfillOutcome;
  listingId: string | null;
  amountCents: number | null;
};

const LOG_PREFIX = "fulfillment:";

type RegistryRow = {
  listing_id: string;
  amount_cents: number;
  seller_stripe_account_id: string;
  application_fee_cents: number;
};

/**
 * Refunds the PaymentIntent (reversing the transfer, and the platform fee if any) and returns the
 * refund id. A refund already made by hand in the Dashboard is reused. Throws unless the refund
 * is in a non-failed state, so the caller retries.
 */
async function refundPayment(
  stripe: Stripe,
  sessionId: string,
  paymentIntentId: string,
  fee: number,
): Promise<string> {
  let refund: Stripe.Refund | undefined;
  try {
    refund = await stripe.refunds.create(
      {
        payment_intent: paymentIntentId,
        reverse_transfer: true,
        ...(fee > 0 ? { refund_application_fee: true } : {}),
      },
      { idempotencyKey: `refund:${sessionId}` },
    );
  } catch (err) {
    if (!(err instanceof Stripe.errors.StripeError && err.code === "charge_already_refunded")) {
      throw err;
    }
    const existing = await stripe.refunds.list({ payment_intent: paymentIntentId, limit: 1 });
    refund = existing.data[0];
    if (!refund) {
      throw new Error("Charge is already refunded but no refund was found.");
    }
  }

  if (refund.status === "failed" || refund.status === "canceled") {
    throw new Error(`Refund ${refund.id} is ${refund.status}.`);
  }
  return refund.id;
}

/**
 * Refunds a registered (so genuine buyer) payment that cannot be fulfilled as registered, after
 * logging why. Throws if the refund fails, so the caller retries.
 */
async function refundUnexpectedPayment(
  stripe: Stripe,
  sessionId: string,
  paymentIntentId: string,
  fee: number,
  listingId: string,
  amountCents: number,
  details: { reason: string; mismatches?: Record<string, { expected: unknown; actual: unknown }> },
): Promise<FulfillResult> {
  console.error(LOG_PREFIX, details.reason, { sessionId, ...details });
  const refundId = await refundPayment(stripe, sessionId, paymentIntentId, fee);
  console.error(LOG_PREFIX, "refunded registered session", { sessionId, refundId });
  return { outcome: "refunded_unavailable", listingId, amountCents };
}

/**
 * Records a paid Checkout Session as an order. Idempotent: a repeat call returns "duplicate",
 * and a session that lost the race for the listing is refunded (retried until marked refunded).
 * A paid session for a deleted listing, or one that does not match its registry row, is refunded
 * as "refunded_unavailable". Sessions not registered by this app are ignored and never refunded.
 * Stripe metadata is never consulted: the sandbox key is shared, so it is forgeable.
 */
export async function fulfillCheckoutSession(
  sessionId: string,
  deps: { stripe: Stripe; admin: SupabaseClient },
): Promise<FulfillResult> {
  const { stripe, admin } = deps;

  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ["payment_intent"],
  });

  // The registry (this app's own database) is the only authority: only sessions this app created
  // are fulfilled, using the registered values. Unregistered sessions are never refunded either,
  // since they are not ours.
  const { data: registered, error: registryError } = await admin
    .from("checkout_sessions")
    .select("listing_id, amount_cents, seller_stripe_account_id, application_fee_cents")
    .eq("stripe_checkout_session_id", session.id)
    .maybeSingle();
  if (registryError) {
    throw new Error(`Failed to load checkout session registry: ${registryError.message}`);
  }
  const registry = registered as RegistryRow | null;
  if (!registry) {
    console.warn(LOG_PREFIX, "ignoring session not created by this app", {
      sessionId: session.id,
    });
    return { outcome: "ignored", listingId: null, amountCents: session.amount_total };
  }
  const listingId = registry.listing_id;

  if (session.payment_status !== "paid") {
    return { outcome: "not_paid", listingId, amountCents: session.amount_total };
  }

  const pi = session.payment_intent;
  if (!pi || typeof pi === "string") {
    throw new Error("Checkout session payment_intent was not expanded.");
  }

  const amountCents = session.amount_total;
  if (amountCents === null) {
    throw new Error("Checkout session has no amount_total.");
  }

  const fee = pi.application_fee_amount ?? 0;
  const destination = pi.transfer_data?.destination;
  const destinationId = typeof destination === "string" ? destination : destination?.id;
  const mismatches: Record<string, { expected: unknown; actual: unknown }> = {};
  if (amountCents !== registry.amount_cents) {
    mismatches.amount_cents = { expected: registry.amount_cents, actual: amountCents };
  }
  if (destinationId !== registry.seller_stripe_account_id) {
    mismatches.seller_stripe_account_id = {
      expected: registry.seller_stripe_account_id,
      actual: destinationId ?? null,
    };
  }
  if (fee !== registry.application_fee_cents) {
    mismatches.application_fee_cents = { expected: registry.application_fee_cents, actual: fee };
  }
  if (Object.keys(mismatches).length > 0) {
    return refundUnexpectedPayment(stripe, session.id, pi.id, fee, listingId, amountCents, {
      reason: "session does not match its registration",
      mismatches,
    });
  }
  const sellerAccount = registry.seller_stripe_account_id;

  const { data: listingRow, error: listingError } = await admin
    .from("listings")
    .select("id")
    .eq("id", listingId)
    .maybeSingle();
  if (listingError) {
    throw new Error(`Failed to load listing: ${listingError.message}`);
  }
  if (!listingRow) {
    // The listing was deleted after the session was created; there is nothing to sell.
    const refundId = await refundPayment(stripe, session.id, pi.id, fee);
    console.warn(LOG_PREFIX, "refunded session for a deleted listing", {
      sessionId: session.id,
      refundId,
    });
    return { outcome: "refunded_unavailable", listingId, amountCents };
  }

  const { data, error } = await admin.rpc("record_paid_order", {
    p_session_id: session.id,
    p_payment_intent_id: pi.id,
    p_listing_id: listingId,
    p_buyer_email: session.customer_details?.email ?? null,
    p_amount_cents: amountCents,
    p_fee_cents: fee,
    p_seller_account_id: sellerAccount,
  });
  if (error) {
    throw new Error(`Failed to record order: ${error.message}`);
  }

  if (data === "unrecognized") {
    return refundUnexpectedPayment(stripe, session.id, pi.id, fee, listingId, amountCents, {
      reason: "record_paid_order did not recognise a registered session",
    });
  }

  if (data === "recorded" || data === "duplicate" || data === "refunded") {
    return { outcome: data, listingId, amountCents };
  }

  if (data === "refund_pending") {
    const refundId = await refundPayment(stripe, session.id, pi.id, fee);

    const { error: refundError } = await admin.rpc("mark_order_refunded", {
      p_session_id: session.id,
      p_refund_id: refundId,
    });
    if (refundError) {
      throw new Error(`Failed to mark order refunded: ${refundError.message}`);
    }
    return { outcome: "refunded", listingId, amountCents };
  }

  throw new Error(`Unexpected record_paid_order result: ${String(data)}`);
}
