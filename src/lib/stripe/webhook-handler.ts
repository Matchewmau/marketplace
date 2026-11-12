import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

import { fulfillCheckoutSession } from "@/lib/fulfillment";
import { AppScopeUnavailableError, getAppScope } from "@/lib/stripe/app-scope";
import { isUuid } from "@/lib/validation";

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
      const appScope = getAppScope();
      if (!appScope) {
        // Throw so the webhook fails and Stripe retries once the scope is configured.
        throw new AppScopeUnavailableError();
      }
      if (event.data.object.metadata?.app_scope !== appScope) {
        // Another deployment sharing this Stripe sandbox owns this session.
        return "ignored";
      }
      const listingId = event.data.object.metadata?.listing_id;
      const holdToken = event.data.object.metadata?.hold_token;
      if (!listingId || !holdToken || !isUuid(listingId) || !isUuid(holdToken)) {
        return "ignored";
      }
      const { error } = await deps.admin.rpc("release_listing_hold", {
        p_listing_id: listingId,
        p_hold_token: holdToken,
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
