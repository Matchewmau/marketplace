import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

import { fulfillCheckoutSession } from "@/lib/fulfillment";

export type WebhookOutcome = "fulfilled" | "released" | "ignored";

export async function handleStripeEvent(
  event: Stripe.Event,
  deps: { stripe: Stripe; admin: SupabaseClient },
): Promise<WebhookOutcome> {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      // recorded, duplicate, refunded and refunded_unavailable are all handled; only ignored is not.
      const { outcome } = await fulfillCheckoutSession(event.data.object.id, deps);
      return outcome === "ignored" ? "ignored" : "fulfilled";
    }
    case "checkout.session.expired": {
      // Release using our own registry row, never the (forgeable) session metadata. Unregistered
      // sessions are not ours and are ignored.
      const { data: registered, error: registryError } = await deps.admin
        .from("checkout_sessions")
        .select("listing_id, hold_token")
        .eq("stripe_checkout_session_id", event.data.object.id)
        .maybeSingle();
      if (registryError) {
        throw new Error(`Failed to load checkout session registry: ${registryError.message}`);
      }
      const registry = registered as { listing_id: string; hold_token: string } | null;
      if (!registry) {
        return "ignored";
      }
      const { error } = await deps.admin.rpc("release_listing_hold", {
        p_listing_id: registry.listing_id,
        p_hold_token: registry.hold_token,
      });
      if (error) {
        throw new Error(`Failed to release hold: ${error.message}`);
      }
      return "released";
    }
    default:
      return "ignored";
  }
}
