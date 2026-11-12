import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

import { isUuid } from "@/lib/validation";

export type FulfillOutcome = "recorded" | "duplicate" | "refunded" | "not_paid";
export type FulfillResult = {
  outcome: FulfillOutcome;
  listingId: string | null;
  amountCents: number | null;
};

/**
 * Records a paid Checkout Session as an order. Idempotent: a repeat call returns "duplicate",
 * and a session that lost the race for the listing is refunded (retried until marked refunded).
 */
export async function fulfillCheckoutSession(
  sessionId: string,
  deps: { stripe: Stripe; admin: SupabaseClient },
): Promise<FulfillResult> {
  const { stripe, admin } = deps;
  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ["payment_intent"],
  });

  const metadataListingId = session.metadata?.listing_id ?? null;
  const listingId = metadataListingId && isUuid(metadataListingId) ? metadataListingId : null;

  if (session.payment_status !== "paid") {
    return { outcome: "not_paid", listingId, amountCents: session.amount_total };
  }

  if (!listingId) {
    throw new Error("Checkout session has no valid listing_id metadata.");
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
  const sellerAccount = session.metadata?.seller_account_id ?? destinationId;
  if (!sellerAccount) {
    throw new Error("Checkout session has no seller account.");
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

  if (data === "recorded" || data === "duplicate") {
    return { outcome: data, listingId, amountCents };
  }

  if (data === "refund_pending") {
    const refund = await stripe.refunds.create(
      {
        payment_intent: pi.id,
        reverse_transfer: true,
        ...(fee > 0 ? { refund_application_fee: true } : {}),
      },
      { idempotencyKey: `refund:${session.id}` },
    );

    const { error: refundError } = await admin.rpc("mark_order_refunded", {
      p_session_id: session.id,
      p_refund_id: refund.id,
    });
    if (refundError) {
      throw new Error(`Failed to mark order refunded: ${refundError.message}`);
    }
    return { outcome: "refunded", listingId, amountCents };
  }

  throw new Error(`Unexpected record_paid_order result: ${String(data)}`);
}
