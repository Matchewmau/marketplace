import type { SupabaseClient } from "@supabase/supabase-js";
import Stripe from "stripe";

import { fulfillCheckoutSession } from "@/lib/fulfillment";
import { getPurchaseState, PURCHASE_REASON_TEXT } from "@/lib/purchase";
import { applicationFeeCents, safeProductImage } from "@/lib/stripe/amount";
import { getAppScope } from "@/lib/stripe/app-scope";
import {
  refreshSellerAccount,
  safeErrorMessage,
  SellerAccountMissingError,
} from "@/lib/stripe/connect";
import type { Listing, PurchaseBlockReason } from "@/lib/types";
import { isUuid } from "@/lib/validation";

// Stripe requires >= 30 min after creation; the margin absorbs clock skew and retries.
export const CHECKOUT_SESSION_TTL_SECONDS = 1980;
// Must stay above the session TTL so a payable session never outlives its hold.
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

export type CancelResult = "cancelled" | "already_paid" | "refunded" | "unknown";

const LOG_PREFIX = "checkout failed:";
const CANCEL_LOG_PREFIX = "checkout cancel failed:";
const START_ERROR = "Could not start checkout. Try again.";
const SERVER_ERROR = "Could not start checkout.";
const NOT_CONFIGURED = "Payments are not configured.";

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

/** Expires a Checkout Session; false (logged) if Stripe refused, so the caller keeps the hold. */
async function expireSession(stripe: Stripe, sessionId: string): Promise<boolean> {
  try {
    await stripe.checkout.sessions.expire(sessionId);
    return true;
  } catch (err) {
    console.error(LOG_PREFIX, "expire session", safeErrorMessage(err));
    return false;
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

  const appScope = getAppScope();
  if (!appScope) {
    console.error(
      LOG_PREFIX,
      "app scope unavailable: set a valid APP_SCOPE (required with a local Supabase) or check NEXT_PUBLIC_SUPABASE_URL",
    );
    return { ok: false, status: 503, error: NOT_CONFIGURED };
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
      if (session.status === "open") {
        // An open session without a url cannot be resumed; expire it and start over. If it cannot
        // be expired it may still be paid, so keep the hold (its TTL clears it).
        if (!(await expireSession(stripe, session.id))) {
          return { ok: false, status: 502, error: START_ERROR };
        }
        await releaseHold(admin, listing.id, holdToken);
      }
      if (session.status === "expired") {
        await releaseHold(admin, listing.id, holdToken);
      }
    } else if (hold) {
      // The session was never attached; drop our own hold so we can reserve again.
      await releaseHold(admin, listing.id, holdToken);
    }
  }

  let seller: Awaited<ReturnType<typeof refreshSellerAccount>>;
  try {
    seller = await refreshSellerAccount(stripe, admin, listing.seller_email.trim().toLowerCase());
  } catch (err) {
    if (err instanceof SellerAccountMissingError) {
      return blocked("seller_not_onboarded");
    }
    console.error(LOG_PREFIX, "refresh seller account", safeErrorMessage(err));
    if (err instanceof Stripe.errors.StripeError) {
      return { ok: false, status: 502, error: START_ERROR };
    }
    return { ok: false, status: 500, error: SERVER_ERROR };
  }
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
          metadata: {
            listing_id: listing.id,
            seller_account_id: seller.stripe_account_id,
            app_scope: appScope,
          },
        },
        metadata: {
          listing_id: listing.id,
          seller_account_id: seller.stripe_account_id,
          app_scope: appScope,
        },
        expires_at: nowSec + CHECKOUT_SESSION_TTL_SECONDS,
        success_url: `${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
        // The hold token stays out of the URL; the cancel page posts it from sessionStorage.
        cancel_url: `${origin}/checkout/cancel?listing=${listing.id}`,
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

  // Register the session before anything can fulfil it: Stripe metadata is never trusted.
  // An idempotent replay may return an already-registered session (duplicate key).
  const { error: registryError } = await admin.from("checkout_sessions").insert({
    stripe_checkout_session_id: session.id,
    listing_id: listing.id,
    hold_token: hold,
    amount_cents: state.amountCents,
    currency: "usd",
    seller_stripe_account_id: seller.stripe_account_id,
    application_fee_cents: fee,
  });
  if (registryError && registryError.code !== "23505") {
    console.error(LOG_PREFIX, "register checkout session", safeErrorMessage(registryError.message));
    try {
      await stripe.checkout.sessions.expire(session.id);
    } catch (err) {
      console.error(LOG_PREFIX, "expire session", safeErrorMessage(err));
    }
    await releaseHold(admin, listing.id, hold);
    return { ok: false, status: 500, error: START_ERROR };
  }

  const { error: attachError } = await admin.rpc("attach_hold_session", {
    p_listing_id: listing.id,
    p_hold_token: hold,
    p_session_id: session.id,
    p_url: session.url,
  });
  if (attachError) {
    console.error(LOG_PREFIX, "attach_hold_session", safeErrorMessage(attachError.message));
    // Without the session on the hold it cannot be resumed or cancelled; do not hand it out.
    // Release the hold only once the session can no longer be paid; otherwise its TTL clears it.
    if (await expireSession(stripe, session.id)) {
      await releaseHold(admin, listing.id, hold);
    }
    return { ok: false, status: 502, error: START_ERROR };
  }

  return { ok: true, url: session.url, holdToken: hold };
}

/**
 * Expires the buyer's Checkout Session (if any) and releases their hold. The hold is only released
 * once the session can no longer be paid; otherwise its TTL clears it. Never throws.
 */
export async function cancelCheckoutHold(
  listingId: string,
  holdToken: string,
  deps: { stripe: Stripe; admin: SupabaseClient },
): Promise<CancelResult> {
  const { stripe, admin } = deps;
  try {
    const hold = await loadHold(admin, listingId, holdToken);
    if (!hold) {
      // Already released, expired, or consumed by a paid order: we cannot tell which.
      return "unknown";
    }
    if (!hold.checkout_session_id) {
      await releaseHold(admin, listingId, holdToken);
      return "cancelled";
    }

    const session = await stripe.checkout.sessions.retrieve(hold.checkout_session_id);
    if (session.status === "complete") {
      try {
        const { outcome } = await fulfillCheckoutSession(session.id, { stripe, admin });
        return outcome === "refunded" ? "refunded" : "already_paid";
      } catch (err) {
        // Not yet recorded (or refunded); keep the hold and let the webhook settle it.
        console.error(CANCEL_LOG_PREFIX, safeErrorMessage(err));
        return "unknown";
      }
    }
    if (session.status === "open") {
      // Throws if the session could not be expired; the hold then stays until its TTL.
      await stripe.checkout.sessions.expire(session.id);
    } else if (session.status !== "expired") {
      return "unknown";
    }
    await releaseHold(admin, listingId, holdToken);
    return "cancelled";
  } catch (err) {
    console.error(CANCEL_LOG_PREFIX, safeErrorMessage(err));
    return "unknown";
  }
}
