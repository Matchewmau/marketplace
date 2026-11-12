import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

import { fulfillCheckoutSession } from "@/lib/fulfillment";
import { getPurchaseState, PURCHASE_REASON_TEXT } from "@/lib/purchase";
import { applicationFeeCents, safeProductImage } from "@/lib/stripe/amount";
import { refreshSellerAccount, safeErrorMessage } from "@/lib/stripe/connect";
import type { Listing, PurchaseBlockReason } from "@/lib/types";
import { isUuid } from "@/lib/validation";

export const CHECKOUT_SESSION_TTL_SECONDS = 1860; // Stripe requires >= 30 min after creation
export const HOLD_TTL_SECONDS = 2400;

export type CheckoutDeps = {
  stripe: Stripe;
  admin: SupabaseClient;
  feeBps: number;
  now?: () => number;
};

export type CheckoutResult =
  | { ok: true; url: string; holdToken: string }
  | {
      ok: false;
      status: 400 | 404 | 409 | 500 | 502 | 503;
      error: string;
      reason?: PurchaseBlockReason;
    };

type ListingRow = Pick<Listing, "id" | "title" | "price" | "image_url" | "seller_email" | "status">;
type HoldRow = { checkout_session_id: string | null };

const LOG_PREFIX = "checkout failed:";
const START_ERROR = "Could not start checkout. Try again.";
const SERVER_ERROR = "Could not start checkout.";

function blocked(reason: PurchaseBlockReason): CheckoutResult {
  return { ok: false, status: 409, error: PURCHASE_REASON_TEXT[reason], reason };
}

async function releaseHold(
  admin: SupabaseClient,
  listingId: string,
  holdToken: string,
): Promise<void> {
  const { error } = await admin.rpc("release_listing_hold", {
    p_listing_id: listingId,
    p_hold_token: holdToken,
  });
  if (error) {
    console.error(LOG_PREFIX, "release_listing_hold", safeErrorMessage(error.message));
  }
}

async function loadHold(
  admin: SupabaseClient,
  listingId: string,
  holdToken: string,
  nowMs?: number,
): Promise<HoldRow | null> {
  let query = admin
    .from("listing_holds")
    .select("checkout_session_id")
    .eq("listing_id", listingId)
    .eq("hold_token", holdToken);
  if (nowMs !== undefined) {
    query = query.gt("expires_at", new Date(nowMs).toISOString());
  }
  const { data, error } = await query.maybeSingle();
  if (error) {
    throw new Error(`Failed to load hold: ${error.message}`);
  }
  return (data as HoldRow | null) ?? null;
}

export async function createCheckoutForListing(
  listingId: string,
  origin: string,
  deps: CheckoutDeps,
  holdToken?: string,
): Promise<CheckoutResult> {
  const { stripe, admin, feeBps } = deps;
  const nowMs = () => deps.now?.() ?? Date.now();

  if (typeof listingId !== "string" || !isUuid(listingId)) {
    return { ok: false, status: 400, error: "Invalid listing." };
  }

  const { data: listingData, error: listingError } = await admin
    .from("listings")
    .select("id, title, price, image_url, seller_email, status")
    .eq("id", listingId)
    .maybeSingle();
  if (listingError) {
    console.error(LOG_PREFIX, safeErrorMessage(listingError.message));
    return { ok: false, status: 500, error: SERVER_ERROR };
  }
  if (!listingData) {
    return { ok: false, status: 404, error: "Listing not found." };
  }
  const listing = listingData as ListingRow;

  // Resume the buyer's own unexpired hold instead of reserving again.
  if (holdToken && isUuid(holdToken)) {
    const hold = await loadHold(admin, listing.id, holdToken, nowMs());
    if (hold?.checkout_session_id) {
      let session: Stripe.Checkout.Session;
      try {
        session = await stripe.checkout.sessions.retrieve(hold.checkout_session_id);
      } catch (err) {
        console.error(LOG_PREFIX, safeErrorMessage(err));
        return { ok: false, status: 502, error: START_ERROR };
      }

      if (session.status === "open" && session.url) {
        return { ok: true, url: session.url, holdToken };
      }
      if (session.status === "complete") {
        try {
          await fulfillCheckoutSession(session.id, { stripe, admin });
        } catch (err) {
          console.error(LOG_PREFIX, safeErrorMessage(err));
        }
        return blocked("sold");
      }
      if (session.status === "expired") {
        await releaseHold(admin, listing.id, holdToken);
      }
    } else if (hold) {
      // The session was never attached; drop our own hold so we can reserve again.
      await releaseHold(admin, listing.id, holdToken);
    }
  }

  const seller = await refreshSellerAccount(
    stripe,
    admin,
    listing.seller_email.trim().toLowerCase(),
  );
  if (!seller || !seller.charges_enabled) {
    return blocked("seller_not_onboarded");
  }

  // The amount comes only from the DB row, never from the client.
  const state = getPurchaseState(listing, { charges_enabled: true }, false, true);
  if (!state.buyable) {
    return blocked(state.reason);
  }

  const hold = crypto.randomUUID();
  const { data: reserved, error: reserveError } = await admin.rpc("reserve_listing", {
    p_listing_id: listing.id,
    p_hold_token: hold,
    p_ttl_seconds: HOLD_TTL_SECONDS,
  });
  if (reserveError) {
    console.error(LOG_PREFIX, "reserve_listing", safeErrorMessage(reserveError.message));
    return { ok: false, status: 500, error: SERVER_ERROR };
  }
  if (reserved !== true) {
    return blocked("reserved");
  }

  const fee = applicationFeeCents(state.amountCents, feeBps);
  const nowSec = Math.floor(nowMs() / 1000);
  const images = safeProductImage(listing.image_url);

  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        allowed_payment_method_types: ["card"],
        client_reference_id: listing.id,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "usd",
              unit_amount: state.amountCents,
              product_data: {
                name: listing.title,
                ...(images ? { images } : {}),
              },
            },
          },
        ],
        payment_intent_data: {
          transfer_data: { destination: seller.stripe_account_id },
          ...(fee > 0 ? { application_fee_amount: fee } : {}),
          metadata: { listing_id: listing.id, hold_token: hold },
        },
        metadata: {
          listing_id: listing.id,
          hold_token: hold,
          seller_account_id: seller.stripe_account_id,
        },
        expires_at: nowSec + CHECKOUT_SESSION_TTL_SECONDS,
        success_url: `${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/checkout/cancel?listing=${listing.id}&hold=${hold}`,
      },
      { idempotencyKey: `checkout:${hold}` },
    );
  } catch (err) {
    console.error(LOG_PREFIX, safeErrorMessage(err));
    await releaseHold(admin, listing.id, hold);
    return { ok: false, status: 502, error: START_ERROR };
  }

  if (!session.url) {
    console.error(LOG_PREFIX, "checkout session has no url");
    await releaseHold(admin, listing.id, hold);
    return { ok: false, status: 502, error: START_ERROR };
  }

  const { error: attachError } = await admin.rpc("attach_hold_session", {
    p_listing_id: listing.id,
    p_hold_token: hold,
    p_session_id: session.id,
    p_url: session.url,
  });
  if (attachError) {
    console.error(LOG_PREFIX, "attach_hold_session", safeErrorMessage(attachError.message));
  }

  return { ok: true, url: session.url, holdToken: hold };
}

/** Expires the buyer's Checkout Session (if any) and releases their hold. Never throws. */
export async function cancelCheckoutHold(
  listingId: string,
  holdToken: string,
  deps: { stripe: Stripe; admin: SupabaseClient },
): Promise<void> {
  const { stripe, admin } = deps;
  try {
    const hold = await loadHold(admin, listingId, holdToken);
    if (hold?.checkout_session_id) {
      try {
        await stripe.checkout.sessions.expire(hold.checkout_session_id);
      } catch {
        // The session may already be complete or expired.
      }
    }
    await releaseHold(admin, listingId, holdToken);
  } catch (err) {
    console.error("checkout cancel failed:", safeErrorMessage(err));
  }
}
