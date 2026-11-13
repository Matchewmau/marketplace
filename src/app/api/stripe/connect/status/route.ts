import { NextResponse } from "next/server";
import Stripe from "stripe";

import { normalizeSellerEmail } from "@/lib/seller-claim";
import { StripeConfigError } from "@/lib/stripe/config";
import {
  refreshSellerAccount,
  safeErrorMessage,
  SellerAccountMissingError,
  toPublicSellerStatus,
  unbindSellerAccount,
} from "@/lib/stripe/connect";
import { getStripe } from "@/lib/stripe/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

const LOAD_ERROR = "Could not load payout settings.";
const LOG_PREFIX = "stripe connect status failed:";
const NO_STORE = { "Cache-Control": "no-store" };

function serverError(message: string) {
  console.error(LOG_PREFIX, message);
  return NextResponse.json({ error: LOAD_ERROR }, { status: 500 });
}

/** Number of the seller's active listings, or undefined when the count can't be loaded. */
async function countActiveListings(
  admin: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  email: string,
): Promise<number | undefined> {
  try {
    const { count, error } = await admin
      .from("listings")
      .select("id", { count: "exact", head: true })
      .eq("seller_email", email)
      .eq("status", "active");
    if (error) {
      console.error(LOG_PREFIX, "active listings count:", safeErrorMessage(error.message));
      return undefined;
    }
    return count ?? undefined;
  } catch (err) {
    console.error(LOG_PREFIX, "active listings count:", safeErrorMessage(err));
    return undefined;
  }
}

export async function GET(request: Request) {
  const email = normalizeSellerEmail(new URL(request.url).searchParams.get("email"));
  if (!email) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  let admin: ReturnType<typeof getSupabaseAdmin>;
  try {
    admin = getSupabaseAdmin();
  } catch (err) {
    return serverError(safeErrorMessage(err));
  }
  let stripe: Stripe;
  try {
    stripe = getStripe();
  } catch (err) {
    if (err instanceof StripeConfigError) {
      return NextResponse.json({ error: "Payments are not configured." }, { status: 503 });
    }
    return serverError(safeErrorMessage(err));
  }
  if (!admin) {
    return NextResponse.json({ error: "Payments are not configured." }, { status: 503 });
  }

  try {
    // Start the count alongside the refresh; it never rejects, and is discarded when there is no status.
    const activeListingsPromise = countActiveListings(admin, email);
    const status = await refreshSellerAccount(stripe, admin, email);
    if (!status) {
      return NextResponse.json({ status: null }, { headers: NO_STORE });
    }
    const activeListings = await activeListingsPromise;
    return NextResponse.json(
      {
        status: toPublicSellerStatus(
          status,
          activeListings === undefined ? {} : { active_listings: activeListings },
        ),
      },
      { headers: NO_STORE },
    );
  } catch (err) {
    // The bound account is gone from Stripe, so the binding to that account id is stale.
    if (err instanceof SellerAccountMissingError) {
      try {
        await unbindSellerAccount(admin, email, err.accountId);
      } catch (unbindErr) {
        return serverError(safeErrorMessage(unbindErr));
      }
      return NextResponse.json({ status: null }, { headers: NO_STORE });
    }
    if (err instanceof Stripe.errors.StripeError) {
      console.error(LOG_PREFIX, safeErrorMessage(err), {
        type: err.type,
        code: err.code,
      });
      return NextResponse.json({ error: "Could not reach Stripe. Try again." }, { status: 502 });
    }
    return serverError(safeErrorMessage(err));
  }
}
